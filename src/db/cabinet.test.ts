// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { beforeEach, describe, expect, it } from 'vitest'
import type { CabinetDoc } from '../shared/cabinetDoc'
import { clearCabinet, getCabinet, putCabinet, updateCabinet } from './cabinet'
import { dbPromise, VERSION } from './database'

function doc(updatedAt: string): CabinetDoc {
  return {
    schemaVersion: 1,
    cabinets: [{ id: 'c1', name: 'Main', slots: [{ id: 's1', label: 'A', capacity: 40 }] }],
    placements: { '1-1': 's1' },
    overrides: {},
    unplaced: [],
    updatedAt,
  }
}

beforeEach(async () => {
  await clearCabinet()
})

describe('cabinet store (fake IndexedDB)', () => {
  it('is created by the schema upgrade on the shared connection', async () => {
    const db = await dbPromise
    expect(db.version).toBe(VERSION)
    expect(db.objectStoreNames.contains('cabinet')).toBe(true)
  })

  it('round-trips a cabinet per account', () => {
    const alice = { username: 'alice', doc: doc('2026-01-01T00:00:00.000Z'), revision: 3, dirty: false }
    return putCabinet(alice)
      .then(() => expect(getCabinet('alice')).resolves.toEqual(alice))
      .then(() => expect(getCabinet('bob')).resolves.toBeNull())
  })

  it('replaces an existing row', async () => {
    await putCabinet({ username: 'alice', doc: doc('2020-01-01T00:00:00.000Z'), revision: 1, dirty: false })
    const next = doc('2021-01-01T00:00:00.000Z')
    await putCabinet({ username: 'alice', doc: next, revision: 2, dirty: true })

    const row = await getCabinet('alice')
    expect(row?.doc).toEqual(next)
    expect(row?.revision).toBe(2)
    expect(row?.dirty).toBe(true)
  })

  it('serializes concurrent read-modify-writes', async () => {
    await putCabinet({
      username: 'alice',
      doc: doc('2020-01-01T00:00:00.000Z'),
      revision: 0,
      dirty: false,
    })
    await Promise.all(
      [0, 1, 2].map(() =>
        updateCabinet('alice', (row) => (row ? { ...row, revision: row.revision + 1 } : row)),
      ),
    )

    expect((await getCabinet('alice'))?.revision).toBe(3)
  })

  it('deletes a row when the updater returns null', async () => {
    await putCabinet({ username: 'alice', doc: doc('2020-01-01T00:00:00.000Z'), revision: 1, dirty: false })
    expect(await updateCabinet('alice', () => null)).toBeNull()
    expect(await getCabinet('alice')).toBeNull()
  })

  it('clears one account or every account', async () => {
    const base = { doc: doc('2020-01-01T00:00:00.000Z'), revision: 1, dirty: false }
    await putCabinet({ username: 'alice', ...base })
    await putCabinet({ username: 'bob', ...base })

    await clearCabinet('alice')
    expect(await getCabinet('alice')).toBeNull()
    expect(await getCabinet('bob')).not.toBeNull()

    await clearCabinet()
    expect(await getCabinet('bob')).toBeNull()
  })

  it('is created by the v6 upgrade on the shared connection', async () => {
    const db = await dbPromise
    expect(db.objectStoreNames.contains('cabinet')).toBe(true)
    expect(VERSION).toBeGreaterThanOrEqual(6)
  })
})
