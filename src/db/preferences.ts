// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

const KEY = 'vinyl-vault:prefs'

/**
 * Display preferences that are not tied to an account and not part of a saved
 * view — the same category as the theme and the picker window.
 */
export interface Preferences {
  /** Collapse every pressing of a master into one stacked card. */
  groupPressings: boolean
}

export const DEFAULT_PREFERENCES: Preferences = { groupPressings: false }

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES }
    const parsed: unknown = JSON.parse(raw)
    const groupPressings = (parsed as { groupPressings?: unknown } | null)?.groupPressings
    return { groupPressings: typeof groupPressings === 'boolean' ? groupPressings : false }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ groupPressings: Boolean(preferences.groupPressings) }),
    )
  } catch {
    // Storage can be blocked; keep the in-memory preference working.
  }
}

export function clearPreferences(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Ignore; nothing else to do if storage is unavailable.
  }
}
