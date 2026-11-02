// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Settings } from '../db/settings'
import {
  getCachedCollection,
  setCachedCollection,
  removeCachedCollection,
  getMasterYears,
  setMasterYears,
  clearMasterYears,
  clearReleaseDetails,
  clearReleaseGatefolds,
  removeCachedCollectionValue,
} from '../db/collection'
import {
  fetchCollection,
  fetchFolders,
  fetchMasterYears,
  type CollectionResult,
  type MasterYears,
} from '../api/discogs'
import { clearAlbumArtCache } from '../utils/storage'
import type { DiscogsCollectionFolder, DiscogsCollectionRelease } from '../types/discogs'

export type Status = 'idle' | 'loading' | 'error'
export type SyncPhase = 'collection' | 'years'

export interface SyncProgress {
  phase: SyncPhase
  loaded: number
  total: number
}

interface UseCollectionResult {
  releases: DiscogsCollectionRelease[]
  folders: DiscogsCollectionFolder[]
  masterYears: MasterYears
  status: Status
  error: string | null
  progress: SyncProgress | null
  fetchedAt: number | null
  refresh: () => void
  wipeCache: () => Promise<void>
}

export function useCollection(settings: Settings | null): UseCollectionResult {
  const [releases, setReleases] = useState<DiscogsCollectionRelease[]>([])
  const [folders, setFolders] = useState<DiscogsCollectionFolder[]>([])
  const [masterYears, setMasterYearsState] = useState<MasterYears>({})
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  // Account identity, independent of preference fields like theme. Effects key
  // on this so appearance-only settings changes don't re-fetch the collection.
  const account = useMemo(
    () =>
      settings ? { username: settings.username, token: settings.token } : null,
    // Intentionally only the account fields: preference changes (e.g. theme)
    // must not change the memo identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings?.username, settings?.token],
  )

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const load = useCallback(async (account: Pick<Settings, 'username' | 'token'>) => {
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    setError(null)
    setProgress(null)

    // Attempt to show cache immediately (stale-while-revalidate)
    try {
      const [cached, years] = await Promise.all([
        getCachedCollection(account.username),
        getMasterYears(),
      ])
      if (controller.signal.aborted) return
      if (cached) {
        setReleases(cached.releases)
        setFolders(cached.folders ?? [])
        setStatus('idle')
        setFetchedAt(cached.fetchedAt)
      }
      setMasterYearsState(years)
    } catch {
      // ignore cache read errors
    }

    setStatus('loading')

    try {
      const folders = await fetchFolders(account.username, account.token, controller.signal)
      if (controller.signal.aborted) return
      setFolders(folders)

      const result: CollectionResult = await fetchCollection(
        account.username,
        account.token,
        (p) => {
          if (!controller.signal.aborted) setProgress({ phase: 'collection', ...p })
        },
        controller.signal,
      )

      if (controller.signal.aborted) return

      // Content-first: show the collection immediately, then enrich original
      // release years in the background so a slow master step never blocks the
      // first paint. `status` stays 'loading' so the sync banner shows the year
      // progress while the grid is already interactive.
      setReleases(result.releases)
      setFetchedAt(Date.now())
      await setCachedCollection(account.username, {
        username: account.username,
        fetchedAt: Date.now(),
        releases: result.releases,
        items: result.items,
        folders,
      })

      const masterIds = [
        ...new Set(
          result.releases
            .map((r) => r.basic_information?.master_id)
            // 0 is Discogs' "no master linked" marker, not a real id: those
            // releases have no original year to fetch and fall back to their
            // pressing year, so never request /masters/0.
            .filter((id): id is number => typeof id === 'number' && id > 0),
        ),
      ]

      const knownYears = await getMasterYears().catch(() => ({} as MasterYears))
      const missing = masterIds.filter((id) => !(id in knownYears))

      if (missing.length > 0) {
        let mergedYears = { ...knownYears }
        try {
          const fetched = await fetchMasterYears(
            missing,
            account.token,
            (loaded, total) => {
              if (!controller.signal.aborted) setProgress({ phase: 'years', loaded, total })
            },
            controller.signal,
            (id, year) => {
              if (controller.signal.aborted) return
              // New object each time so the state change is picked up.
              mergedYears = { ...mergedYears, [id]: year }
              setMasterYearsState(mergedYears)
            },
          )
          mergedYears = { ...knownYears, ...fetched }
        } catch (err) {
          if (controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          // Year enrichment is a progressive nicety, not a hard failure:
          // keep whatever already streamed in and finish loading.
        }

        if (controller.signal.aborted) return
        setMasterYearsState(mergedYears)
        await setMasterYears(mergedYears)
      }

      if (controller.signal.aborted) return
      setProgress(null)
      setStatus('idle')
    } catch (err) {
      if (controller.signal.aborted) return
      if (err instanceof DOMException && err.name === 'AbortError') return

      const message = err instanceof Error ? err.message : 'Unknown error occurred.'
      setProgress(null)
      setError(message)
      setStatus('error')
    }
  }, [])

  const refresh = useCallback(() => {
    if (!account) return
    void load(account)
  }, [account, load])

  const wipeCache = useCallback(async () => {
    if (!account) return
    // "Clear everything" must reclaim every byte, including the service-worker
    // album-art runtime cache, and stop any collection sync still in flight.
    abortRef.current?.abort()
    await Promise.allSettled([
      removeCachedCollection(account.username),
      clearMasterYears(),
      clearReleaseDetails(),
      clearReleaseGatefolds(),
      removeCachedCollectionValue(account.username),
      clearAlbumArtCache(),
    ])
    setReleases([])
    setFolders([])
    setMasterYearsState({})
    setError(null)
    setStatus('idle')
  }, [account])

  // Load on mount and when the account changes.
  useEffect(() => {
    if (!account) {
      // Reset all state when the account is cleared.
      /* eslint-disable react-hooks/set-state-in-effect */
      setReleases([])
      setFolders([])
      setMasterYearsState({})
      setStatus('idle')
      setError(null)
      setProgress(null)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }
    void load(account)
    // Intentionally keyed on the account, not the whole settings object, so
    // preference-only changes (e.g. the UI theme) don't re-fetch the whole
    // collection. load() itself is stable.
  }, [account, load])

  return { releases, folders, masterYears, status, error, progress, fetchedAt, refresh, wipeCache }
}