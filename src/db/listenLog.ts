// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { dbPromise } from './database'

const STORE = 'listenLog'

/** How many picks we remember per account — a year of casual shuffling. */
export const MAX_LISTEN_ENTRIES = 200

export interface ListenEntry {
  /** Discogs release id (the album, not the collection instance). */
  id: number
  /** Epoch milliseconds when the picker chose it. */
  at: number
}

interface ListenRow {
  username: string
  entries: ListenEntry[]
}

/**
 * Writes are funneled through one promise chain: two picks landing in the
 * same tick would otherwise read-modify-write the same row concurrently and
 * the older write could clobber the newer one.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

async function readRow(username: string): Promise<ListenRow> {
  const db = await dbPromise
  const row = (await db.get(STORE, username)) as ListenRow | undefined
  return row ?? { username, entries: [] }
}

/** The full log for an account, newest pick first. */
export async function getListenLog(username: string): Promise<ListenEntry[]> {
  const row = await readRow(username)
  return row.entries
}

/** The ids of the last `count` picks, newest first. */
export async function getRecentListenIds(username: string, count: number): Promise<number[]> {
  const entries = await getListenLog(username)
  return entries.slice(0, Math.max(0, count)).map((entry) => entry.id)
}

/** Records a pick; the oldest entries fall off once the cap is reached. */
export function logListen(username: string, releaseId: number): Promise<void> {
  const write = async () => {
    const row = await readRow(username)
    const entries: ListenEntry[] = [{ id: releaseId, at: Date.now() }, ...row.entries].slice(
      0,
      MAX_LISTEN_ENTRIES,
    )
    const db = await dbPromise
    await db.put(STORE, { username, entries } satisfies ListenRow, username)
  }
  // Run even if a previous write failed, so one storage error cannot wedge
  // the queue for every later pick.
  writeQueue = writeQueue.then(write, write)
  return writeQueue as Promise<void>
}

/** Forgets one account's log (or every account's when no name is given). */
export async function clearListenLog(username?: string): Promise<void> {
  const write = async () => {
    const db = await dbPromise
    if (username) await db.delete(STORE, username)
    else await db.clear(STORE)
  }
  writeQueue = writeQueue.then(write, write)
  await writeQueue
}

/** How many picks are remembered for an account (storage diagnostics). */
export async function countListenEntries(username: string): Promise<number> {
  const row = await readRow(username)
  return row.entries.length
}
