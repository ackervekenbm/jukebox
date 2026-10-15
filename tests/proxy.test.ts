// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import request from 'supertest'
import type { Express } from 'express'

const dataDir = `${process.env.TMPDIR ?? '/tmp'}/jukebox-proxy-${process.pid}-${Date.now()}`
process.env.DATA_DIR = dataDir

vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
  const url = String(input)
  if (url.includes('/boom')) throw new TypeError('fetch failed')
  if (url.includes('/rate')) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'retry-after': '6', 'x-discogs-ratelimit-used': '59' },
    })
  }
  return Response.json({
    url,
    authorization: new Headers(init?.headers).get('authorization'),
    userAgent: new Headers(init?.headers).get('user-agent'),
  })
})

const { createApp } = await import('../src/server/app')
const { closeDb } = await import('../src/server/db')

const app: Express = createApp()

afterAll(async () => {
  vi.unstubAllGlobals()
  closeDb()
  await rm(dataDir, { recursive: true, force: true })
})

describe('GET /discogs/*', () => {
  it('forwards the path, query string and credentials to Discogs', async () => {
    const res = await request(app)
      .get('/discogs/database/search?q=foo&page=2')
      .set('Authorization', 'Discogs token=token-alice')
    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://api.discogs.com/database/search?q=foo&page=2')
    expect(res.body.authorization).toBe('Discogs token=token-alice')
    expect(res.body.userAgent).toContain('Jukebox')
  })

  it('passes rate-limit responses and headers through untouched', async () => {
    const res = await request(app).get('/discogs/rate')
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('6')
    expect(res.headers['x-discogs-ratelimit-used']).toBe('59')
  })

  it('maps network failures to 502', async () => {
    const res = await request(app).get('/discogs/boom')
    expect(res.status).toBe(502)
    expect(res.body.error).toBe('Discogs API is unreachable')
  })

  it('refuses write methods', async () => {
    const res = await request(app).post('/discogs/users/me').send({})
    expect(res.status).toBe(405)
    expect(res.headers.allow).toBe('GET, HEAD')
  })
})
