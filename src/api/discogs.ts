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
import { abortableSleep, discogsBudget, type Priority } from './rateLimit'

// Same-origin /discogs proxy (vite dev forwards to the API server, which
// relays to Discogs: src/server/discogsProxy.ts) for all API calls. The app
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

/**
 * One request to Discogs through the proxy. It first waits its turn in the
 * shared rate-limit budget (background lookups leave a larger reserve), and
 * reports the answer back to it; the timeout only counts the request itself.
 */
async function discogsFetch(
  path: string,
  token: string,
  signal?: AbortSignal,
  priority: Priority = 'interactive',
): Promise<Response> {
  await discogsBudget.acquire(priority, signal)
  let response: Response | undefined
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  if (signal?.aborted) onCallerAbort()
  else signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    response = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Discogs token=${token}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })
    return response
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onCallerAbort)
    discogsBudget.release(response)
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
      if (attempt >= maxRetries) {
        throw new DiscogsError('Discogs rate limit hit. Try again in a minute.', 429)
      }
      // The budget saw the 429 and holds every caller (this one included)
      // for the pause Discogs asked for; the next attempt waits there.
      attempt++
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
// endpoint, so each id costs one request: up to six run at once to overlap
// request latency (much faster than strictly serial), started at a steady
// pace so the average stays inside the ~60 req/min rate limit. They don't wait
// for each other: a slow or retried lookup holds only its own slot, and each
// one's result and progress are reported as soon as it's back.
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
// `onResult` and `onProgress` fire per lookup as it finishes, so callers can
// update the UI progressively instead of waiting for the slowest request.
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

  // Up to six lookups in flight, a new one started at a steady pace: about
  // 51 a minute, under Discogs' 60, so the shared budget rarely has to step
  // in. A slow lookup only holds its own slot; the others keep going.
  const MAX_IN_FLIGHT = 6
  const START_INTERVAL_MS = 1_180
  let done = 0

  // The run's own signal: the caller's abort, or the first refusal (a bad
  // token fails every lookup), cancels the lookups still waiting or running,
  // so the error surfaces at once instead of after their retries.
  const run = new AbortController()
  const onCallerAbort = () => run.abort()
  if (signal?.aborted) run.abort()
  else signal?.addEventListener('abort', onCallerAbort, { once: true })
  const aborted = () => new DOMException('Aborted', 'AbortError')

  async function fetchOne(id: number): Promise<T | undefined> {
    const maxAttempts = 3
    const maxRateLimitAttempts = 4
    let attempts = 0
    let rateLimitAttempts = 0
    for (;;) {
      let response: Response
      try {
        response = await discogsFetch(pathOf(id), token, run.signal, 'background')
      } catch {
        // Same rule as requestJson: an internal timeout rejects the fetch but
        // only an abort of the run actually cancels it.
        if (run.signal.aborted) throw aborted()
        // Failed after retries: not cached, retried on the next sync.
        if (++attempts >= maxAttempts) return undefined
        await abortableSleep(1200 * attempts, run.signal)
        continue
      }

      if (response.status === 429) {
        // Still throttled after several tries: not cached, retried later. The
        // budget holds the next attempt (and every other request) for the
        // pause Discogs asked for.
        if (++rateLimitAttempts >= maxRateLimitAttempts) return undefined
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
      await abortableSleep(1200 * attempts, run.signal)
    }
  }

  const running = new Set<Promise<void>>()
  let failure: unknown = null
  let lastStart = Number.NEGATIVE_INFINITY

  try {
    for (const id of unique) {
      while (running.size >= MAX_IN_FLIGHT && !failure) await Promise.race(running)
      if (failure || run.signal.aborted) break
      const wait = lastStart + START_INTERVAL_MS - Date.now()
      if (wait > 0) {
        try {
          await abortableSleep(wait, run.signal)
        } catch {
          break
        }
      }
      if (failure || run.signal.aborted) break
      lastStart = Date.now()

      const task: Promise<void> = fetchOne(id).then(
        (value) => {
          // Each lookup counts the moment it's back, not when its neighbours are.
          if (value !== undefined) {
            result[id] = value
            onResult?.(id, value)
          }
          onProgress?.(++done, unique.length)
        },
        (err: unknown) => {
          // A refused token or an abort ends the whole run; the first one wins,
          // and the others are cancelled rather than left to finish.
          failure ??= err
          run.abort()
        },
      )
      // A callback that throws ends the run the same way, instead of escaping
      // through Promise.race while the other lookups carry on.
      const tracked: Promise<void> = task
        .catch((err: unknown) => {
          failure ??= err
          run.abort()
        })
        .finally(() => running.delete(tracked))
      running.add(tracked)
    }
    await Promise.all(running)
  } finally {
    signal?.removeEventListener('abort', onCallerAbort)
  }

  if (failure) throw failure
  if (signal?.aborted) throw aborted()
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

