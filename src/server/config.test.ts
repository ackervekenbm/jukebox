// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('server config', () => {
  it('falls back to the defaults', async () => {
    vi.stubEnv('PORT', '')
    vi.stubEnv('DISCOGS_TIMEOUT_MS', undefined)
    const config = await import('./config')
    expect(config.PORT).toBe(3000)
    expect(config.DISCOGS_TIMEOUT_MS).toBe(30_000)
  })

  it('reads numbers from the environment', async () => {
    vi.stubEnv('PORT', '8080')
    expect((await import('./config')).PORT).toBe(8080)
  })

  it.each(['abc', '0', '-1', '3.5'])('refuses PORT=%s at startup', async (value) => {
    vi.stubEnv('PORT', value)
    await expect(import('./config')).rejects.toThrow(/PORT must be a positive whole number/)
  })
})
