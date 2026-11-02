// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCollection,
  fetchCollectionValue,
  fetchFolders,
  fetchMasterYears,
  fetchReleaseDetails,
  fetchReleaseNotes,
} from './discogs'

const API = '/discogs'

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function collectionPage(page: number, pages: number, items: number): Response {
  return json({
    pagination: { page, pages, per_page: 100, items },
    releases: [{ id: page, instance_id: page }],
  })
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

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetchFolders', () => {
  it('hits the folders endpoint with the token', async () => {
    mockFetch(() => json({ folders: [{ id: 1, name: 'All', count: 3 }] }))

    const folders = await fetchFolders('alice', 'tok')

    expect(folders).toEqual([{ id: 1, name: 'All', count: 3 }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${API}/users/alice/collection/folders`)
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Discogs token=tok' })
  })

  it('turns non-OK responses into a DiscogsError with guidance', async () => {
    mockFetch(() => json({ message: 'Invalid token' }, 401))
    await expect(fetchFolders('alice', 'bad')).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('Check your personal access token.'),
    })
  })

  it('retries transient network failures with backoff', async () => {
    let calls = 0
    mockFetch(() => {
      if (calls++ === 0) throw new TypeError('network down')
      return json({ folders: [] })
    })

    const promise = fetchFolders('alice', 'tok')
    // first backoff is 1000 * 2^1 + random(0..400)
    await vi.advanceTimersByTimeAsync(2500)
    await expect(promise).resolves.toEqual([])
    expect(calls).toBe(2)
  })

  it('gives up with a network error after exhausting retries', async () => {
    mockFetch(() => {
      throw new TypeError('always offline')
    })

    const promise = fetchFolders('alice', 'tok')
    // Attach the assertion before advancing so the rejection is handled in
    // time; otherwise Node flags it as unhandled.
    const assertion = expect(promise).rejects.toMatchObject({ status: 0 })
    await vi.advanceTimersByTimeAsync(70_000)
    await assertion
  })

  it('recovers from a 429 using Retry-After', async () => {
    let calls = 0
    mockFetch(() => {
      if (calls++ === 0) return json({ message: 'rate limited' }, 429, { 'Retry-After': '1' })
      return json({ folders: [] })
    })

    const promise = fetchFolders('alice', 'tok')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toEqual([])
    expect(calls).toBe(2)
  })
})

describe('fetchCollection', () => {
  it('pages through the collection and reports progress', async () => {
    let page = 0
    mockFetch(() => {
      page++
      return collectionPage(page, 2, 2)
    })
    const onProgress = vi.fn()

    const promise = fetchCollection('alice', 'tok', onProgress)
    // 1100ms pacing between pages
    await vi.advanceTimersByTimeAsync(1200)

    const result = await promise
    expect(result.items).toBe(2)
    expect(result.releases.map((r) => r.instance_id)).toEqual([1, 2])

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('page=1&per_page=100')
    expect(urls[1]).toContain('page=2&per_page=100')
    expect(onProgress.mock.calls).toEqual([
      [{ loaded: 1, total: 2 }],
      [{ loaded: 2, total: 2 }],
    ])
  })

  it('aborts cleanly when the caller signal is cancelled', async () => {
    const controller = new AbortController()
    mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal
          if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
          else signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )

    const promise = fetchCollection('alice', 'tok', undefined, controller.signal)
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('fetchMasterYears', () => {
  it('resolves years, caches nulls for 404s, and streams via callbacks', async () => {
    mockFetch((url) => {
      const match = /\/masters\/(\d+)$/.exec(url)
      const id = match ? Number(match[1]) : 0
      if (id === 3) return json({ message: 'Not found' }, 404)
      return json({ id, year: 1975 + id })
    })
    const onMasterYear = vi.fn()
    const onProgress = vi.fn()

    const promise = fetchMasterYears([1, 2, 3, 4], 'tok', onProgress, undefined, onMasterYear)
    await vi.advanceTimersByTimeAsync(400) // cover the 100ms stagger offsets

    const result = await promise
    expect(result).toEqual({ 1: 1976, 2: 1977, 3: null, 4: 1979 })
    expect(onProgress).toHaveBeenLastCalledWith(4, 4)
    expect(onMasterYear.mock.calls.map(([id]) => id)).toEqual([1, 2, 3, 4])
  })

  it('backs off on 429s and still caches the year', async () => {
    let calls = 0
    mockFetch(() => {
      if (calls++ === 0) return json({ message: 'throttled' }, 429, { 'Retry-After': '1' })
      return json({ id: 1, year: 1980 })
    })

    const promise = fetchMasterYears([1], 'tok')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toEqual({ 1: 1980 })
  })

  it('drops masters that stay rate-limited (not cached for retry)', async () => {
    mockFetch(() => json({ message: 'throttled' }, 429, { 'Retry-After': '1' }))

    const promise = fetchMasterYears([1], 'tok')
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toEqual({})
  })

  it('paginates master fetches in staggered batches', async () => {
    let page = 0
    mockFetch(() => {
      page++
      return json({ id: page, year: 1900 + page })
    })

    const promise = fetchMasterYears([10, 20, 30, 40, 50, 60, 70], 'tok')
    // batch of 6 + pause, then final batch
    await vi.advanceTimersByTimeAsync(600)
    await vi.advanceTimersByTimeAsync(7_000)
    await vi.advanceTimersByTimeAsync(600)

    const result = await promise
    expect(Object.keys(result)).toHaveLength(7)
  })
})

describe('fetchReleaseDetails', () => {
  it('returns the tracklist and the notes', async () => {
    const notes = '180 Gram Heavyweight Vinyl\nGatefold sleeve.\nMade in the EU.'
    mockFetch(() =>
      json({ id: 5, title: 'X', year: 2000, tracklist: [{ position: 'A1', title: 'T', duration: '1:00' }], notes }),
    )
    await expect(fetchReleaseDetails(5, 'tok')).resolves.toEqual({
      tracks: [{ position: 'A1', title: 'T', duration: '1:00' }],
      notes,
    })
  })

  it('reads a release without notes as empty notes', async () => {
    mockFetch(() => json({ id: 5, title: 'X', year: 2000, tracklist: [] }))
    await expect(fetchReleaseDetails(5, 'tok')).resolves.toEqual({ tracks: [], notes: '' })
  })

  it('keeps no more than a few thousand characters of notes', async () => {
    mockFetch(() => json({ id: 5, title: 'X', year: 2000, tracklist: [], notes: 'x'.repeat(10_000) }))
    const { notes } = await fetchReleaseDetails(5, 'tok')
    expect(notes).toHaveLength(4000)
  })
})

describe('fetchReleaseNotes', () => {
  it('reads each release once, streams its notes, and gives a removed release none', async () => {
    const requested: string[] = []
    mockFetch((url) => {
      requested.push(url)
      const id = Number(/\/releases\/(\d+)$/.exec(url)?.[1])
      if (id === 3) return json({ message: 'Release not found.' }, 404)
      return json({ id, title: 'X', year: 2000, tracklist: [], notes: id === 1 ? 'Gate-fold cover' : undefined })
    })
    const onRelease = vi.fn()

    const promise = fetchReleaseNotes([1, 2, 3, 1], 'tok', undefined, undefined, onRelease)
    await vi.advanceTimersByTimeAsync(400)

    await expect(promise).resolves.toEqual({ 1: 'Gate-fold cover', 2: '', 3: '' })
    expect(requested).toEqual([`${API}/releases/1`, `${API}/releases/2`, `${API}/releases/3`])
    expect(onRelease.mock.calls).toEqual([
      [1, 'Gate-fold cover'],
      [2, ''],
      [3, ''],
    ])
  })

  it('leaves a release that keeps failing out, so it is asked again later', async () => {
    mockFetch(() => json({ message: 'boom' }, 500))

    const promise = fetchReleaseNotes([1], 'tok')
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(2500)
    await expect(promise).resolves.toEqual({})
  })

  it('skips a release whose answer is not JSON, and keeps going', async () => {
    mockFetch((url) =>
      url.endsWith('/releases/1')
        ? new Response('<html>maintenance</html>', { status: 200 })
        : json({ id: 2, title: 'X', year: 2000, tracklist: [], notes: 'Gatefold' }),
    )

    const promise = fetchReleaseNotes([1, 2], 'tok')
    await vi.advanceTimersByTimeAsync(400)
    await expect(promise).resolves.toEqual({ 2: 'Gatefold' })
  })

  it('stops at once when Discogs refuses the token, instead of failing every release', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      return json({ message: 'You must authenticate to access this resource.' }, 401)
    })

    const promise = fetchReleaseNotes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'bad')
    const outcome = expect(promise).rejects.toMatchObject({ name: 'DiscogsError', status: 401 })
    await vi.advanceTimersByTimeAsync(1000)
    await outcome
    // The first batch of six, each tried once; never the second batch.
    expect(calls).toBeLessThanOrEqual(6)
  })
})

describe('fetchCollectionValue', () => {
  it('asks the collection value endpoint with the owner token', async () => {
    mockFetch(() =>
      json({ minimum: '$1,737.04', median: '$5,234.56', maximum: '$9,999.99' }),
    )

    const value = await fetchCollectionValue('alice', 'tok')

    expect(value).toEqual({
      minimum: '$1,737.04',
      median: '$5,234.56',
      maximum: '$9,999.99',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${API}/users/alice/collection/value`)
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Discogs token=tok' })
  })

  it('normalizes plain numbers and missing figures to display strings', async () => {
    mockFetch(() => json({ minimum: 120.5 }))

    const value = await fetchCollectionValue('alice', 'tok')

    expect(value).toEqual({ minimum: '120.5', median: '', maximum: '' })
  })

  it('url-encodes the username', async () => {
    mockFetch(() => json({ minimum: '$0' }))

    await fetchCollectionValue('a b/c', 'tok')

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `${API}/users/a%20b%2Fc/collection/value`,
    )
  })

  it('surfaces a DiscogsError when the token is not the collection owner', async () => {
    mockFetch(() => json({ message: 'You are not the owner of this collection' }, 403))
    await expect(fetchCollectionValue('alice', 'other-tok')).rejects.toMatchObject({ status: 403 })
  })

  it('recovers from a 429 using Retry-After', async () => {
    let calls = 0
    mockFetch(() => {
      if (calls++ === 0) return json({ message: 'rate limited' }, 429, { 'Retry-After': '1' })
      return json({ minimum: '$1', median: '$2', maximum: '$3' })
    })

    const promise = fetchCollectionValue('alice', 'tok')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toMatchObject({ median: '$2' })
    expect(calls).toBe(2)
  })
})
