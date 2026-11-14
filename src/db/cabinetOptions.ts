// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { CabinetOptions } from '../shared/cabinetDoc'
import type { CabinetSortMode } from '../utils/cabinet'
import { DEFAULT_PLAN_OPTIONS } from '../utils/cabinet'
import { readJson, writeJson } from './local'

const KEY = 'vinyl-vault:cabinet-options'

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
  const parsed = readJson(KEY) as Partial<Record<keyof CabinetOptions, unknown>> | null
  const stored = parsed?.sort
  const sort =
    typeof stored === 'string' && SORTS.includes(stored as CabinetSortMode)
      ? (stored as CabinetSortMode)
      : typeof stored === 'string' && Object.hasOwn(LEGACY_SORTS, stored)
        ? LEGACY_SORTS[stored]
        : DEFAULT_CABINET_OPTIONS.sort
  return {
    sort,
    separateSizeClasses:
      typeof parsed?.separateSizeClasses === 'boolean'
        ? parsed.separateSizeClasses
        : DEFAULT_CABINET_OPTIONS.separateSizeClasses,
  }
}

export function saveCabinetOptions(options: CabinetOptions): void {
  writeJson(KEY, options)
}
