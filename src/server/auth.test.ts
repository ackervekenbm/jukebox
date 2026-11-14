// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import request from 'supertest'
import type { Express } from 'express'

const dataDir = `${process.env.TMPDIR ?? '/tmp'}/jukebox-auth-${process.pid}-${Date.now()}`
process.env.DATA_DIR = dataDir

/** How Discogs answers the identity check for each token. */
vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
  const token = /token=(\S+)/.exec(new Headers(init?.headers).get('authorization') ?? '')?.[1]
  switch (token) {
    case 'good':
      return Response.json({ id: 1, username: 'alice' })
    case 'revoked':
      return new Response('Unauthorized', { status: 401 })
    case 'forbidden':
      return new Response('Forbidden', { status: 403 })
    case 'busy':
      return new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '7' } })
    case 'down':
      return new Response('Service Unavailable', { status: 503 })
    default:
      throw new TypeError('fetch failed')
  }
})

const { createApp } = await import('./app')
const { closeDb } = await import('./db')

const app: Express = createApp()
const syncAs = (token: string) =>
  request(app).get('/api/sync/cabinet').set('Authorization', `Discogs token=${token}`)

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  vi.unstubAllGlobals()
  closeDb()
  await rm(dataDir, { recursive: true, force: true })
})

describe('Discogs identity check', () => {
  it('signs in with a token Discogs accepts', async () => {
    const res = await syncAs('good')
    expect(res.status).toBe(200)
    expect(res.body.username).toBe('alice')
  })

  it.each(['revoked', 'forbidden'])('answers 401 when Discogs refuses the token (%s), without logging it', async (token) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await syncAs(token)).status).toBe(401)
    expect(error).not.toHaveBeenCalled()
  })

  it('passes a Discogs rate limit on as 429 with its Retry-After, not as a bad token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await syncAs('busy')
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('7')
    expect(error).toHaveBeenCalled()
  })

  it.each(['down', 'unreachable'])('answers 502 when Discogs is %s, and logs it without the token', async (token) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await syncAs(token)).status).toBe(502)
    expect(error).toHaveBeenCalled()
    const logged = error.mock.calls.flat().map((arg) => (arg instanceof Error ? `${arg.message} ${String(arg.cause)}` : String(arg)))
    expect(logged.join(' ')).not.toContain(`token=${token}`)
  })

  it('keeps why Discogs could not be reached', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await syncAs('unreachable')
    const logged = error.mock.calls.flat().find((arg) => arg instanceof Error) as Error
    expect(logged.cause).toBeInstanceOf(TypeError)
  })
})
