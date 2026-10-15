import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export interface CabinetRow {
  username: string
  doc: string
  revision: number
  savedAt: string
}

export class ConflictError extends Error {
  constructor(readonly current: CabinetRow | null) {
    super('cabinet document revision conflict')
    this.name = 'ConflictError'
  }
}

const dataDir = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'))
mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, 'jukebox.db'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS cabinet_docs (
    username TEXT PRIMARY KEY,
    doc TEXT NOT NULL,
    revision INTEGER NOT NULL,
    saved_at TEXT NOT NULL
  )
`)

const selectStmt = db.prepare(
  'SELECT username, doc, revision, saved_at AS savedAt FROM cabinet_docs WHERE username = ?',
)

const insertStmt = db.prepare(
  'INSERT INTO cabinet_docs (username, doc, revision, saved_at) VALUES (?, ?, ?, ?)',
)

const updateStmt = db.prepare(
  'UPDATE cabinet_docs SET doc = ?, revision = ?, saved_at = ? WHERE username = ?',
)

export const getCabinetRow = (username: string): CabinetRow | null =>
  (selectStmt.get(username) as CabinetRow | undefined) ?? null

export const putCabinetRow = (
  username: string,
  doc: string,
  expected: number | 'force',
): CabinetRow => {
  const save = db.transaction((): CabinetRow => {
    const current = getCabinetRow(username)
    const currentRevision = current?.revision ?? 0
    if (expected !== 'force' && expected !== currentRevision) {
      throw new ConflictError(current)
    }
    const nextRevision = currentRevision + 1
    const savedAt = new Date().toISOString()
    if (current) {
      updateStmt.run(doc, nextRevision, savedAt, username)
    } else {
      insertStmt.run(username, doc, nextRevision, savedAt)
    }
    return getCabinetRow(username)!
  })
  return save()
}

export const dbReady = (): boolean => {
  try {
    db.prepare('SELECT 1').get()
    return true
  } catch {
    return false
  }
}

export const closeDb = (): void => {
  db.close()
}
