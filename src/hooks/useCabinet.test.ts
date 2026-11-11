// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { DiscogsCollectionRelease } from '../types/discogs'
import type { DisplayRelease } from '../utils/collection'
import { makeSortKey } from '../utils/sortName'
import * as store from '../db/cabinet'
import * as syncApi from '../api/sync'
import type { CabinetDoc, LegacyCabinetDoc } from '../shared/cabinetDoc'
import {
  buildCabinetDoc,
  defaultCabinet,
  nextSlotId,
  rebaseCabinetDoc,
  useCabinet,
  withUniqueSlotIds,
} from './useCabinet'

// The release-notes scan has its own tests; here it reports whatever notes the
// test sets, and never touches the network.
const scan = vi.hoisted(() => ({ notes: {} as Record<string, string>, paused: [] as boolean[] }))
vi.mock('./useGatefoldNotes', () => ({
  useGatefoldNotes: ({ paused }: { paused: boolean }) => {
    scan.paused.push(paused)
    return { notes: scan.notes, progress: null, error: null }
  },
}))

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

function docWith(cabinetName: string): CabinetDoc {
  return {
    schemaVersion: 2,
    cabinets: [{ id: 'main', name: cabinetName, slots: [{ id: 'slot-1', label: 'A', capacity: 40 }] }],
    sleeves: {},
    options: { sort: 'chronological', separateSizeClasses: false },
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** A document as an app from before version 2 saved it, derived fields and all. */
function legacyDocWith(cabinetName: string, sleeves?: Record<string, boolean>): LegacyCabinetDoc {
  return {
    schemaVersion: 1,
    cabinets: [{ id: 'main', name: cabinetName, slots: [{ id: 'slot-1', label: 'A', capacity: 40 }] }],
    placements: { '1-1': 'slot-1' },
    overrides: {},
    unplaced: ['2-2'],
    ...(sleeves ? { sleeves } : {}),
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const releases = [release('A', 'One'), release('B', 'Two')]

const useIt = (overrides: Partial<Parameters<typeof useCabinet>[0]> = {}) =>
  useCabinet({ username: 'alice', token: 'tok', releases, enabled: true, ...overrides })

beforeEach(() => {
  vi.restoreAllMocks()
  scan.notes = {}
  scan.paused = []
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('helpers', () => {
  it('starts with two shelves at LP capacity in a record cabinet', () => {
    const cabinet = defaultCabinet()
    expect(cabinet.name).toBe('Record Cabinet')
    expect(cabinet.slots).toHaveLength(2)
    expect(cabinet.slots.map((slot) => slot.capacity)).toEqual([75, 75])
  })

  it('gives a new shelf an id no other shelf has', () => {
    const slot = (id: string) => ({ id, label: id, capacity: 75 })
    expect(nextSlotId([])).toBe('slot-1')
    expect(nextSlotId([slot('slot-1'), slot('slot-2')])).toBe('slot-3')
    // slot-2 was removed: counting shelves would hand out slot-3 a second time.
    expect(nextSlotId([slot('slot-1'), slot('slot-3')])).toBe('slot-4')
  })

  it('syncs only the shelves, options and sleeve calls, not where each record goes', () => {
    const cabinet = defaultCabinet()
    const doc = buildCabinetDoc([cabinet], { '7': true })
    expect(Object.keys(doc).sort()).toEqual([
      'cabinets',
      'displayed',
      'options',
      'schemaVersion',
      'sleeves',
      'updatedAt',
    ])
    expect(doc.schemaVersion).toBe(2)
    expect(doc.cabinets).toEqual([cabinet])
    expect(doc.sleeves).toEqual({ '7': true })
  })

  it('keeps the local cabinet after a sync conflict', () => {
    const local = docWith('Local')
    const rebased = rebaseCabinetDoc({ ...local, sleeves: { '3': false } })
    expect(rebased.cabinets).toEqual(local.cabinets)
    expect(rebased.sleeves).toEqual({ '3': false })
  })

  it('turns a copy stored before version 2 into version 2', () => {
    const rebased = rebaseCabinetDoc(legacyDocWith('Old', { '5': true }))
    expect(rebased).toEqual({
      schemaVersion: 2,
      cabinets: legacyDocWith('Old').cabinets,
      sleeves: { '5': true },
      options: { sort: 'chronological', separateSizeClasses: false },
      displayed: [],
      updatedAt: expect.any(String),
    })
    expect(rebaseCabinetDoc(legacyDocWith('Old')).sleeves).toEqual({})
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

  it('takes the layout options from the server copy', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    const remote = { ...docWith('x'), options: { sort: 'byName', separateSizeClasses: true } } as const
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: remote, etag: '"r3"' })

    const { result } = renderHook(() => useIt())

    await waitFor(() => expect(result.current.options).toEqual(remote.options))
  })

  it('pushes this device\'s options to a server copy saved before they synced', async () => {
    localStorage.setItem(
      'vinyl-vault:cabinet-options',
      JSON.stringify({ sort: 'byName', separateSizeClasses: true }),
    )
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    const old = docWith('Old')
    delete old.options
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: old, etag: '"r3"' })
    const pushSpy = vi.spyOn(syncApi, 'pushCabinet').mockResolvedValue({ doc: old, etag: '"r4"' })

    const { result } = renderHook(() => useIt())

    await waitFor(() => expect(result.current.status).toBe('synced'))
    expect(pushSpy.mock.calls[0][1].options).toEqual({ sort: 'byName', separateSizeClasses: true })
    expect(pushSpy.mock.calls[0][1].cabinets[0].name).toBe('Old')
  })

  it('syncs a change to the layout options', async () => {
    vi.useFakeTimers()
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })
    const pushSpy = vi
      .spyOn(syncApi, 'pushCabinet')
      .mockResolvedValue({ doc: docWith('x'), etag: '"r1"' })

    const { result } = renderHook(() => useIt())
    await act(async () => {})

    act(() => result.current.setSeparateSizeClasses(true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(pushSpy.mock.calls[0][1].options?.separateSizeClasses).toBe(true)
  })

  it('takes a copy on display off the shelves, and syncs it', async () => {
    vi.useFakeTimers()
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })
    const pushSpy = vi
      .spyOn(syncApi, 'pushCabinet')
      .mockResolvedValue({ doc: docWith('x'), etag: '"r1"' })

    const { result } = renderHook(() => useIt())
    await act(async () => {})
    expect(result.current.plan.placements[releases[0].key]).toBeDefined()

    act(() => result.current.toggleDisplayed(releases[0]))
    expect(result.current.displayed).toEqual([releases[0]])
    expect(result.current.plan.placements[releases[0].key]).toBeUndefined()
    expect(result.current.plan.unplaced).not.toContain(releases[0])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(pushSpy.mock.calls[0][1].displayed).toEqual([releases[0].instanceId])

    act(() => result.current.toggleDisplayed(releases[0]))
    expect(result.current.displayed).toEqual([])
    expect(result.current.plan.placements[releases[0].key]).toBeDefined()
  })

  it('restores the copies on display from the server copy', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    const remote = { ...docWith('x'), displayed: [releases[1].instanceId] }
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: remote, etag: '"r3"' })

    const { result } = renderHook(() => useIt())

    await waitFor(() => expect(result.current.displayed).toEqual([releases[1]]))
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
          doc: docWith('Server'),
          etag: '"r5"',
        }),
      )
      .mockResolvedValue({ doc: docWith('x'), etag: '"r6"' })

    const { result } = renderHook(() => useIt())
    await act(async () => {})

    act(() => result.current.addSlot())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(pushSpy).toHaveBeenCalledTimes(2)
    expect(pushSpy.mock.calls[1][2]).toBe('"r5"')
    // The local edit (a third shelf) survives the rebase.
    expect(result.current.cabinet.slots).toHaveLength(3)
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

  it('removes every shelf, so the layout can start over', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })

    const { result } = renderHook(() => useIt())
    await waitFor(() => expect(result.current.status).toBe('synced'))

    act(() => result.current.removeSlot('slot-1'))
    act(() => result.current.removeSlot('slot-2'))
    expect(result.current.cabinet.slots).toHaveLength(0)
    expect(result.current.plan.unplaced).toHaveLength(releases.length)

    act(() => result.current.addSlot())
    expect(result.current.cabinet.slots.map((slot) => slot.id)).toEqual(['slot-1'])
  })

  it('never hands out a shelf id twice after removing one in the middle', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })

    const { result } = renderHook(() => useIt())
    await waitFor(() => expect(result.current.status).toBe('synced'))

    act(() => result.current.addSlot())
    act(() => result.current.removeSlot('slot-2'))
    act(() => result.current.addSlot())

    const ids = result.current.cabinet.slots.map((slot) => slot.id)
    expect(ids).toEqual(['slot-1', 'slot-3', 'slot-4'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('pushes a dirty copy stored before version 2 as version 2', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue({
      username: 'alice',
      doc: legacyDocWith('Old', { '9': true }),
      revision: 3,
      dirty: true,
    })
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })
    const pushSpy = vi
      .spyOn(syncApi, 'pushCabinet')
      .mockImplementation(async (_token, doc) => ({ doc, etag: '"r4"' }))

    const { result } = renderHook(() => useIt())
    await waitFor(() => expect(result.current.status).toBe('synced'))
    const sent = pushSpy.mock.calls[0][1]
    expect(sent.schemaVersion).toBe(2)
    expect(sent).not.toHaveProperty('placements')
    expect(sent.sleeves).toEqual({ '9': true })
  })

  describe('gatefolds', () => {
    const synced = async () => {
      vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
      vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
      vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })
    }

    it('counts a gatefold the release notes found as two spaces', async () => {
      await synced()
      scan.notes = { [String(releases[0].id)]: 'Gatefold sleeve.' }
      const { result } = renderHook(() => useIt())
      await waitFor(() => expect(result.current.status).toBe('synced'))

      const units = result.current.plan.slots.flatMap((slot) => slot.records.map((record) => record.units))
      expect(units.sort()).toEqual([1, 2])
    })

    it('stores a manual call in the synced document, and drops it when it agrees with Discogs again', async () => {
      await synced()
      const { result } = renderHook(() => useIt())
      await waitFor(() => expect(result.current.status).toBe('synced'))
      const id = String(releases[0].id)

      act(() => result.current.toggleGatefold(releases[0]))
      expect(result.current.sleeves.overrides).toEqual({ [id]: true })
      expect(result.current.dirty).toBe(true)

      act(() => result.current.toggleGatefold(releases[0]))
      expect(result.current.sleeves.overrides).toEqual({})
    })

    it('lets the user overrule a gatefold Discogs reports', async () => {
      await synced()
      scan.notes = { [String(releases[0].id)]: 'Gatefold sleeve.' }
      const { result } = renderHook(() => useIt())
      await waitFor(() => expect(result.current.status).toBe('synced'))

      act(() => result.current.toggleGatefold(releases[0]))
      expect(result.current.sleeves.overrides).toEqual({ [String(releases[0].id)]: false })
      const units = result.current.plan.slots.flatMap((slot) => slot.records.map((record) => record.units))
      expect(units).toEqual([1, 1])
    })

    it('restores manual calls from the stored document', async () => {
      const stored = { ...docWith('Record Cabinet'), sleeves: { [String(releases[1].id)]: true } }
      vi.spyOn(store, 'getCabinet').mockResolvedValue({ username: 'alice', doc: stored, revision: 1, dirty: false })
      vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)

      const { result } = renderHook(() => useIt({ token: null }))
      await waitFor(() => expect(result.current.sleeves.overrides).toEqual(stored.sleeves))
    })

    it('holds the release-notes scan until the collection has loaded', () => {
      vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
      const { rerender } = renderHook(({ ready }) => useIt({ token: null, collectionReady: ready }), {
        initialProps: { ready: false },
      })
      expect(scan.paused.at(-1)).toBe(true)
      rerender({ ready: true })
      expect(scan.paused.at(-1)).toBe(false)
    })

    it('toggles a call made before the notes agreed with it back to standard, in one press', async () => {
      // Marked as gatefold, then the notes said so too: the call no longer
      // disagrees, so one press makes it a standard sleeve, as the button shows.
      await synced()
      const id = String(releases[0].id)
      const stored = { ...docWith('Record Cabinet'), sleeves: { [id]: true } }
      vi.spyOn(store, 'getCabinet').mockResolvedValue({ username: 'alice', doc: stored, revision: 1, dirty: false })
      scan.notes = { [id]: 'Gatefold sleeve.' }
      const { result } = renderHook(() => useIt({ token: null }))
      await waitFor(() => expect(result.current.sleeves.overrides).toEqual({ [id]: true }))

      act(() => result.current.toggleGatefold(releases[0]))
      expect(result.current.sleeves.overrides).toEqual({ [id]: false })
    })

    it('keeps a toggle made while a push is in flight', async () => {
      vi.useFakeTimers()
      await synced()
      let release: () => void = () => {}
      const pushSpy = vi
        .spyOn(syncApi, 'pushCabinet')
        .mockImplementationOnce(
          (_token, doc) =>
            new Promise((resolve) => {
              release = () => resolve({ doc, etag: '"r1"' })
            }),
        )
        .mockImplementation(async (_token, doc) => ({ doc, etag: '"r2"' }))
      const { result } = renderHook(() => useIt())
      await act(async () => {})

      act(() => result.current.addSlot())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      act(() => result.current.toggleGatefold(releases[0]))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
        release()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })

      expect(pushSpy).toHaveBeenCalledTimes(2)
      expect(pushSpy.mock.calls[1][1].sleeves).toEqual({ [String(releases[0].id)]: true })
      expect(result.current.dirty).toBe(false)
    })

    it('keeps the manual calls through a sync conflict', () => {
      const local = { ...docWith('Record Cabinet'), sleeves: { '7': true } }
      expect(rebaseCabinetDoc(local).sleeves).toEqual({ '7': true })
    })
  })

  it('keeps an edit made while a push is in flight, and pushes it next', async () => {
    vi.useFakeTimers()
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    const putSpy = vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })
    let release: () => void = () => {}
    const pushSpy = vi
      .spyOn(syncApi, 'pushCabinet')
      .mockImplementationOnce(
        (_token, doc) =>
          new Promise((resolve) => {
            release = () => resolve({ doc, etag: '"r1"' })
          }),
      )
      .mockImplementation(async (_token, doc) => ({ doc, etag: '"r2"' }))

    const { result } = renderHook(() => useIt())
    await act(async () => {})

    // Remove shelf 2; its push goes out and hangs.
    act(() => {
      result.current.removeSlot('slot-2')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(pushSpy).toHaveBeenCalledTimes(1)

    // Remove shelf 1 while that push is in flight, then let it land.
    act(() => {
      result.current.removeSlot('slot-1')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
      release()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    // The second removal survives and reaches the server, one push at a time,
    // from the revision the first push saved.
    expect(result.current.cabinet.slots).toEqual([])
    expect(pushSpy).toHaveBeenCalledTimes(2)
    expect(pushSpy.mock.calls[1][1].cabinets[0].slots).toEqual([])
    expect(pushSpy.mock.calls[1][2]).toBe('"r1"')
    expect(result.current.dirty).toBe(false)
    // The newest copy stored locally is the empty cabinet.
    expect(putSpy.mock.calls.at(-1)?.[0].doc.cabinets[0].slots).toEqual([])
  })

  it('keeps a started-over cabinet empty when it loads again', async () => {
    const empty = { ...docWith('Record Cabinet'), cabinets: [{ id: 'main', name: 'Record Cabinet', slots: [] }] }
    vi.spyOn(store, 'getCabinet').mockResolvedValue({ username: 'alice', doc: empty, revision: 2, dirty: false })
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: empty, etag: '"r2"' })

    const { result } = renderHook(() => useIt())
    await waitFor(() => expect(result.current.status).toBe('synced'))
    expect(result.current.cabinet.slots).toEqual([])
    expect(result.current.plan.unplaced).toHaveLength(releases.length)
  })

  it('keeps a cabinet another device started over empty', async () => {
    const empty = { ...docWith('Record Cabinet'), cabinets: [{ id: 'main', name: 'Record Cabinet', slots: [] }] }
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: empty, etag: '"r7"' })

    const { result } = renderHook(() => useIt())
    await waitFor(() => expect(result.current.status).toBe('synced'))
    expect(result.current.cabinet.slots).toEqual([])
  })

  it('puts a removed shelf back where it was', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })
    const { result } = renderHook(() => useIt())
    await waitFor(() => expect(result.current.status).toBe('synced'))

    act(() => result.current.updateSlot('slot-1', { capacity: 30 }))
    let removed: ReturnType<typeof result.current.removeSlot> = null
    act(() => {
      removed = result.current.removeSlot('slot-1')
    })
    expect(removed).toEqual({ slot: { id: 'slot-1', label: 'Shelf 1', capacity: 30 }, index: 0 })
    expect(result.current.cabinet.slots.map((slot) => slot.id)).toEqual(['slot-2'])

    act(() => result.current.restoreSlot(removed!))
    expect(result.current.cabinet.slots).toEqual([
      { id: 'slot-1', label: 'Shelf 1', capacity: 30 },
      { id: 'slot-2', label: 'Shelf 2', capacity: 75 },
    ])
  })

  it('gives a restored shelf a fresh id when a new shelf took its old one', async () => {
    vi.spyOn(store, 'getCabinet').mockResolvedValue(null)
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)
    vi.spyOn(syncApi, 'fetchCabinet').mockResolvedValue({ doc: null, etag: '"r0"' })
    const { result } = renderHook(() => useIt())
    await waitFor(() => expect(result.current.status).toBe('synced'))

    let removed: ReturnType<typeof result.current.removeSlot> = null
    act(() => {
      removed = result.current.removeSlot('slot-2')
    })
    act(() => result.current.addSlot())
    act(() => result.current.restoreSlot(removed!))
    const ids = result.current.cabinet.slots.map((slot) => slot.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('repairs shelves that share an id when the cabinet loads', async () => {
    const doubled = {
      ...docWith('Record Cabinet'),
      cabinets: [
        {
          id: 'main',
          name: 'Record Cabinet',
          slots: [
            { id: 'slot-1', label: 'Shelf 1', capacity: 10 },
            { id: 'slot-2', label: 'Shelf 2', capacity: 20 },
            { id: 'slot-2', label: 'Shelf 3', capacity: 30 },
          ],
        },
      ],
    }
    vi.spyOn(store, 'getCabinet').mockResolvedValue({ username: 'alice', doc: doubled, revision: 1, dirty: false })
    vi.spyOn(store, 'putCabinet').mockResolvedValue(undefined)

    const { result } = renderHook(() => useIt({ token: null }))
    await waitFor(() => expect(result.current.cabinet.slots).toHaveLength(3))
    expect(result.current.cabinet.slots.map((slot) => [slot.id, slot.capacity])).toEqual([
      ['slot-1', 10],
      ['slot-2', 20],
      ['slot-3', 30],
    ])
  })
})

describe('withUniqueSlotIds', () => {
  it('leaves a cabinet with unique ids untouched', () => {
    const cabinets = [defaultCabinet()]
    expect(withUniqueSlotIds(cabinets)[0]).toBe(cabinets[0])
  })
})
