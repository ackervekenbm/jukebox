// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type {
  CollectionValue,
  DiscogsCollectionFolder,
  DiscogsCollectionFolderResponse,
  DiscogsCollectionRelease,
  DiscogsFoldersResponse,
  DiscogsMaster,
  DiscogsRelease,
  DiscogsTrack,
} from '../types/discogs'

// Same-origin /discogs proxy (vite dev + nginx) for all API calls. The app
// cannot call the API cross-origin: Discogs' 429 rate-limit responses carry no
// Access-Control-Allow-Origin header, so the browser masks throttling as an
// opaque CORS error and year enrichment can never finish. Through the proxy a
// 429 is a normal, Retry-After-retryable response.
const API_BASE = '/discogs'
const USER_AGENT = 'Jukebox/0.1 (+local personal collection viewer)'
// Cap how long a single request may take. Stalled connections (flaky proxy,
// network pause, API hang) otherwise leave the sync spinning forever.
const FETCH_TIMEOUT_MS = 20_000

export class DiscogsError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'DiscogsError'
    this.status = status
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function discogsFetch(path: string, token: string, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  if (signal?.aborted) onCallerAbort()
  else signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    return await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Discogs token=${token}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}

export interface ProgressInfo {
  loaded: number
  total: number
}

export interface CollectionResult {
  releases: DiscogsCollectionRelease[]
  items: number
}

export async function fetchCollection(
  username: string,
  token: string,
  onProgress?: (progress: ProgressInfo) => void,
  signal?: AbortSignal,
): Promise<CollectionResult> {
  const perPage = 100
  const first = await requestPage(
    `/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=1&per_page=${perPage}`,
    token,
    signal,
  )

  const pages = first.pagination.pages
  const releases = [...first.releases]
  onProgress?.({ loaded: releases.length, total: first.pagination.items })

  for (let page = 2; page <= pages; page++) {
    await sleep(1100)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const data = await requestPage(
      `/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${page}&per_page=${perPage}`,
      token,
      signal,
    )
    releases.push(...data.releases)
    onProgress?.({ loaded: releases.length, total: first.pagination.items })
  }

  return { releases, items: first.pagination.items }
}

export async function fetchFolders(
  username: string,
  token: string,
  signal?: AbortSignal,
): Promise<DiscogsCollectionFolder[]> {
  const data = await requestJson<DiscogsFoldersResponse>(
    `/users/${encodeURIComponent(username)}/collection/folders`,
    token,
    signal,
  )
  return data.folders ?? []
}

// Discogs' own valuation of the whole collection: the combined minimum, median
// and maximum value of every item in it, derived from recent marketplace sales
// history. One request for the entire collection, so unlike per-release pricing
// this costs nothing against the rate limit no matter how large the collection
// is.
//
// It is a user resource, so it needs the collection owner's token — the same
// personal access token the collection itself is read with. Discogs answers in
// the authenticated user's currency, baked into each figure as a formatted
// string ("$1,737.04"); there is no currency code in the response.
export async function fetchCollectionValue(
  username: string,
  token: string,
  signal?: AbortSignal,
): Promise<CollectionValue> {
  const data = await requestJson<CollectionValueWire>(
    `/users/${encodeURIComponent(username)}/collection/value`,
    token,
    signal,
  )
  return {
    minimum: moneyString(data.minimum),
    median: moneyString(data.median),
    maximum: moneyString(data.maximum),
  }
}

/** Raw wire shape of the collection/value endpoint. */
interface CollectionValueWire {
  minimum?: string | number
  median?: string | number
  maximum?: string | number
}

// A figure usually arrives as a display string with the currency symbol and
// thousands separators already applied; plain numbers occur too. Either way it
// is ready for display once coerced to a string. Anything missing becomes an
// empty string rather than being formatted — there is no currency code to
// format with.
function moneyString(value: string | number | undefined): string {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : ''
  if (typeof value === 'string') return value.trim()
  return ''
}

/** What the app reads from a full release: its tracklist and its notes ('' when none). */
export interface ReleaseDetails {
  tracks: DiscogsTrack[]
  notes: string
}

/** Notes are kept for the cabinet's gatefold check; a few thousand characters is plenty. */
const MAX_NOTES_LENGTH = 4000

function notesOf(data: DiscogsRelease): string {
  return typeof data.notes === 'string' ? data.notes.slice(0, MAX_NOTES_LENGTH) : ''
}

function releaseDetailsOf(data: DiscogsRelease): ReleaseDetails {
  return { tracks: data.tracklist ?? [], notes: notesOf(data) }
}

export async function fetchReleaseDetails(
  releaseId: number,
  token: string,
  signal?: AbortSignal,
): Promise<ReleaseDetails> {
  return releaseDetailsOf(
    await requestJson<DiscogsRelease>(`/releases/${releaseId}`, token, signal),
  )
}

async function requestJson<T>(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  const maxRetries = 5
  let attempt = 0

  for (;;) {
    let response: Response
    try {
      response = await discogsFetch(path, token, signal)
    } catch {
      // Only a caller-initiated abort cancels. The internal fetch timeout also
      // rejects (AbortError) but must be retried like any network failure.
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (attempt >= maxRetries) throw new DiscogsError('Network error talking to Discogs.', 0)
      attempt++
      const wait = 1000 * 2 ** attempt + Math.random() * 400
      await sleep(wait)
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      continue
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '') || 0
      if (attempt >= maxRetries) {
        throw new DiscogsError('Discogs rate limit hit. Try again in a minute.', 429)
      }
      attempt++
      await sleep(Math.min(retryAfter * 1000, 30000) || 3000)
      continue
    }

    if (!response.ok) {
      throw new DiscogsError(await describeError(response), response.status)
    }

    return (await response.json()) as T
  }
}

