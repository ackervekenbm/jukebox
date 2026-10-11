// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { openDB } from 'idb'

export const DB_NAME = 'vinyl-vault'

/**
 * Schema version. Bump when a store is added or a row shape changes so every
 * browser re-runs the upgrade below. v5 added the listenLog store.
 */
export const VERSION = 5

/** Every object store the app uses; the upgrade creates any that are missing. */
const STORES = ['collection', 'masterYears', 'releaseDetails', 'collectionValue', 'listenLog']

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
})
