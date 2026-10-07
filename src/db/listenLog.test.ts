// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearListenLog,
  countListenEntries,
  getListenLog,
  getRecentListenIds,
  logListen,
  MAX_LISTEN_ENTRIES,
} from './listenLog'
import { dbPromise, VERSION } from './database'

beforeEach(async () => {
  await clearListenLog()
})

describe('listenLog store (fake IndexedDB)', () => {
  it('is created by the schema upgrade on the shared connection', async () => {
    const db = await dbPromise
    expect(db.version).toBe(VERSION)
    expect(db.objectStoreNames.contains('listenLog')).toBe(true)
  })

  it('records picks newest first, one log per account', async () => {
    await logListen('alice', 1)
    await logListen('alice', 2)
    await logListen('bob', 9)

    expect(await getListenLog('alice')).toEqual([
      { id: 2, at: expect.any(Number) },
      { id: 1, at: expect.any(Number) },
    ])
    expect(await getListenLog('bob')).toEqual([{ id: 9, at: expect.any(Number) }])
    expect(await getListenLog('nobody')).toEqual([])
  })

  it('keeps only the newest entries once the cap is reached', async () => {
    for (let i = 1; i <= MAX_LISTEN_ENTRIES + 5; i++) {
      await logListen('alice', i)
    }

    const log = await getListenLog('alice')
    expect(log).toHaveLength(MAX_LISTEN_ENTRIES)
    expect(log[0].id).toBe(MAX_LISTEN_ENTRIES + 5)
    expect(log.at(-1)?.id).toBe(6)
  })

  it('serializes concurrent picks without losing any', async () => {
    await Promise.all([logListen('alice', 1), logListen('alice', 2), logListen('alice', 3)])

    expect((await getListenLog('alice')).map((entry) => entry.id)).toEqual([3, 2, 1])
  })

  it('hands out the last N ids for the skip window', async () => {
    await logListen('alice', 1)
    await logListen('alice', 2)
    await logListen('alice', 3)

    expect(await getRecentListenIds('alice', 2)).toEqual([3, 2])
    expect(await getRecentListenIds('alice', 0)).toEqual([])
    expect(await getRecentListenIds('alice', 99)).toEqual([3, 2, 1])
    expect(await countListenEntries('alice')).toBe(3)
  })

  it('clears one account or every account', async () => {
    await logListen('alice', 1)
    await logListen('bob', 2)

    await clearListenLog('alice')
    expect(await getListenLog('alice')).toEqual([])
    expect(await getListenLog('bob')).toHaveLength(1)

    await clearListenLog()
    expect(await getListenLog('bob')).toEqual([])
  })
})
