// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

/*
 * localStorage access for the small browser-wide settings (settings, views,
 * picker, preferences, cabinet options). Storage can be blocked (private mode,
 * quota, disabled cookies), so every call swallows that and the app keeps
 * working in memory. Each caller still validates what it reads back.
 *
 * Keys keep the `vinyl-vault:` prefix (the app's name before Jukebox) so
 * existing browsers keep their settings; the IndexedDB name is the same.
 */

/** The parsed JSON under `key`, or null when it is missing, unreadable or not JSON. */
export function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage is blocked or full: the in-memory value still holds.
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage is blocked: nothing to remove.
  }
}

/** Removes every key starting with `prefix` ("clear everything"). */
export function removeKeysStartingWith(prefix: string): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // Storage is blocked: nothing to remove.
  }
}
