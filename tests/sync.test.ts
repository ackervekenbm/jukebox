// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterAll, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import request from 'supertest'
import type { Express } from 'express'
import type { CabinetDoc, LegacyCabinetDoc } from '../src/shared/cabinetDoc'

const identityCalls = vi.hoisted(() => ({ count: 0 }))

const dataDir = `${process.env.TMPDIR ?? '/tmp'}/jukebox-sync-${process.pid}-${Date.now()}`
process.env.DATA_DIR = dataDir

const knownTokens: Record<string, string> = {
  'token-alice': 'alice',
  'token-bob': 'bob',
  'token-dave': 'dave',
}

vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
  const url = String(input)
  if (url.endsWith('/oauth/identity')) {
    const authorization = new Headers(init?.headers).get('authorization') ?? ''
    const match = /^Discogs token=(\S+)$/.exec(authorization)
    const username = match ? knownTokens[match[1]] : undefined
    if (!username) return new Response('Unauthorized', { status: 401 })
    identityCalls.count += 1
    return Response.json({ id: 1, username })
  }
  return new Response('Not Found', { status: 404 })
})

const { createApp, SYNC_BODY_LIMIT_BYTES } = await import('../src/server/app')
const { closeDb, getCabinetRow } = await import('../src/server/db')

const app: Express = createApp()

/** Every reply adds these, empty, for apps cached from before version 2. */
const EMPTY_FOR_OLDER_APPS = { placements: {}, overrides: {}, unplaced: [] }

const alice = { Authorization: 'Discogs token=token-alice' }
const bob = { Authorization: 'Discogs token=token-bob' }
const dave = { Authorization: 'Discogs token=token-dave' }

const cabinetsNamed = (name: string) => [
  {
    id: 'main',
    name,
    slots: [
      { id: 's1', label: 'Top left', capacity: 40 },
      { id: 's2', label: 'Top right', capacity: 40 },
    ],
  },
]

const sampleDoc = (
  name = 'Living room',
  updatedAt = '2026-10-15T10:00:00.000Z',
): CabinetDoc => ({
  schemaVersion: 2,
  cabinets: cabinetsNamed(name),
  sleeves: {},
  updatedAt,
})

/** As an app from before version 2 saves it: derived per-record fields, no sleeves. */
const legacyDoc = (name = 'Living room', records = 3): LegacyCabinetDoc => ({
  schemaVersion: 1,
  cabinets: cabinetsNamed(name),
  placements: Object.fromEntries(Array.from({ length: records }, (_, i) => [`${i}-${i}`, 's1'])),
  overrides: {},
  unplaced: [],
  updatedAt: '2026-10-15T10:00:00.000Z',
})

afterAll(async () => {
  vi.unstubAllGlobals()
  closeDb()
  await rm(dataDir, { recursive: true, force: true })
})

describe('GET /api/health', () => {
  it('reports a working database', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, db: true })
  })
})

describe('GET /api/sync/cabinet', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/sync/cabinet')
    expect(res.status).toBe(401)
  })

  it('rejects tokens Discogs refuses', async () => {
    const res = await request(app)
      .get('/api/sync/cabinet')
      .set('Authorization', 'Discogs token=token-mallory')
    expect(res.status).toBe(401)
  })

  it('returns a null document for a fresh account', async () => {
    const res = await request(app).get('/api/sync/cabinet').set(alice)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ username: 'alice', doc: null, etag: '"r0"' })
  })

  it('memoizes the identity check', async () => {
    const before = identityCalls.count
    await request(app).get('/api/sync/cabinet').set(alice)
    await request(app).get('/api/sync/cabinet').set(alice)
    expect(identityCalls.count).toBe(before)
  })
})

