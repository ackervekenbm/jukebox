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
    saveCabinetOptions({ sort: 'year', separateSizeClasses: false })
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({
      sort: 'year',
      separateSizeClasses: false,
    })
    expect(loadCabinetOptions()).toEqual({ sort: 'year', separateSizeClasses: false })
  })

  it('falls back per field for malformed storage', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadCabinetOptions()).toEqual(DEFAULT_CABINET_OPTIONS)

    localStorage.setItem(KEY, JSON.stringify({ sort: 'genre', separateSizeClasses: 'yes' }))
    expect(loadCabinetOptions()).toEqual(DEFAULT_CABINET_OPTIONS)
  })
})
