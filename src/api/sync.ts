// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { CabinetDoc } from '../shared/cabinetDoc'

const SYNC_URL = '/api/sync/cabinet'
const FETCH_TIMEOUT_MS = 20_000

/**
 * The wire ETag for a stored revision ("r3"). Duplicated from the shared
 * contract on purpose: `src/shared/cabinetDoc.ts` imports zod, and the client
 * must never pull zod into the browser bundle just for one template literal.
 */
export const revisionEtag = (revision: number): string => `"r${revision}"`

/** Reads a revision back out of a wire ETag, falling back when it is unusable. */
export function revisionFromEtag(etag: string, fallback: number): number {
  const match = /^"?r(\d+)"?$/.exec(etag.trim())
  return match ? Number(match[1]) : fallback
}

export interface SyncSnapshot {
  doc: CabinetDoc | null
  etag: string
}

export class SyncError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SyncError'
    this.status = status
  }
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
  if (!res.ok) throw new SyncError('Could not read the synced cabinet', res.status)
  return asSnapshot(body)
}

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
  if (!res.ok) throw new SyncError('Could not save the cabinet', res.status)
  return asSnapshot(body)
}
