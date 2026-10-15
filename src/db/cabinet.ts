// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { CabinetDoc } from '../shared/cabinetDoc'
import { dbPromise } from './database'

const STORE = 'cabinet'

export interface CabinetRow {
  username: string
  doc: CabinetDoc
  /** Server revision the local copy is based on (0 = never synced). */
  revision: number
  /** True while local edits have not been pushed to the server. */
  dirty: boolean
}

/**
 * Writes go through one promise chain: two edits landing in the same tick would
 * otherwise read-modify-write the same row concurrently and the older write
 * could clobber the newer one. Mirrors the listenLog store.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(write: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(write, write)
  writeQueue = run.catch(() => undefined)
  return run
}

/** The stored cabinet for an account, or null when it was never planned. */
export async function getCabinet(username: string): Promise<CabinetRow | null> {
  const db = await dbPromise
  const row = (await db.get(STORE, username)) as CabinetRow | undefined
  return row ?? null
}

/**
 * Read-modify-writes an account's cabinet on the write queue, so an edit that
 * starts while another is still in flight still sees the other's result.
 * Return null from `update` to delete the row.
 */
export function updateCabinet(
  username: string,
  update: (row: CabinetRow | null) => CabinetRow | null,
): Promise<CabinetRow | null> {
  return enqueue(async () => {
    const db = await dbPromise
    const current = ((await db.get(STORE, username)) as CabinetRow | undefined) ?? null
    const next = update(current)
    if (next === null) {
      if (current) await db.delete(STORE, username)
      return null
    }
    await db.put(STORE, next satisfies CabinetRow, username)
    return next
  })
}

/** Creates or replaces an account's cabinet. */
export function putCabinet(row: CabinetRow): Promise<void> {
  return updateCabinet(row.username, () => row).then(() => undefined)
}

/** Forgets one account's cabinet (or every account's when no name is given). */
export function clearCabinet(username?: string): Promise<void> {
  return enqueue(async () => {
    const db = await dbPromise
    if (username) await db.delete(STORE, username)
    else await db.clear(STORE)
  })
}