function requestPage(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<DiscogsCollectionFolderResponse> {
  return requestJson<DiscogsCollectionFolderResponse>(path, token, signal)
}

async function describeError(response: Response): Promise<string> {
  let message = `Discogs request failed (${response.status}).`
  try {
    const body = (await response.json()) as { message?: string; error?: string }
    message = body.message ?? body.error ?? message
  } catch {
    // fall through, keep generic message
  }
  if (response.status === 401) message = `${message} Check your personal access token.`
  if (response.status === 404) message = `${message} Is the username right?`
  return message
}

// Per-id Discogs lookups (master years, release notes). Discogs has no batch
// endpoint, so each id costs one request: the fetch runs in small staggered
// batches to overlap request latency (much faster than strictly serial), and
// pauses between batches so the average stays inside the ~60 req/min rate
// limit.
//
// `read` turns a response into a result; it sees 200 and 404 responses only:
// - a value — cached by the caller (a 404 is how a lookup says "known missing",
//   so it isn't requested again on every sync).
// - undefined — the fetch failed after retries (network, timeout, 5xx,
//   rate-limit bail, a body that isn't JSON); NOT cached, so the id is retried
//   next sync, and one bad id doesn't stop the others.
//
// A 401/403 means the token is wrong for every id, so it stops the whole run
// with a DiscogsError instead of failing each id three times.
//
// `onResult` streams results as they arrive so callers can progressively
// update the UI instead of blocking until every request has finished.
async function fetchEach<T>(
  ids: number[],
  pathOf: (id: number) => string,
  read: (response: Response) => Promise<T>,
  token: string,
  signal: AbortSignal | undefined,
  onProgress: ((loaded: number, total: number) => void) | undefined,
  onResult: ((id: number, value: T) => void) | undefined,
): Promise<Record<number, T>> {
  const unique = [...new Set(ids)]
  const result: Record<number, T> = {}

  const BATCH_SIZE = 6
  const STAGGER_MS = 100
  const BATCH_PAUSE_MS = 6600 // 6 requests / ~7.1s ≈ 51 req/min
  let done = 0

  async function fetchOne(id: number, offset: number): Promise<T | undefined> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (offset > 0) await sleep(offset * STAGGER_MS)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const maxAttempts = 3
    const maxRateLimitAttempts = 4
    let attempts = 0
    let rateLimitAttempts = 0
    for (;;) {
      let response: Response
      try {
        response = await discogsFetch(pathOf(id), token, signal)
      } catch {
        // Same rule as requestJson: an internal timeout rejects the fetch but
        // only a caller abort actually cancels the sync.
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        // Failed after retries: not cached, retried on the next sync.
        if (++attempts >= maxAttempts) return undefined
        await sleep(1200 * attempts)
        continue
      }

      if (response.status === 429) {
        // Still throttled after several backoffs: not cached, retried later.
        if (++rateLimitAttempts >= maxRateLimitAttempts) return undefined
        // Discogs sends Retry-After in seconds; sleep that long (capped) so a
        // throttled burst can cool down instead of immediately re-429ing.
        const retryAfterSeconds = Number(response.headers.get('Retry-After') ?? '') || 3
        await sleep(Math.min(retryAfterSeconds * 1000, 30000))
        continue
      }

      if (response.status === 401 || response.status === 403) {
        throw new DiscogsError(await describeError(response), response.status)
      }

      if (response.ok || response.status === 404) {
        try {
          return await read(response)
        } catch {
          return undefined
        }
      }

      // Other HTTP error (5xx etc.), failed after retries: not cached.
      if (++attempts >= maxAttempts) return undefined
      await sleep(1200 * attempts)
    }
  }

  for (let offset = 0; offset < unique.length; offset += BATCH_SIZE) {
    const batch = unique.slice(offset, offset + BATCH_SIZE)
    const values = await Promise.all(batch.map((id, i) => fetchOne(id, i)))
    batch.forEach((id, i) => {
      const value = values[i]
      if (value === undefined) return
      result[id] = value
      onResult?.(id, value)
    })
    done += batch.length
    onProgress?.(done, unique.length)

    if (offset + BATCH_SIZE < unique.length) {
      await sleep(BATCH_PAUSE_MS)
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    }
  }

  return result
}

// Year a master's music was originally released, fetched per unique master.
// A year is cached; null means the master genuinely has no usable year (or no
// longer exists), cached so known-missing masters aren't re-requested.
export type MasterYears = Record<number, number | null>

export function fetchMasterYears(
  masterIds: number[],
  token: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
  onMasterYear?: (masterId: number, year: number | null) => void,
): Promise<MasterYears> {
  return fetchEach<number | null>(
    masterIds,
    (id) => `/masters/${id}`,
    async (response) => {
      if (!response.ok) return null
      const master = (await response.json()) as DiscogsMaster
      return typeof master.year === 'number' ? master.year : null
    },
    token,
    signal,
    onProgress,
    onMasterYear,
  )
}

// Each release's notes, where pressings often mention a gatefold sleeve. The
// collection listing has no notes, so this is one full-release request per id,
// paced like the master years. A removed release (404) has no notes ('') and
// is cached like any answer.
export function fetchReleaseNotes(
  releaseIds: number[],
  token: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
  onRelease?: (releaseId: number, notes: string) => void,
): Promise<Record<number, string>> {
  return fetchEach<string>(
    releaseIds,
    (id) => `/releases/${id}`,
    async (response) => (response.ok ? notesOf((await response.json()) as DiscogsRelease) : ''),
    token,
    signal,
    onProgress,
    onRelease,
  )
}

