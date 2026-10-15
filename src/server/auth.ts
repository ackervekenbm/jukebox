import { createHash } from 'node:crypto'
import { DISCOGS_API_BASE, DISCOGS_USER_AGENT } from './config'

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

const TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 256

const memo = new Map<string, { username: string; expires: number }>()

export const parseToken = (header: string | undefined): string | null => {
  if (!header) return null
  const match = /^Discogs token=(\S+)$/.exec(header.trim())
  return match ? match[1] : null
}

export async function resolveUsername(token: string): Promise<string> {
  const key = createHash('sha256').update(token).digest('hex')
  const cached = memo.get(key)
  const now = Date.now()
  if (cached && cached.expires > now) return cached.username

  let response: Response
  try {
    response = await fetch(`${DISCOGS_API_BASE}/oauth/identity`, {
      headers: {
        Authorization: `Discogs token=${token}`,
        'User-Agent': DISCOGS_USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new AuthError(502, 'Discogs identity check is unreachable')
  }

  if (!response.ok) {
    throw new AuthError(401, 'Discogs rejected the token')
  }

  const body = (await response.json()) as { username?: string }
  if (!body.username) {
    throw new AuthError(502, 'Discogs identity response had no username')
  }

  if (memo.size >= MAX_ENTRIES) {
    for (const [entryKey, entry] of memo) {
      if (entry.expires <= now) memo.delete(entryKey)
    }
    if (memo.size >= MAX_ENTRIES) memo.clear()
  }
  memo.set(key, { username: body.username, expires: now + TTL_MS })
  return body.username
}
