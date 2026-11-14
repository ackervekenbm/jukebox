// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { ThemeId } from '../theme'
import { isThemeId } from '../theme'
import { readJson, removeKey, writeJson } from './local'

export interface Settings {
  username: string
  token: string
  theme: ThemeId
}

const KEY = 'vinyl-vault:settings'

export function loadSettings(): Settings | null {
  const parsed = readJson(KEY) as Partial<Settings> | null
  if (!parsed?.username || !parsed.token) return null
  return { ...(parsed as Settings), theme: isThemeId(parsed.theme) ? parsed.theme : 'midnight' }
}

export function saveSettings(settings: Settings): void {
  writeJson(KEY, settings)
}

export function clearSettings(): void {
  removeKey(KEY)
}
