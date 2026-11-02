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
  it('asks only about single vinyl LPs it has no answer for, and caches each answer', async () => {
    vi.spyOn(db, 'getReleaseGatefolds').mockResolvedValue({ '3': false })
    const save = vi.spyOn(db, 'setReleaseGatefold').mockResolvedValue(undefined)
    const scan = vi
      .spyOn(api, 'fetchReleaseGatefolds')
      .mockImplementation(async (ids, _token, onProgress, _signal, onRelease) => {
        ids.forEach((id) => onRelease?.(id, id === 1))
        onProgress?.(ids.length, ids.length)
        return Object.fromEntries(ids.map((id) => [id, id === 1]))
      })

    const { result } = renderHook(() =>
      useGatefoldNotes({ releases, token: 'tok', enabled: true, paused: false }),
    )

    await waitFor(() => expect(result.current.notes).toEqual({ '1': true, '2': false, '3': false }))
    expect(scan).toHaveBeenCalledTimes(1)
    expect(scan.mock.calls[0][0]).toEqual([1, 2])
    expect(save.mock.calls).toEqual([
      [1, true],
      [2, false],
    ])
    await waitFor(() => expect(result.current.progress).toBeNull())
  })

  it('waits while the collection is busy, and reports progress once it runs', async () => {
    vi.spyOn(db, 'getReleaseGatefolds').mockResolvedValue({})
    let finish: () => void = () => {}
    const scan = vi
      .spyOn(api, 'fetchReleaseGatefolds')
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
    await waitFor(() => expect(db.getReleaseGatefolds).toHaveBeenCalled())
    expect(scan).not.toHaveBeenCalled()

    rerender({ paused: false })
    await waitFor(() => expect(result.current.progress).toEqual({ done: 1, total: 2 }))
    finish()
    await waitFor(() => expect(result.current.progress).toBeNull())
  })

  it('does nothing while the cabinet is closed or without a token', async () => {
    const load = vi.spyOn(db, 'getReleaseGatefolds').mockResolvedValue({})
    const scan = vi.spyOn(api, 'fetchReleaseGatefolds').mockResolvedValue({})

    renderHook(() => useGatefoldNotes({ releases, token: 'tok', enabled: false, paused: false }))
    renderHook(() => useGatefoldNotes({ releases, token: null, enabled: true, paused: false }))

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    expect(scan).not.toHaveBeenCalled()
  })

  it('stops the scan when the cabinet closes', async () => {
    vi.spyOn(db, 'getReleaseGatefolds').mockResolvedValue({})
    let signal: AbortSignal | undefined
    vi.spyOn(api, 'fetchReleaseGatefolds').mockImplementation((_ids, _token, _progress, s) => {
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
