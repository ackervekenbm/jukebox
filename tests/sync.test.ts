// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import request from 'supertest'
import type { Express } from 'express'
import type { CabinetDoc } from '../src/shared/cabinetDoc'

const identityCalls = vi.hoisted(() => ({ count: 0 }))

const dataDir = `${process.env.TMPDIR ?? '/tmp'}/jukebox-sync-${process.pid}-${Date.now()}`
process.env.DATA_DIR = dataDir

const knownTokens: Record<string, string> = {
  'token-alice': 'alice',
  'token-bob': 'bob',
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

const { createApp } = await import('../src/server/app')
const { closeDb } = await import('../src/server/db')

const app: Express = createApp()

const alice = { Authorization: 'Discogs token=token-alice' }
const bob = { Authorization: 'Discogs token=token-bob' }

const sampleDoc = (
  placements: Record<string, string> = {},
  updatedAt = '2026-10-15T10:00:00.000Z',
): CabinetDoc => ({
  schemaVersion: 1,
  cabinets: [
    {
      id: 'main',
      name: 'Living room',
      slots: [
        { id: 's1', label: 'Top left', capacity: 40 },
        { id: 's2', label: 'Top right', capacity: 40 },
      ],
    },
  ],
  placements,
  overrides: {},
  unplaced: [],
  updatedAt,
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
    const doc = sampleDoc({ '111-222': 's1' })
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '"r0"')
      .send(doc)
    expect(res.status).toBe(200)
    expect(res.body.etag).toBe('"r1"')
    expect(res.body.doc).toEqual(doc)

    const get = await request(app).get('/api/sync/cabinet').set(alice)
    expect(get.body.doc).toEqual(doc)
    expect(get.body.etag).toBe('"r1"')
  })

  it('rejects a stale base revision with the current document', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '"r0"')
      .send(sampleDoc({ '999-999': 's2' }))
    expect(res.status).toBe(409)
    expect(res.body.etag).toBe('"r1"')
    expect(res.body.doc.placements).toEqual({ '111-222': 's1' })
  })

  it('advances the revision on a matching write', async () => {
    const res = await request(app)
      .put('/api/sync/cabinet')
      .set(alice)
      .set('If-Match', '"r1"')
      .send(sampleDoc({ '111-222': 's2' }, '2026-10-15T11:00:00.000Z'))
    expect(res.status).toBe(200)
    expect(res.body.etag).toBe('"r2"')

    const get = await request(app).get('/api/sync/cabinet').set(alice)
    expect(get.body.doc.placements).toEqual({ '111-222': 's2' })
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
      .send(sampleDoc({ '555-555': 's1' }))
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
})
