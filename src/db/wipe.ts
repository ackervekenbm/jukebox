// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { clearAlbumArtCache } from '../utils/storage'
import { dbPromise } from './database'
import { removeKeysStartingWith } from './local'

/** Every localStorage key the app writes starts with this (its name before Jukebox). */
export const STORAGE_PREFIX = 'vinyl-vault:'

/**
 * "Clear everything" in this browser: every IndexedDB store, every app
 * localStorage key and the album-art cache. It walks the stores and keys that
 * exist instead of listing them, so one added later is cleared too. Each part
 * is attempted even when another fails.
 */
export async function clearAllLocalData(): Promise<void> {
  await Promise.allSettled([
    (async () => {
      const db = await dbPromise
      const names = [...db.objectStoreNames]
      const tx = db.transaction(names, 'readwrite')
      await Promise.all([...names.map((name) => tx.objectStore(name).clear()), tx.done])
    })(),
    Promise.resolve().then(() => removeKeysStartingWith(STORAGE_PREFIX)),
    clearAlbumArtCache(),
  ])
}
