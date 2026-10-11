// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { getCachedCollection, getMasterYears, countReleaseDetails } from '../db/collection'
import { countListenEntries } from '../db/listenLog'
import type { MasterYears } from '../api/discogs'

const encoder = new TextEncoder()
const byteSize = (value: string): number => encoder.encode(value).byteLength

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

/* -------------------------------------------------------------------------- */
/*  Origin-level (secure-context only)                                         */
/* -------------------------------------------------------------------------- */

export interface OriginStorageStat {
  quota: number
  usage: number
}

export async function getStorageEstimate(): Promise<OriginStorageStat | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const est = await navigator.storage.estimate()
    if (typeof est.quota !== 'number' || typeof est.usage !== 'number') return null
    return { quota: est.quota, usage: est.usage }
  } catch {
    return null
  }
}

export async function getPersistedState(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null
    return await navigator.storage.persisted()
  } catch {
    return null
  }
}

export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/*  IndexedDB                                                                 */
/* -------------------------------------------------------------------------- */

export interface CollectionCacheStat {
  username: string
  fetchedAt: number | null
  releaseCount: number
  folderCount: number
  items: number
  uniqueMasters: number
  bytes: number
}

export interface MasterYearsStat {
  cachedIds: number
  withYear: number
  bytes: number
}

export interface IndexedDbStat {
  collection: CollectionCacheStat | null
  masterYears: MasterYearsStat
  detailCount: number
  listenCount: number
}

export async function scanIndexedDb(username: string): Promise<IndexedDbStat> {
  const collection = await getCachedCollection(username).catch(() => undefined)
  const years: MasterYears = await getMasterYears().catch(() => ({} as MasterYears))
  const detailCount = await countReleaseDetails().catch(() => 0)
  const listenCount = await countListenEntries(username).catch(() => 0)

  const collectionStat: CollectionCacheStat | null = collection
    ? (() => {
        const masters = new Set<number>()
        for (const r of collection.releases) {
          const id = r.basic_information?.master_id
          if (typeof id === 'number') masters.add(id)
        }
        return {
          username: collection.username,
          fetchedAt: collection.fetchedAt,
          releaseCount: collection.releases.length,
          folderCount: collection.folders?.length ?? 0,
          items: collection.items,
          uniqueMasters: masters.size,
          bytes: byteSize(JSON.stringify(collection)),
        }
      })()
    : null

  const ids = Object.keys(years).map(Number)
  const withYear = ids.filter((id) => typeof years[id] === 'number').length

  return {
    collection: collectionStat,
    masterYears: {
      cachedIds: ids.length,
      withYear,
      bytes: byteSize(JSON.stringify(years)),
    },
    detailCount,
    listenCount,
  }
}

/* -------------------------------------------------------------------------- */
/*  Cache Storage (secure-context only)                                        */
/* -------------------------------------------------------------------------- */

export interface CacheStoreStat {
  name: string
  entries: number
  bytes: number | null
}

function cacheStorage(): CacheStorage | null {
  if (typeof caches === 'undefined') return null
  return caches
}

export async function scanCaches(): Promise<CacheStoreStat[] | null> {
  const cs = cacheStorage()
  if (!cs) return null
  try {
    const names = await cs.keys()
    const stats: CacheStoreStat[] = []
    for (const name of names) {
      const cache = await cs.open(name)
      const requests = await cache.keys()
      let bytes: number | null = null
      let measured = 0
      for (const request of requests) {
        const response = await cache.match(request)
        if (!response) continue
        const length = Number(response.headers.get('Content-Length'))
        if (Number.isFinite(length) && length > 0) {
          bytes = bytes === null ? 0 : bytes
          bytes += length
          measured++
        }
      }
      stats.push({ name, entries: requests.length, bytes: measured === 0 ? null : bytes })
    }
    return stats
  } catch {
    return null
  }
}

export async function clearAlbumArtCache(): Promise<boolean> {
  const cs = cacheStorage()
  if (!cs) return false
  try {
    await cs.delete('album-art')
    return true
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- */
/*  localStorage                                                               */
/* -------------------------------------------------------------------------- */

export interface LocalStorageStat {
  keys: number
  bytes: number
}

export function scanLocalStorage(): LocalStorageStat {
  try {
    let bytes = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key === null) continue
      const value = localStorage.getItem(key) ?? ''
      bytes += byteSize(key) + byteSize(value)
    }
    return { keys: localStorage.length, bytes }
  } catch {
    return { keys: 0, bytes: 0 }
  }
}

/* -------------------------------------------------------------------------- */
/*  Aggregate                                                                  */
/* -------------------------------------------------------------------------- */

export interface StorageStats {
  origin: OriginStorageStat | null
  persisted: boolean | null
  indexedDb: IndexedDbStat
  caches: CacheStoreStat[] | null
  localStorage: LocalStorageStat
}

export async function gatherStorageStats(username: string): Promise<StorageStats> {
  const [origin, persisted, indexedDb, caches] = await Promise.all([
    getStorageEstimate(),
    getPersistedState(),
    scanIndexedDb(username),
    scanCaches(),
  ])
  return { origin, persisted, indexedDb, caches, localStorage: scanLocalStorage() }
}
