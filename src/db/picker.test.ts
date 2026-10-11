// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampSkip,
  clearPickerConfig,
  DEFAULT_SKIP,
  loadPickerConfig,
  MAX_SKIP,
  savePickerConfig,
} from './picker'

const KEY = 'vinyl-vault:picker'

beforeEach(() => {
  localStorage.clear()
})

describe('picker config (localStorage)', () => {
  it('defaults to the standard skip window when nothing is stored', () => {
    expect(loadPickerConfig()).toEqual({ skip: DEFAULT_SKIP })
  })

  it('round-trips a saved preference', () => {
    savePickerConfig({ skip: 25 })
    expect(loadPickerConfig()).toEqual({ skip: 25 })
  })

  it('clamps on save and on load', () => {
    savePickerConfig({ skip: 999 })
    expect(loadPickerConfig()).toEqual({ skip: MAX_SKIP })
    savePickerConfig({ skip: -7 })
    expect(loadPickerConfig()).toEqual({ skip: 0 })

    // Hand-edited storage is clamped too.
    localStorage.setItem(KEY, JSON.stringify({ skip: 4200 }))
    expect(loadPickerConfig()).toEqual({ skip: MAX_SKIP })
  })

  it('falls back to the default when storage is corrupt or wrong-shaped', () => {
    localStorage.setItem(KEY, 'not json')
    expect(loadPickerConfig()).toEqual({ skip: DEFAULT_SKIP })

    localStorage.setItem(KEY, JSON.stringify({ skip: 'lots' }))
    expect(loadPickerConfig()).toEqual({ skip: DEFAULT_SKIP })

    localStorage.setItem(KEY, JSON.stringify({ skip: null }))
    expect(loadPickerConfig()).toEqual({ skip: DEFAULT_SKIP })
  })

  it('rounds and rejects nonsense input through clampSkip', () => {
    expect(clampSkip(10.6)).toBe(11)
    expect(clampSkip(Number.NaN)).toBe(DEFAULT_SKIP)
    expect(clampSkip(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SKIP)
  })

  it('removes the key on clear', () => {
    savePickerConfig({ skip: 3 })
    clearPickerConfig()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(loadPickerConfig()).toEqual({ skip: DEFAULT_SKIP })
  })
})
