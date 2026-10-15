export const DISCOGS_API_BASE = process.env.DISCOGS_API_BASE ?? 'https://api.discogs.com'

export const DISCOGS_USER_AGENT =
  process.env.DISCOGS_USER_AGENT ?? 'Jukebox/1.0 (https://github.com/ackervekenbm/jukebox)'

export const DISCOGS_TIMEOUT_MS = Number(process.env.DISCOGS_TIMEOUT_MS ?? 30_000)
