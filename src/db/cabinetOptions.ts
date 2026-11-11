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

const SORTS: readonly CabinetSortMode[] = ['chronological', 'byName']

/**
 * Older versions stored a whole-cabinet order (`artist`, `title`, `year`).
 * Map them onto the in-artist order closest to them.
 */
const LEGACY_SORTS: Record<string, CabinetSortMode> = {
  artist: 'chronological',
  year: 'chronological',
  title: 'byName',
}

/**
 * How the shelves are laid out. Synced with the cabinet (#168); this copy only
 * seeds a cabinet saved before options synced, and works without an account.
 */
export function loadCabinetOptions(): CabinetOptions {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_CABINET_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<CabinetOptions> | null
    const stored: string | undefined = parsed?.sort
    const sort =
      stored && SORTS.includes(stored as CabinetSortMode)
        ? (stored as CabinetSortMode)
        : stored && Object.hasOwn(LEGACY_SORTS, stored)
          ? LEGACY_SORTS[stored]
          : DEFAULT_CABINET_OPTIONS.sort
    return {
      sort,
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
