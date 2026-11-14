// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { SavedView } from '../utils/views'
import { readJson, removeKey, writeJson } from './local'
import {
  MAX_SAVED_VIEWS,
  normalizeSavedView,
  isSavedView,
} from '../utils/views'

const KEY = 'vinyl-vault:views'

/**
 * Saved views are pure filter definitions, so they are stored once for the
 * browser (not per account) and cost no API calls. Anything unexpected in
 * storage is dropped rather than allowed to break the toolbar, and the list is
 * capped so a corrupted payload can never blow up localStorage.
 */
export function loadViews(): SavedView[] {
  const parsed = readJson(KEY)
  if (!Array.isArray(parsed)) return []

  const views: SavedView[] = []
  const seen = new Set<string>()
  for (const entry of parsed) {
    const view = normalizeSavedView(entry)
    if (!view || seen.has(view.id)) continue
    seen.add(view.id)
    views.push(view)
    if (views.length >= MAX_SAVED_VIEWS) break
  }
  return views
}

export function saveViews(views: SavedView[]): void {
  writeJson(KEY, views.filter(isSavedView).slice(0, MAX_SAVED_VIEWS))
}

export function clearViews(): void {
  removeKey(KEY)
}
