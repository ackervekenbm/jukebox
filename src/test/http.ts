// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { vi } from 'vitest'

/** A JSON answer as the Discogs proxy or the sync API would send it. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * Replaces the global fetch with `handler` (which may answer sync or async)
 * and returns the mock, for checking the calls. Undo with `vi.unstubAllGlobals()`.
 */
export function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const result = handler(url, init)
      return result instanceof Promise ? result : Promise.resolve(result)
    }),
  )
  return vi.mocked(fetch)
}
