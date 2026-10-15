import type { Request, Response as ExpressResponse } from 'express'
import { DISCOGS_API_BASE, DISCOGS_USER_AGENT, DISCOGS_TIMEOUT_MS } from './config'

const FORWARDED_REQUEST_HEADERS = ['accept']
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'retry-after', 'link']

export async function discogsProxy(req: Request, res: ExpressResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).set('Allow', 'GET, HEAD').json({ error: 'Method Not Allowed' })
    return
  }

  const target = `${DISCOGS_API_BASE}${req.originalUrl.replace(/^\/discogs/, '')}`
  const headers: Record<string, string> = { 'User-Agent': DISCOGS_USER_AGENT }
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name]
    if (typeof value === 'string') headers[name] = value
  }
  const authorization = req.headers.authorization
  if (authorization) headers.Authorization = authorization

  let upstream: globalThis.Response
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(DISCOGS_TIMEOUT_MS),
    })
  } catch {
    res.status(502).json({ error: 'Discogs API is unreachable' })
    return
  }

  res.status(upstream.status)
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) res.set(name, value)
  }
  for (const [name, value] of upstream.headers) {
    if (name.startsWith('x-discogs-')) res.set(name, value)
  }

  res.send(Buffer.from(await upstream.arrayBuffer()))
}
