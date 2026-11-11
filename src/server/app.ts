// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { anyCabinetDocSchema, etagForRevision, parseEtag, type CabinetDoc } from '../shared/cabinetDoc'
import { AuthError, parseToken, resolveUsername } from './auth'
import { dbReady, getCabinetRow, putCabinetRow, ConflictError } from './db'
import { discogsProxy } from './discogsProxy'

/**
 * Largest JSON body the API takes, in bytes. A bigger one gets a JSON 413,
 * which the client shows as "too large to sync".
 */
export const SYNC_BODY_LIMIT_BYTES = 256 * 1024

const distDir = path.resolve(process.env.CLIENT_DIST ?? path.resolve(process.cwd(), 'dist'))

const NO_CACHE_FILES = ['index.html', 'sw.js', 'manifest.webmanifest']

async function requireUser(req: Request, res: Response): Promise<string | null> {
  try {
    const token = parseToken(req.headers.authorization)
    if (!token) throw new AuthError(401, 'Missing Discogs token')
    return await resolveUsername(token)
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500
    if (status >= 500) console.error('[auth] identity check failed', err)
    res.status(status).json({ error: 'Discogs authentication failed' })
    return null
  }
}

export function createApp(): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: SYNC_BODY_LIMIT_BYTES }))

  app.get('/api/health', (_req, res) => {
    const db = dbReady()
    res.status(db ? 200 : 500).json({ ok: db, db })
  })

  // Apps cached from before version 2 don't validate what they read and still
  // expect the derived lists (their storage panel counts `placements`), so
  // every reply carries them empty. Nothing is stored; drop this once those
  // apps are gone.
  const forOlderApps = (doc: CabinetDoc) => ({
    ...doc,
    placements: {},
    overrides: {},
    unplaced: [],
  })

  // A stored row may still be version 1 (saved before version 2); hand it out
  // as version 2. A row that doesn't parse at all is returned as it is.
  const readStored = (doc: string): unknown => {
    const raw = JSON.parse(doc) as unknown
    const parsed = anyCabinetDocSchema.safeParse(raw)
    return parsed.success ? forOlderApps(parsed.data) : raw
  }

  app.get('/api/sync/cabinet', async (req, res) => {
    const username = await requireUser(req, res)
    if (!username) return
    const row = getCabinetRow(username)
    res.json({
      username,
      doc: row ? readStored(row.doc) : null,
      etag: etagForRevision(row?.revision ?? 0),
    })
  })

  app.put('/api/sync/cabinet', async (req, res) => {
    const username = await requireUser(req, res)
    if (!username) return

    // Either version is accepted and stored as version 2.
    const parsed = anyCabinetDocSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid cabinet document', issues: parsed.error.issues })
      return
    }

    const ifMatch = req.headers['if-match']
    if (!ifMatch) {
      res.status(428).json({ error: 'If-Match header is required' })
      return
    }
    const expected = parseEtag(ifMatch)
    if (expected === null) {
      res.status(400).json({ error: 'Malformed If-Match header' })
      return
    }

    try {
      // An app version from before sleeve calls or synced options existed
      // saves without them; keep the stored ones rather than wiping them.
      // Current clients always send both fields.
      let saved: CabinetDoc = parsed.data
      const row = putCabinetRow(
        username,
        (current) => {
          if ((parsed.data.sleeves === undefined || parsed.data.options === undefined) && current) {
            const stored = anyCabinetDocSchema.safeParse(JSON.parse(current.doc))
            if (stored.success) {
              const { sleeves, options } = stored.data
              saved = { ...(sleeves && { sleeves }), ...(options && { options }), ...parsed.data }
            }
          }
          return JSON.stringify(saved)
        },
        expected,
      )
      res.json({ username, doc: forOlderApps(saved), etag: etagForRevision(row.revision) })
    } catch (err) {
      if (err instanceof ConflictError) {
        const current = err.current
        res.status(409).json({
          error: 'Cabinet document is out of date',
          doc: current ? readStored(current.doc) : null,
          etag: etagForRevision(current?.revision ?? 0),
        })
        return
      }
      throw err
    }
  })

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not Found' })
  })

  app.use('/discogs', discogsProxy)

  if (existsSync(path.join(distDir, 'index.html'))) {
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath)
          if (NO_CACHE_FILES.includes(base)) {
            res.setHeader('Cache-Control', 'no-cache')
          } else if (filePath.includes(`${path.sep}assets${path.sep}`) || filePath.includes(`${path.sep}icons${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          }
        },
      }),
    )
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next()
        return
      }
      res.sendFile(path.join(distDir, 'index.html'), (err) => {
        if (err) next(err)
      })
    })
  } else {
    console.info('[jukebox] no client build found; serving API only')
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status: number = typeof err?.status === 'number' ? err.status : 500
    if (status >= 500) console.error('[server]', err)
    res.status(status).json({ error: status >= 500 ? 'Internal Server Error' : err.message })
  }
  app.use(errorHandler)

  return app
}
