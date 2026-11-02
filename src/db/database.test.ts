// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { deleteDB, openDB } from 'idb'

const load = async () => {
  vi.resetModules()
  return import('./database')
}

beforeEach(async () => {
  await deleteDB('vinyl-vault')
})

describe('database upgrades with other tabs open', () => {
  it('reports a blocked upgrade until the old tab closes, then carries on', async () => {
    // A tab still on the previous schema, from before upgrades were handled.
    const oldTab = await openDB('vinyl-vault', 6)

    const database = await load()
    await waitFor(() => expect(database.getDatabaseState()).toBe('blocked'))

    oldTab.close()
    const db = await database.dbPromise
    expect(db.objectStoreNames.contains('releaseSleeves')).toBe(true)
    await waitFor(() => expect(database.getDatabaseState()).toBe('ok'))
  })

  it('steps aside for a newer tab and asks to reload', async () => {
    const database = await load()
    await database.dbPromise
    const states: string[] = []
    database.subscribeDatabaseState((state) => states.push(state))

    // A newer version of the app opens the next schema in another tab.
    const newerTab = await openDB('vinyl-vault', database.VERSION + 1)

    expect(database.getDatabaseState()).toBe('outdated')
    expect(states).toEqual(['outdated'])
    newerTab.close()
  })
})
