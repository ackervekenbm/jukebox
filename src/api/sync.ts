// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { CabinetDoc } from '../shared/cabinetDoc'
import { parseEtag } from '../shared/etag'

const SYNC_URL = '/api/sync/cabinet'
const FETCH_TIMEOUT_MS = 20_000

/** Reads a revision back out of a wire ETag, falling back when it is unusable. */
export function revisionFromEtag(etag: string, fallback: number): number {
  const revision = parseEtag(etag)
  return typeof revision === 'number' ? revision : fallback
}

export interface SyncSnapshot {
  doc: CabinetDoc | null
  etag: string
}

export class SyncError extends Error {
  /** HTTP status, or 0 when the server could not be reached at all. */
  status: number
  /** How long the server asked to wait before trying again (Retry-After), in ms. */
  retryAfterMs?: number

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message)
    this.name = 'SyncError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }

  /** Busy or unreachable rather than refused: the same request may work later. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

/** Retry-After as seconds or an HTTP date, in ms; undefined when absent or unreadable. */
export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (value.trim() !== '' && Number.isFinite(seconds)) return Math.max(0, seconds) * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

/**
 * What a failed answer means for the user. A refused token needs them; a busy
 * or failing Discogs (the server checks the token there) only needs time.
 */
function failure(res: Response, fallback: string): SyncError {
  if (res.status === 401) return new SyncError('Discogs refused the token. Check it in Settings.', 401)
  const wait = retryAfterMs(res.headers.get('retry-after'))
  if (res.status === 429) return new SyncError('Discogs is busy. Trying again shortly.', 429, wait)
  if (res.status >= 500) {
    return new SyncError("Discogs or the server can't be reached. Trying again shortly.", res.status, wait)
  }
  return new SyncError(fallback, res.status)
}

/**
 * Thrown on 409: someone else saved a newer document. Carries the server's
 * current copy so the caller can rebase its local edits and push again.
 */
export class SyncConflictError extends SyncError {
  doc: CabinetDoc | null
  etag: string

  constructor(snapshot: SyncSnapshot) {
    super('Cabinet document is out of date', 409)
    this.name = 'SyncConflictError'
    this.doc = snapshot.doc
    this.etag = snapshot.etag
  }
}

async function syncFetch(
  init: RequestInit & { token: string },
  signal?: AbortSignal,
): Promise<Response> {
  const { token, ...rest } = init
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  if (signal?.aborted) onCallerAbort()
  else signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    return await fetch(SYNC_URL, {
      ...rest,
      signal: controller.signal,
      headers: { Authorization: `Discogs token=${token}`, ...rest.headers },
    })
  } catch (err) {
    if (signal?.aborted) throw err
    // No answer at all (offline, or the timeout above): worth trying again.
    throw new SyncError("Can't reach the server. Trying again shortly.", 0)
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function asSnapshot(body: Record<string, unknown>): SyncSnapshot {
  return {
    doc: (body.doc ?? null) as CabinetDoc | null,
    etag: typeof body.etag === 'string' ? body.etag : '',
  }
}

/** Reads the server's copy of the cabinet document. */
export async function fetchCabinet(token: string, signal?: AbortSignal): Promise<SyncSnapshot> {
  const res = await syncFetch({ method: 'GET', token }, signal)
  const body = await readBody(res)
  if (!res.ok) throw failure(res, 'Could not read the synced cabinet')
  return asSnapshot(body)
}

/** Shown when a save is refused for its size; the cabinet stays on this device. */
export const CABINET_TOO_LARGE =
  'The cabinet is too large to sync to the server. It is still saved on this device.'

/**
 * Writes the cabinet document, guarded by the ETag of the copy it was built
 * from. A 409 means the server moved on; the caller rebases and retries.
 */
export async function pushCabinet(
  token: string,
  doc: CabinetDoc,
  etag: string,
  signal?: AbortSignal,
): Promise<SyncSnapshot> {
  const res = await syncFetch(
    {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify(doc),
    },
    signal,
  )
  const body = await readBody(res)
  if (res.status === 409) throw new SyncConflictError(asSnapshot(body))
  // The server (or a proxy in front of it) refused the body for its size. That
  // fails the same way on every retry, so say so instead of a generic failure.
  if (res.status === 413) throw new SyncError(CABINET_TOO_LARGE, 413)
  if (!res.ok) throw failure(res, 'Could not save the cabinet')
  return asSnapshot(body)
}
