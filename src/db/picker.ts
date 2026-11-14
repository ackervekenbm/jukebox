// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { readJson, removeKey, writeJson } from './local'

const KEY = 'vinyl-vault:picker'

/** How many recent picks the picker tries to avoid by default. */
export const DEFAULT_SKIP = 10
/** Upper bound for the skip window, so a typo can't mute the picker. */
export const MAX_SKIP = 100

export interface PickerConfig {
  /** Number of recent picks to avoid while they still leave a choice. */
  skip: number
}

export function clampSkip(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SKIP
  return Math.min(MAX_SKIP, Math.max(0, Math.round(value)))
}

/**
 * The picker preference is a plain browsing setting like the theme: stored
 * once for the browser, not per account, and anything unexpected in storage
 * falls back to the default instead of breaking the picker.
 */
export function loadPickerConfig(): PickerConfig {
  const skip = (readJson(KEY) as { skip?: unknown } | null)?.skip
  return { skip: typeof skip === 'number' ? clampSkip(skip) : DEFAULT_SKIP }
}

export function savePickerConfig(config: PickerConfig): void {
  writeJson(KEY, { skip: clampSkip(config.skip) })
}

export function clearPickerConfig(): void {
  removeKey(KEY)
}
