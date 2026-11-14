// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS } from '../utils/collection'
import { saveCabinetOptions } from './cabinetOptions'
import { dbPromise } from './database'
import { savePickerConfig } from './picker'
import { savePreferences } from './preferences'
import { saveSettings } from './settings'
import { saveViews } from './views'
import { clearAllLocalData, STORAGE_PREFIX } from './wipe'

async function storeCounts(): Promise<Record<string, number>> {
  const db = await dbPromise
  const counts: Record<string, number> = {}
  for (const name of db.objectStoreNames) counts[name] = await db.count(name)
  return counts
}

beforeEach(() => localStorage.clear())

describe('clearAllLocalData', () => {
  it('empties every IndexedDB store, including ones added later', async () => {
    const db = await dbPromise
    for (const name of db.objectStoreNames) await db.put(name, { probe: true }, 'probe')
    expect(Object.values(await storeCounts()).every((count) => count > 0)).toBe(true)

    await clearAllLocalData()

    expect(Object.values(await storeCounts()).every((count) => count === 0)).toBe(true)
  })

  it("removes every app setting from localStorage, and nothing that isn't the app's", async () => {
    saveSettings({ username: 'alice', token: 'tok', theme: 'paper' })
    saveViews([{ id: 'v', name: 'Jazz', query: 'jazz', filters: DEFAULT_FILTERS }])
    savePickerConfig({ skip: 5 })
    savePreferences({ groupPressings: true })
    saveCabinetOptions({ sort: 'byName', separateSizeClasses: true })
    localStorage.setItem('another-app', 'keep me')

    await clearAllLocalData()

    const left = Object.keys(localStorage)
    expect(left.filter((key) => key.startsWith(STORAGE_PREFIX))).toEqual([])
    expect(left).toEqual(['another-app'])
  })
})
