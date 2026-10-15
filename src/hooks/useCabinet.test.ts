// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { DiscogsCollectionRelease } from '../types/discogs'
import type { DisplayRelease } from '../utils/collection'
import { makeSortKey } from '../utils/sortName'
import * as store from '../db/cabinet'
import * as syncApi from '../api/sync'
import type { CabinetDoc } from '../shared/cabinetDoc'
import { buildCabinetDoc, defaultCabinet, rebaseCabinetDoc, useCabinet } from './useCabinet'

let nextId = 0

function release(artist: string, title: string): DisplayRelease {
  const id = ++nextId
  return {
    key: `${id}-${id}`,
    instanceId: id,
    id,
    title,
    titleKey: makeSortKey(title),
    year: 2000,
    originalYear: 2000,
    artistName: artist,
    genres: [],
    styles: [],
    labels: [],
    country: '',
    formatNames: ['Vinyl'],
    formatText: 'Vinyl · 12" · LP',
    coverImage: '',
    thumb: '',
    release: {} as DiscogsCollectionRelease,
    dateAdded: '2024-01-01T00:00:00-00:00',
  }
}

function docWith(cabinetName: string, overrides: Record<string, string> = {}): CabinetDoc {
  return {
    schemaVersion: 1,
    cabinets: [{ id: 'main', name: cabinetName, slots: [{ id: 'slot-1', label: 'A', capacity: 40 }] }],
    placements: {},
    overrides,
    unplaced: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const releases = [release('A', 'One'), release('B', 'Two')]

const useIt = (overrides: Partial<Parameters<typeof useCabinet>[0]> = {}) =>
  useCabinet({ username: 'alice', token: 'tok', releases, enabled: true, ...overrides })

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('helpers', () => {
  it('starts with two shelves at LP capacity', () => {
    const cabinet = defaultCabinet()
    expect(cabinet.slots).toHaveLength(2)
    expect(cabinet.slots.map((slot) => slot.capacity)).toEqual([75, 75])
  })

  it('stamps the document with the computed placements', () => {
    const cabinet = defaultCabinet()
    const plan = {
      placements: { '1-1': 'slot-1' },
      slots: [],
      unplaced: [releases[1]],
      conflicts: [],
      staleOverrides: [],
    }
    const doc = buildCabinetDoc([cabinet], { '1-1': 'slot-2' }, plan)
    expect(doc.schemaVersion).toBe(1)
    expect(doc.placements).toEqual({ '1-1': 'slot-1' })
    expect(doc.unplaced).toEqual([releases[1].key])
    expect(doc.overrides).toEqual({ '1-1': 'slot-2' })
  })

  it('rebases the server overrides under the local ones', () => {
    const local = { ...docWith('Local'), overrides: { a: 'slot-1', b: 'slot-1' } }
    const server = { ...docWith('Server'), overrides: { b: 'slot-2', c: 'slot-2' } }
    const rebased = rebaseCabinetDoc(local, server)
    expect(rebased.cabinets).toEqual(local.cabinets)
    expect(rebased.overrides).toEqual({ a: 'slot-1', b: 'slot-1', c: 'slot-2' })
  })
})

describe('useCabinet', () => {
  it('shows the stored cabinet without waiting for the network', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue({
      username: 'alice',
      doc: docWith('Cached'),
      revision: 4,
      dirty: false,
    })
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })

    const { result } = renderHook(() => useIt())

    await waitFor(() => expect(result.current.cabinet.name).toBe('Cached'))
  })

  it('adopts the server copy when the local one is clean', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: docWith('From server'), etag: '"r3"' })

    const { result } = renderHook(() => useIt())

    await waitFor(() => expect(result.current.cabinet.name).toBe('From server'))
    expect(result.current.status).toBe('synced')
  })

  it('reports offline when the server cannot be reached', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(syncApi, 'fetchCabinet').mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useIt())

    await waitFor(() => expect(result.current.status).toBe('offline'))
  })

  it('pushes local edits after the debounce', async () => {
    vi.useFakeTimers()
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })
    const pushSpy = vi
      .spyOn(syncApi, 'pushCabinet')
      .mockResolvedValue({ doc: docWith('x'), etag: '"r1"' })

    const { result } = renderHook(() => useIt())
    await act(async () => {})

    act(() => result.current.addSlot())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy.mock.calls[0][2]).toBe('"r0"')
    expect(result.current.dirty).toBe(false)
  })

  it('rebases and retries when the server has a newer revision', async () => {
    vi.useFakeTimers()
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })
    const pushSpy = vi
      .spyOn(syncApi, 'pushCabinet')
      .mockRejectedValueOnce(
        new syncApi.SyncConflictError({
          doc: docWith('Server', { fromServer: 'slot-1' }),
          etag: '"r5"',
        }),
      )
      .mockResolvedValue({ doc: docWith('x'), etag: '"r6"' })

    const { result } = renderHook(() => useIt())
    await act(async () => {})

    act(() => result.current.setName('Mine'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(pushSpy).toHaveBeenCalledTimes(2)
    expect(pushSpy.mock.calls[1][2]).toBe('"r5"')
    expect(result.current.overrides.fromServer).toBe('slot-1')
    expect(result.current.status).toBe('synced')
  })

  it('stays local when there is no token', async () => {
    vi.useFakeTimers()
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    const fetchSpy = vi.spyOn(syncApi, 'fetchCabinet')
    const pushSpy = vi.spyOn(syncApi, 'pushCabinet')

    const { result } = renderHook(() => useIt({ token: null }))
    await act(async () => {})

    act(() => result.current.addSlot())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(pushSpy).not.toHaveBeenCalled()
    expect(result.current.status).toBe('local')
  })

  it('keeps a manual nudge in the plan and clears it again', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })

    const { result } = renderHook(() => useIt())
    await waitFor(() => expect(result.current.status).toBe('synced'))

    const key = releases[0].key
    act(() => result.current.assign(key, 'slot-2'))
    expect(result.current.plan.placements[key]).toBe('slot-2')

    act(() => result.current.unassign(key))
    expect(result.current.plan.placements[key]).toBe('slot-1')
  })

  it('never removes the last shelf', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })

    const { result } = renderHook(() => useIt())
    await waitFor(() => expect(result.current.status).toBe('synced'))

    act(() => result.current.removeSlot('slot-1'))
    act(() => result.current.removeSlot('slot-2'))
    expect(result.current.cabinet.slots).toHaveLength(1)
  })
})
