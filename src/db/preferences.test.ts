// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFERENCES,
  clearPreferences,
  loadPreferences,
  savePreferences,
} from './preferences'

const KEY = 'vinyl-vault:prefs'

afterEach(() => localStorage.clear())

describe('preferences', () => {
  it('defaults to off', () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES)
    expect(loadPreferences().groupPressings).toBe(false)
  })

  it('round-trips the grouping preference', () => {
    savePreferences({ groupPressings: true })
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({ groupPressings: true })
    expect(loadPreferences()).toEqual({ groupPressings: true })
  })

  it('falls back to the default for malformed or unexpected storage', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadPreferences().groupPressings).toBe(false)

    localStorage.setItem(KEY, JSON.stringify({ groupPressings: 'yes' }))
    expect(loadPreferences().groupPressings).toBe(false)

    localStorage.setItem(KEY, JSON.stringify({}))
    expect(loadPreferences().groupPressings).toBe(false)
  })

  it('clears the key', () => {
    savePreferences({ groupPressings: true })
    clearPreferences()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(loadPreferences().groupPressings).toBe(false)
  })
})
