// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CABINET_OPTIONS,
  loadCabinetOptions,
  saveCabinetOptions,
} from './cabinetOptions'

const KEY = 'vinyl-vault:cabinet-options'

afterEach(() => localStorage.clear())

describe('cabinet options', () => {
  it('defaults to the plan defaults', () => {
    expect(loadCabinetOptions()).toEqual(DEFAULT_CABINET_OPTIONS)
  })

  it('round-trips both options', () => {
    saveCabinetOptions({ sort: 'byName', separateSizeClasses: false })
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({
      sort: 'byName',
      separateSizeClasses: false,
    })
    expect(loadCabinetOptions()).toEqual({ sort: 'byName', separateSizeClasses: false })
  })

  it('maps the old whole-cabinet orders onto the main view\'s in-artist order', () => {
    const stored = (sort: string) => {
      localStorage.setItem(KEY, JSON.stringify({ sort, separateSizeClasses: true }))
      return loadCabinetOptions().sort
    }
    expect(stored('artist')).toBe('chronological')
    expect(stored('year')).toBe('chronological')
    expect(stored('title')).toBe('byName')
  })

  it('falls back per field for malformed storage', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadCabinetOptions()).toEqual(DEFAULT_CABINET_OPTIONS)

    localStorage.setItem(KEY, JSON.stringify({ sort: 'genre', separateSizeClasses: 'yes' }))
    expect(loadCabinetOptions()).toEqual(DEFAULT_CABINET_OPTIONS)

    // Not fooled by names every object inherits.
    localStorage.setItem(KEY, JSON.stringify({ sort: 'toString', separateSizeClasses: false }))
    expect(loadCabinetOptions().sort).toBe(DEFAULT_CABINET_OPTIONS.sort)
  })
})