describe('PUT /api/sync/cabinet', () => {
  it('creates a document when the base revision matches', async () => {
    const doc = sampleDoc('Doc A')
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '"r0"')
      .send(doc)
    expect(res.status).toBe(200)
    expect(res.body.etag).toBe('"r1"')
    expect(res.body.doc).toEqual({ ...doc, ...EMPTY_FOR_OLDER_APPS })

    const get = await request(app).get('/api/sync/cabinet').set(alice)
    expect(get.body.doc).toEqual({ ...doc, ...EMPTY_FOR_OLDER_APPS })
    expect(get.body.etag).toBe('"r1"')
  })

  /**
   * A valid document whose JSON is exactly `bytes` long, filled with sleeve
   * calls (the one per-release field every document version has; keys are
   * release ids, so the last one is padded with digits).
   */
  const docOfSize = (bytes: number): CabinetDoc => {
    const sleeves: Record<string, boolean> = {}
    const build = (): CabinetDoc => ({ ...sampleDoc(), sleeves })
    const size = () => Buffer.byteLength(JSON.stringify(build()))
    // Each call adds "id":true plus a comma; count instead of re-serialising
    // the whole document per entry.
    let estimate = size()
    for (let i = 0; estimate < bytes - 64; i += 1) {
      const id = String(1_000_000 + i)
      sleeves[id] = true
      estimate += id.length + 8
    }
    const missing = bytes - size() - '"9":true,'.length
    sleeves['9'.repeat(missing + 1)] = true
    const doc = build()
    expect(Buffer.byteLength(JSON.stringify(doc))).toBe(bytes)
    return doc
  }

  it('takes a document right at the body limit', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(dave)
      .set('If-Match', '*')
      .send(docOfSize(SYNC_BODY_LIMIT_BYTES))
    expect(res.status).toBe(200)
  })

  it('refuses a document one byte over the limit with a JSON 413', async () => {
    const before = await request(app).get('/api/sync/cabinet').set(dave)
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(dave)
      .set('If-Match', '*')
      .send(docOfSize(SYNC_BODY_LIMIT_BYTES + 1))
    expect(res.status).toBe(413)
    expect(res.type).toBe('application/json')
    expect(res.body.error).toEqual(expect.any(String))

    // The refused save left the stored copy as it was.
    const after = await request(app).get('/api/sync/cabinet').set(dave)
    expect(after.body).toEqual(before.body)
  })

  it('rejects a stale base revision with the current document', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '"r0"')
      .send(sampleDoc('Doc B'))
    expect(res.status).toBe(409)
    expect(res.body.etag).toBe('"r1"')
    expect(res.body.doc.cabinets[0].name).toBe('Doc A')
  })

  it('advances the revision on a matching write', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '"r1"')
      .send(sampleDoc('Doc C', '2026-10-15T11:00:00.000Z'))
    expect(res.status).toBe(200)
    expect(res.body.etag).toBe('"r2"')

    const get = await request(app).get('/api/sync/cabinet').set(alice)
    expect(get.body.doc.cabinets[0].name).toBe('Doc C')
    expect(get.body.etag).toBe('"r2"')
  })

  it('requires an If-Match header', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .send(sampleDoc())
    expect(res.status).toBe(428)
  })

  it('rejects a malformed If-Match header', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', 'garbage')
      .send(sampleDoc())
    expect(res.status).toBe(400)
  })

  it('force-overwrites with If-Match: *', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '*')
      .send(sampleDoc('Doc D'))
    expect(res.status).toBe(200)
    expect(res.body.etag).toBe('"r3"')
  })

  it('rejects a document that fails schema validation', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '"r3"')
      .send({ schemaVersion: 2, cabinets: [], placements: {}, overrides: {}, unplaced: [], updatedAt: 'now' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid cabinet document')
  })

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '"r3"')
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(res.status).toBe(400)
  })

  it('keeps accounts isolated', async () => {
    const res = await request(app).get('/api/sync/cabinet').set(bob)
    expect(res.status).toBe(200)
    expect(res.body.username).toBe('bob')
    expect(res.body.doc).toBeNull()
    expect(res.body.etag).toBe('"r0"')
  })

  it('rejects a cabinet with two shelves sharing an id', async () => {
    const doubled = sampleDoc()
    doubled.cabinets[0].slots = [
      { id: 's1', label: 'Top left', capacity: 40 },
      { id: 's1', label: 'Top right', capacity: 40 },
    ]
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '*')
      .send(doubled)
    expect(res.status).toBe(400)
  })

  it('accepts a cabinet with every shelf removed', async () => {
    const empty = sampleDoc()
    empty.cabinets[0].slots = []
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '*')
      .send(empty)
    expect(res.status).toBe(200)

    const get = await request(app).get('/api/sync/cabinet').set(alice)
    expect(get.body.doc.cabinets[0].slots).toEqual([])
  })

  it('keeps the manual sleeve calls, and rejects ones that are not true/false', async () => {
    const doc = { ...sampleDoc(), sleeves: { '9160941': true, '42': false } }
    const res = await request(app).put('/api/sync/cabinet').set(alice).set('If-Match', '*').send(doc)
    expect(res.status).toBe(200)
    const get = await request(app).get('/api/sync/cabinet').set(alice)
    expect(get.body.doc.sleeves).toEqual({ '9160941': true, '42': false })

    const bad = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '*')
      .send({ ...sampleDoc(), sleeves: { '1': 'gatefold' } })
    expect(bad.status).toBe(400)

    const notAnId = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '*')
      .send({ ...sampleDoc(), sleeves: { abc: true } })
    expect(notAnId.status).toBe(400)
  })

  it('keeps the sleeve calls when an older app saves without them', async () => {
    const withCalls = { ...sampleDoc(), sleeves: { '9160941': true } }
    await request(app).put('/api/sync/cabinet').set(alice).set('If-Match', '*').send(withCalls)

    // A cached copy of the app from before sleeve calls existed renames it.
    const old = legacyDoc('Kitchen')
    const res = await request(app).put('/api/sync/cabinet').set(alice).set('If-Match', '*').send(old)
    expect(res.status).toBe(200)
    expect(res.body.doc.sleeves).toEqual({ '9160941': true })

    const get = await request(app).get('/api/sync/cabinet').set(alice)
    expect(get.body.doc.cabinets[0].name).toBe('Kitchen')
    expect(get.body.doc.sleeves).toEqual({ '9160941': true })
  })

  it('clears the sleeve calls when a current app saves none', async () => {
    await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '*')
      .send({ ...sampleDoc(), sleeves: { '9160941': true } })
    await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '*')
      .send({ ...sampleDoc(), sleeves: {} })

    const get = await request(app).get('/api/sync/cabinet').set(alice)
    expect(get.body.doc.sleeves).toEqual({})
  })
})

