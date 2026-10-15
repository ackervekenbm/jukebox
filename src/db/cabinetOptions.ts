// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { CabinetSortMode } from '../utils/cabinet'
import { DEFAULT_PLAN_OPTIONS } from '../utils/cabinet'

const KEY = 'vinyl-vault:cabinet-options'

export interface CabinetOptions {
  sort: CabinetSortMode
  /** Keep each record size in its own shelf where the space allows. */
  separateSizeClasses: boolean
}

export const DEFAULT_CABINET_OPTIONS: CabinetOptions = { ...DEFAULT_PLAN_OPTIONS }

const SORTS: readonly CabinetSortMode[] = ['artist', 'title', 'year']

/**
 * How the shelves are laid out. A per-device view preference like the theme,
 * so it stays in localStorage and never travels with the synced cabinet.
 */
export function loadCabinetOptions(): CabinetOptions {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_CABINET_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<CabinetOptions> | null
    const sort = parsed?.sort
    return {
      sort: sort && SORTS.includes(sort) ? sort : DEFAULT_CABINET_OPTIONS.sort,
      separateSizeClasses:
        typeof parsed?.separateSizeClasses === 'boolean'
          ? parsed.separateSizeClasses
          : DEFAULT_CABINET_OPTIONS.separateSizeClasses,
    }
  } catch {
    return { ...DEFAULT_CABINET_OPTIONS }
  }
}

export function saveCabinetOptions(options: CabinetOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(options))
  } catch {
    // Storage may be unavailable (private mode); the in-memory choice still holds.
  }
}
