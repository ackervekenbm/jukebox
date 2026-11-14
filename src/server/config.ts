// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import path from 'node:path'

/*
 * Every environment variable the server reads, in one place (the deployment
 * ones are documented in docs/deploy/README.md). Read once at startup: a bad number stops the server
 * with a clear message instead of running with NaN.
 */

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number, got "${raw}"`)
  }
  return value
}

export const PORT = positiveInt('PORT', 3000)
export const HOST = process.env.HOST ?? '127.0.0.1'

/** Where the SQLite sync store lives. */
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data')
/** The built client the server hands out; without it the server is API only. */
export const CLIENT_DIST = path.resolve(process.env.CLIENT_DIST ?? 'dist')

export const DISCOGS_API_BASE = process.env.DISCOGS_API_BASE ?? 'https://api.discogs.com'
export const DISCOGS_USER_AGENT =
  process.env.DISCOGS_USER_AGENT ?? 'Jukebox/1.0 (https://github.com/ackervekenbm/jukebox)'
export const DISCOGS_TIMEOUT_MS = positiveInt('DISCOGS_TIMEOUT_MS', 30_000)
