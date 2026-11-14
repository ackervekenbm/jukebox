// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { readJson, removeKey, writeJson } from './local'

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
  const groupPressings = (readJson(KEY) as { groupPressings?: unknown } | null)?.groupPressings
  return { groupPressings: typeof groupPressings === 'boolean' ? groupPressings : false }
}

export function savePreferences(preferences: Preferences): void {
  writeJson(KEY, { groupPressings: Boolean(preferences.groupPressings) })
}

export function clearPreferences(): void {
  removeKey(KEY)
}
