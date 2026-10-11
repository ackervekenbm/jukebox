// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type {
  CollectionValue,
  DiscogsCollectionFolder,
  DiscogsCollectionRelease,
  DiscogsTrack,
} from '../types/discogs'
import type { MasterYears } from '../api/discogs'
import { dbPromise } from './database'

export interface CachedCollection {
  username: string
  fetchedAt: number
  releases: DiscogsCollectionRelease[]
  items: number
  folders: DiscogsCollectionFolder[]
}

export interface CachedCollectionValue {
  value: CollectionValue
  fetchedAt: number
}

const STORE = 'collection'
const MASTER_STORE = 'masterYears'
const DETAIL_STORE = 'releaseDetails'
const VALUE_STORE = 'collectionValue'
const MASTER_KEY = 'all'

export async function getCachedCollection(username: string): Promise<CachedCollection | undefined> {
  const db = await dbPromise
  const entry = await db.get(STORE, username)
  return entry as CachedCollection | undefined
}

export async function setCachedCollection(username: string, entry: CachedCollection): Promise<void> {
  const db = await dbPromise
  await db.put(STORE, entry, username)
}

export async function removeCachedCollection(username: string): Promise<void> {
  const db = await dbPromise
  await db.delete(STORE, username)
}

export async function getMasterYears(): Promise<MasterYears> {
  const db = await dbPromise
  const entry = await db.get(MASTER_STORE, MASTER_KEY)
  return (entry as MasterYears | undefined) ?? {}
}

export async function setMasterYears(years: MasterYears): Promise<void> {
  const db = await dbPromise
  await db.put(MASTER_STORE, years, MASTER_KEY)
}

export async function clearMasterYears(): Promise<void> {
  const db = await dbPromise
  await db.delete(MASTER_STORE, MASTER_KEY)
}

export async function getReleaseTracklist(releaseId: number): Promise<DiscogsTrack[] | undefined> {
  const db = await dbPromise
  return (await db.get(DETAIL_STORE, releaseId)) as DiscogsTrack[] | undefined
}

export async function setReleaseTracklist(releaseId: number, tracks: DiscogsTrack[]): Promise<void> {
  const db = await dbPromise
  await db.put(DETAIL_STORE, tracks, releaseId)
}

export async function clearReleaseDetails(): Promise<void> {
  const db = await dbPromise
  await db.clear(DETAIL_STORE)
}

export async function countReleaseDetails(): Promise<number> {
  const db = await dbPromise
  return await db.count(DETAIL_STORE)
}

// Market value cache, one row per account: the valuation belongs to a
// collection, so it is keyed by username rather than stored as one global row.
export async function getCachedCollectionValue(
  username: string,
): Promise<CachedCollectionValue | undefined> {
  const db = await dbPromise
  return (await db.get(VALUE_STORE, username)) as CachedCollectionValue | undefined
}

export async function setCachedCollectionValue(
  username: string,
  entry: CachedCollectionValue,
): Promise<void> {
  const db = await dbPromise
  await db.put(VALUE_STORE, entry, username)
}

export async function removeCachedCollectionValue(username: string): Promise<void> {
  const db = await dbPromise
  await db.delete(VALUE_STORE, username)
}