/** The document exactly as the server stored it. */
const storedDoc = (username: string): unknown => {
  const row = getCabinetRow(username)
  return row ? JSON.parse(row.doc) : null
}

describe('cabinet document versions', () => {
  it('accepts a version-1 save from an older app and stores it as version 2', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(bob)
      .set('If-Match', '*')
      .send(legacyDoc('Hall'))
    expect(res.status).toBe(200)
    expect(res.body.doc).toEqual({
      schemaVersion: 2,
      cabinets: cabinetsNamed('Hall'),
      updatedAt: '2026-10-15T10:00:00.000Z',
      ...EMPTY_FOR_OLDER_APPS,
    })

    // What is stored is plain version 2: the derived lists are gone.
    expect(storedDoc('bob')).toEqual({
      schemaVersion: 2,
      cabinets: cabinetsNamed('Hall'),
      updatedAt: '2026-10-15T10:00:00.000Z',
    })
  })

  it('hands out a row stored before version 2 as version 2', async () => {
    const { putCabinetRow } = await import('../src/server/db')
    putCabinetRow('carol', JSON.stringify(legacyDoc('Attic')), 'force')
    const carol = { Authorization: 'Discogs token=token-carol' }
    knownTokens['token-carol'] = 'carol'

    const get = await request(app).get('/api/sync/cabinet').set(carol)
    expect(get.body.doc).toEqual({
      schemaVersion: 2,
      cabinets: cabinetsNamed('Attic'),
      updatedAt: '2026-10-15T10:00:00.000Z',
      ...EMPTY_FOR_OLDER_APPS,
    })

    // A conflict reply hands it out as version 2 too.
    const conflict = await request(app)
      .put('/api/sync/cabinet')
      .set(carol)
      .set('If-Match', '"r0"')
      .send(sampleDoc('Attic'))
    expect(conflict.status).toBe(409)
    expect(conflict.body.doc).toEqual(get.body.doc)
  })

  it('gives apps from before version 2 the lists their storage panel counts', async () => {
    // Those apps store a reply as is and run Object.keys(doc.placements).
    const res = await request(app).get('/api/sync/cabinet').set(bob)
    expect(res.body.doc.schemaVersion).toBe(2)
    expect(Object.keys(res.body.doc.placements)).toEqual([])
    expect(res.body.doc.unplaced).toEqual([])
  })

  it('still refuses a version-1 save too large for the body limit', async () => {
    // Version 1 grew with every record and hit the 256 KB limit around 10,000
    // records (#134). Version 2 has no per-record lists; an app still cached
    // from before it keeps getting this refusal until it updates.
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(bob)
      .set('If-Match', '*')
      .send(legacyDoc('Big', 20_000))
    expect(res.status).toBe(413)
  })
})
