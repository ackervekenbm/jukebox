// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { DiscogsCollectionRelease, DiscogsFormat } from '../types/discogs'
import type { DisplayRelease } from '../utils/collection'
import { makeSortKey } from '../utils/sortName'
import * as api from '../api/discogs'
import * as db from '../db/collection'
import { useGatefoldNotes } from './useGatefoldNotes'

function release(id: number, formatText: string, formats: DiscogsFormat[]): DisplayRelease {
  return {
    key: `${id}-${id}`,
    instanceId: id,
    id,
    title: `Title ${id}`,
    titleKey: makeSortKey(`Title ${id}`),
    year: 2000,
    originalYear: 2000,
    artistName: 'Artist',
    genres: [],
    styles: [],
    labels: [],
    country: '',
    formatNames: [...new Set(formats.map((format) => format.name))],
    formatText,
    coverImage: '',
    thumb: '',
    release: { basic_information: { formats } } as unknown as DiscogsCollectionRelease,
    dateAdded: '2024-01-01T00:00:00-00:00',
  }
}

const lp = (id: number) =>
  release(id, 'Vinyl · LP · Album', [{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album'] }])

const releases = [
  lp(1),
  lp(2),
  lp(3),
  // Already says gatefold in the listing: nothing to learn from the notes.
  release(4, 'Vinyl · LP · Gatefold', [{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Gatefold'] }]),
  // A double LP takes two spaces either way.
  release(5, 'Vinyl · LP', [{ name: 'Vinyl', qty: '2', descriptions: ['LP'] }]),
  // Not vinyl.
  release(6, 'CD · Album', [{ name: 'CD', qty: '1', descriptions: ['Album'] }]),
  // A second copy of release 1.
  { ...lp(1), key: '1-99', instanceId: 99 },
]

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useGatefoldNotes', () => {
  it('asks only about single vinyl LPs it has no notes for, and caches the notes', async () => {
    vi.spyOn(db, 'getReleaseNotes').mockResolvedValue({ '3': '' })
    const save = vi.spyOn(db, 'setReleaseNotes').mockResolvedValue(undefined)
    const scan = vi
      .spyOn(api, 'fetchReleaseNotes')
      .mockImplementation(async (ids, _token, onProgress, _signal, onRelease) => {
        const notesFor = (id: number) => (id === 1 ? 'Gatefold sleeve.' : '')
        ids.forEach((id) => onRelease?.(id, notesFor(id)))
        onProgress?.(ids.length, ids.length)
        return Object.fromEntries(ids.map((id) => [id, notesFor(id)]))
      })

    const { result } = renderHook(() =>
      useGatefoldNotes({ releases, token: 'tok', enabled: true, paused: false }),
    )

    await waitFor(() =>
      expect(result.current.notes).toEqual({ '1': 'Gatefold sleeve.', '2': '', '3': '' }),
    )
    expect(scan).toHaveBeenCalledTimes(1)
    expect(scan.mock.calls[0][0]).toEqual([1, 2])
    expect(save.mock.calls).toEqual([
      [1, 'Gatefold sleeve.'],
      [2, ''],
    ])
    await waitFor(() => expect(result.current.progress).toBeNull())
  })

  it('waits while the collection is busy, and reports progress once it runs', async () => {
    vi.spyOn(db, 'getReleaseNotes').mockResolvedValue({})
    let finish: () => void = () => {}
    const scan = vi
      .spyOn(api, 'fetchReleaseNotes')
      .mockImplementation((_ids, _token, onProgress) => {
        onProgress?.(1, 2)
        return new Promise((resolve) => {
          finish = () => resolve({})
        })
      })

    const { result, rerender } = renderHook(
      ({ paused }) => useGatefoldNotes({ releases, token: 'tok', enabled: true, paused }),
      { initialProps: { paused: true } },
    )
    await waitFor(() => expect(db.getReleaseNotes).toHaveBeenCalled())
    expect(scan).not.toHaveBeenCalled()

    rerender({ paused: false })
    await waitFor(() => expect(result.current.progress).toEqual({ done: 1, total: 2 }))
    finish()
    await waitFor(() => expect(result.current.progress).toBeNull())
  })

  it('does nothing while the cabinet is closed or without a token', async () => {
    const load = vi.spyOn(db, 'getReleaseNotes').mockResolvedValue({})
    const scan = vi.spyOn(api, 'fetchReleaseNotes').mockResolvedValue({})

    renderHook(() => useGatefoldNotes({ releases, token: 'tok', enabled: false, paused: false }))
    renderHook(() => useGatefoldNotes({ releases, token: null, enabled: true, paused: false }))

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    expect(scan).not.toHaveBeenCalled()
  })

  it('skips releases the user has already decided', async () => {
    vi.spyOn(db, 'getReleaseNotes').mockResolvedValue({ '3': '' })
    const scan = vi.spyOn(api, 'fetchReleaseNotes').mockResolvedValue({})

    renderHook(() =>
      useGatefoldNotes({ releases, token: 'tok', enabled: true, paused: false, overrides: { '1': true } }),
    )
    await waitFor(() => expect(scan).toHaveBeenCalled())
    expect(scan.mock.calls[0][0]).toEqual([2])
  })

  it('says so when Discogs refuses the token, and stops', async () => {
    vi.spyOn(db, 'getReleaseNotes').mockResolvedValue({})
    vi.spyOn(api, 'fetchReleaseNotes').mockRejectedValue(
      new api.DiscogsError('You must authenticate to access this resource.', 401),
    )

    const { result } = renderHook(() =>
      useGatefoldNotes({ releases, token: 'bad', enabled: true, paused: false }),
    )
    await waitFor(() => expect(result.current.error).toMatch(/refused the token/))
    expect(result.current.progress).toBeNull()
  })

  it('stays quiet about other failures; the next run asks again', async () => {
    vi.spyOn(db, 'getReleaseNotes').mockResolvedValue({})
    const scan = vi.spyOn(api, 'fetchReleaseNotes').mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() =>
      useGatefoldNotes({ releases, token: 'tok', enabled: true, paused: false }),
    )
    await waitFor(() => expect(scan).toHaveBeenCalled())
    await waitFor(() => expect(result.current.progress).toBeNull())
    expect(result.current.error).toBeNull()
  })

  it('stops the scan when the cabinet closes', async () => {
    vi.spyOn(db, 'getReleaseNotes').mockResolvedValue({})
    let signal: AbortSignal | undefined
    vi.spyOn(api, 'fetchReleaseNotes').mockImplementation((_ids, _token, _progress, s) => {
      signal = s
      return new Promise(() => {})
    })

    const { unmount } = renderHook(() =>
      useGatefoldNotes({ releases, token: 'tok', enabled: true, paused: false }),
    )
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
