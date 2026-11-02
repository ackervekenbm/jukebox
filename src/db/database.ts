// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { openDB } from 'idb'

export const DB_NAME = 'vinyl-vault'

/**
 * Schema version. Bump when a store is added or a row shape changes so every
 * browser re-runs the upgrade below. v5 added the listenLog store, v6 the
 * cabinet store, v7 the releaseSleeves store (release notes for the gatefold
 * check).
 */
export const VERSION = 7

/** Every object store the app uses; the upgrade creates any that are missing. */
const STORES = [
  'collection',
  'masterYears',
  'releaseDetails',
  'collectionValue',
  'listenLog',
  'cabinet',
  'releaseSleeves',
]

/**
 * Where the shared connection stands when another tab gets in the way of an
 * upgrade:
 * - 'blocked' — this tab needs a newer schema, and a tab still on the old one
 *   holds the database open; nothing loads until that tab closes.
 * - 'outdated' — another tab opened a newer schema; this tab closed its
 *   connection to let it, and must reload.
 */
export type DatabaseState = 'ok' | 'blocked' | 'outdated'

let state: DatabaseState = 'ok'
const listeners = new Set<(state: DatabaseState) => void>()

function setState(next: DatabaseState) {
  state = next
  for (const listener of listeners) listener(next)
}

export function getDatabaseState(): DatabaseState {
  return state
}

/** Calls `listener` whenever the state changes; returns the unsubscribe. */
export function subscribeDatabaseState(listener: (state: DatabaseState) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * One shared connection (and one shared upgrade) for the whole app: idb opens
 * are idempotent per name/version, but a single promise keeps every store on
 * the same connection and the upgrade logic in exactly one place.
 */
export const dbPromise = openDB(DB_NAME, VERSION, {
  upgrade(db) {
    for (const name of STORES) {
      if (!db.objectStoreNames.contains(name)) {
        db.createObjectStore(name)
      }
    }
  },
  blocked() {
    setState('blocked')
  },
  blocking() {
    // Step aside, so the newer tab's upgrade isn't blocked by this one.
    void dbPromise.then((db) => db.close())
    setState('outdated')
  },
})

// A blocked upgrade goes through once the old tab closes.
void dbPromise.then(
  () => {
    if (state === 'blocked') setState('ok')
  },
  () => {},
)
