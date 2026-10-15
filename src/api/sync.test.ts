// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CabinetDoc } from '../shared/cabinetDoc'
import {
  fetchCabinet,
  pushCabinet,
  revisionEtag,
  revisionFromEtag,
  SyncConflictError,
  SyncError,
} from './sync'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const doc: CabinetDoc = {
  schemaVersion: 1,
  cabinets: [{ id: 'c', name: 'Cabinet', slots: [{ id: 's', label: 'A', capacity: 40 }] }],
  placements: {},
  overrides: {},
  unplaced: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(handler: (url: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const result = handler(url, init)
      return result instanceof Promise ? result : Promise.resolve(result)
    }),
  )
  fetchMock = vi.mocked(fetch)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('revisionEtag', () => {
  it('formats the wire ETag the server expects', () => {
    expect(revisionEtag(0)).toBe('"r0"')
    expect(revisionEtag(12)).toBe('"r12"')
  })
})

describe('revisionFromEtag', () => {
  it('reads the revision back out of a wire ETag', () => {
    expect(revisionFromEtag('"r7"', 0)).toBe(7)
    expect(revisionFromEtag('r7', 0)).toBe(7)
  })

  it('falls back when the header is missing or malformed', () => {
    expect(revisionFromEtag('', 3)).toBe(3)
    expect(revisionFromEtag('W/"r7"', 3)).toBe(3)
    expect(revisionFromEtag('nonsense', 3)).toBe(3)
  })
})

describe('fetchCabinet', () => {
  it('reads the document with the bearer token', async () => {
    mockFetch(() => json({ username: 'alice', doc, etag: '"r4"' }))

    const snapshot = await fetchCabinet('tok')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sync/cabinet',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Discogs token=tok' }),
      }),
    )
    expect(snapshot.doc).toEqual(doc)
    expect(snapshot.etag).toBe('"r4"')
  })

  it('returns a null document for an account that never synced', async () => {
    mockFetch(() => json({ username: 'alice', doc: null, etag: '"r0"' }))

    const snapshot = await fetchCabinet('tok')

    expect(snapshot.doc).toBeNull()
    expect(snapshot.etag).toBe('"r0"')
  })

  it('throws a SyncError carrying the status', async () => {
    mockFetch(() => json({ error: 'Discogs authentication failed' }, 401))

    await expect(fetchCabinet('bad')).rejects.toMatchObject({ name: 'SyncError', status: 401 })
  })
})

describe('pushCabinet', () => {
  it('writes the document guarded by its ETag', async () => {
    mockFetch(() => json({ username: 'alice', doc, etag: '"r5"' }))

    const snapshot = await pushCabinet('tok', doc, '"r4"')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sync/cabinet',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"r4"')
    expect(JSON.parse(String(init.body))).toEqual(doc)
    expect(snapshot.etag).toBe('"r5"')
  })

  it('surfaces a conflict with the server copy so the caller can rebase', async () => {
    const serverDoc = { ...doc, updatedAt: '2026-02-02T00:00:00.000Z' }
    mockFetch(() => json({ error: 'out of date', doc: serverDoc, etag: '"r9"' }, 409))

    const conflict = await pushCabinet('tok', doc, '"r4"').catch(
      (err: unknown) => err as SyncConflictError,
    )

    expect(conflict).toBeInstanceOf(SyncConflictError)
    expect(conflict).toBeInstanceOf(SyncError)
    expect(conflict.doc).toEqual(serverDoc)
    expect(conflict.etag).toBe('"r9"')
  })

  it('surfaces rejection as a plain sync error', async () => {
    mockFetch(() => json({ error: 'Invalid cabinet document' }, 400))

    await expect(pushCabinet('tok', doc, '"r0"')).rejects.toMatchObject({ status: 400 })
  })
})
