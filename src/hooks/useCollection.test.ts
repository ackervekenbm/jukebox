// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import * as api from '../api/discogs'
import * as db from '../db/collection'
import type { Settings } from '../db/settings'
import { release } from '../test/factories'
import type { DiscogsCollectionRelease } from '../types/discogs'
import { useCollection } from './useCollection'

vi.mock('../api/discogs', () => ({
  fetchFolders: vi.fn(),
  fetchCollection: vi.fn(),
  fetchMasterYears: vi.fn(),
}))

vi.mock('../db/collection', () => ({
  getCachedCollection: vi.fn(),
  setCachedCollection: vi.fn(),
  removeCachedCollection: vi.fn(),
  getMasterYears: vi.fn(),
  setMasterYears: vi.fn(),
  clearMasterYears: vi.fn(),
  clearReleaseDetails: vi.fn(),
  clearReleaseNotes: vi.fn(),
  removeCachedCollectionValue: vi.fn(),
}))

vi.mock('../utils/storage', () => ({ clearAlbumArtCache: vi.fn() }))

const alice: Settings = { username: 'alice', token: 'tok', theme: 'midnight' }
const folders = [{ id: 0, name: 'All', count: 2, resource_url: '' }]

/** A collection release whose master is `master` (0: none linked). */
function pressing(id: number, master: number): DiscogsCollectionRelease {
  const base = release({ id, instance_id: id })
  return { ...base, basic_information: { ...base.basic_information, id, master_id: master } }
}

const cached = [pressing(1, 10)]
const fresh = [pressing(1, 10), pressing(2, 20), pressing(3, 0)]

/** Waits for the sync to have run: status starts out 'idle' too, before it begins. */
async function synced(result: { current: ReturnType<typeof useCollection> }, calls = 1) {
  await waitFor(() => {
    expect(api.fetchCollection).toHaveBeenCalledTimes(calls)
    expect(result.current.status).toBe('idle')
  })
}

beforeEach(() => {
  vi.mocked(db.getCachedCollection).mockResolvedValue(undefined)
  vi.mocked(db.getMasterYears).mockResolvedValue({})
  vi.mocked(db.setCachedCollection).mockResolvedValue(undefined)
  vi.mocked(db.setMasterYears).mockResolvedValue(undefined)
  vi.mocked(api.fetchFolders).mockResolvedValue(folders)
  vi.mocked(api.fetchCollection).mockResolvedValue({ releases: fresh, items: fresh.length })
  vi.mocked(api.fetchMasterYears).mockResolvedValue({})
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useCollection', () => {
  it('shows the cached collection first, then the fresh one, and caches it', async () => {
    vi.mocked(db.getCachedCollection).mockResolvedValue({
      username: 'alice',
      fetchedAt: 1000,
      releases: cached,
      items: 1,
      folders,
    })
    let finishCollection: (value: api.CollectionResult) => void = () => {}
    vi.mocked(api.fetchCollection).mockReturnValue(
      new Promise((resolve) => {
        finishCollection = resolve
      }),
    )

    const { result } = renderHook(() => useCollection(alice))

    await waitFor(() => expect(result.current.releases).toEqual(cached))
    expect(result.current.status).toBe('loading')
    expect(result.current.fetchedAt).toBe(1000)

    await act(async () => finishCollection({ releases: fresh, items: fresh.length }))

    await synced(result)
    expect(result.current.releases).toEqual(fresh)
    expect(result.current.folders).toEqual(folders)
    expect(db.setCachedCollection).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ releases: fresh, items: 3, folders }),
    )
  })

  it('fetches only the missing master years, never master 0, and stores them', async () => {
    vi.mocked(db.getMasterYears).mockResolvedValue({ 10: 1971 })
    vi.mocked(api.fetchMasterYears).mockImplementation(async (ids, _token, onProgress, _signal, onYear) => {
      onProgress?.(1, ids.length)
      onYear?.(20, 1985)
      return { 20: 1985 }
    })

    const { result } = renderHook(() => useCollection(alice))

    await synced(result)
    expect(vi.mocked(api.fetchMasterYears).mock.calls[0][0]).toEqual([20])
    expect(result.current.masterYears).toEqual({ 10: 1971, 20: 1985 })
    expect(db.setMasterYears).toHaveBeenCalledWith({ 10: 1971, 20: 1985 })
    expect(result.current.progress).toBeNull()
  })

  it('finishes the sync when year enrichment fails, keeping the years that came in', async () => {
    vi.mocked(api.fetchMasterYears).mockImplementation(async (_ids, _token, _onProgress, _signal, onYear) => {
      onYear?.(10, 1971)
      throw new Error('Discogs is down')
    })

    const { result } = renderHook(() => useCollection(alice))

    await synced(result)
    expect(result.current.error).toBeNull()
    expect(result.current.releases).toEqual(fresh)
    expect(result.current.masterYears).toEqual({ 10: 1971 })
  })

  it('reports a failed sync and keeps the cached collection on screen', async () => {
    vi.mocked(db.getCachedCollection).mockResolvedValue({
      username: 'alice',
      fetchedAt: 1000,
      releases: cached,
      items: 1,
      folders,
    })
    vi.mocked(api.fetchCollection).mockRejectedValue(new Error('Token rejected'))

    const { result } = renderHook(() => useCollection(alice))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('Token rejected')
    expect(result.current.releases).toEqual(cached)
  })

  it('does not sync again when only a preference such as the theme changes', async () => {
    const { result, rerender } = renderHook(({ settings }) => useCollection(settings), {
      initialProps: { settings: alice },
    })
    await synced(result)

    rerender({ settings: { ...alice, theme: 'paper' } })

    expect(api.fetchCollection).toHaveBeenCalledTimes(1)
  })

  it('syncs again on refresh', async () => {
    const { result } = renderHook(() => useCollection(alice))
    await synced(result)

    act(() => result.current.refresh())

    await synced(result, 2)
  })

  it('empties everything when the account is cleared', async () => {
    const { result, rerender } = renderHook(
      ({ settings }: { settings: Settings | null }) => useCollection(settings),
      { initialProps: { settings: alice as Settings | null } },
    )
    await waitFor(() => expect(result.current.releases).toEqual(fresh))

    rerender({ settings: null })

    expect(result.current.releases).toEqual([])
    expect(result.current.folders).toEqual([])
    expect(result.current.status).toBe('idle')
  })

  it('wipes every cache and the collection on screen', async () => {
    const { result } = renderHook(() => useCollection(alice))
    await synced(result)

    await act(() => result.current.wipeCache())

    expect(db.removeCachedCollection).toHaveBeenCalledWith('alice')
    expect(db.clearMasterYears).toHaveBeenCalled()
    expect(db.clearReleaseDetails).toHaveBeenCalled()
    expect(db.clearReleaseNotes).toHaveBeenCalled()
    expect(db.removeCachedCollectionValue).toHaveBeenCalledWith('alice')
    expect(result.current.releases).toEqual([])
    expect(result.current.masterYears).toEqual({})
  })
})
