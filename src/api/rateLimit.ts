// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

/**
 * Discogs allows about 60 authenticated requests per moving minute, and says
 * how many are left in every answer (`X-Discogs-Ratelimit-Remaining`, passed
 * through by the /discogs proxy). The budget reads that, estimates how much
 * has come back since, and holds new requests back before Discogs has to
 * refuse them; a 429 holds every caller, not only the one that got it.
 *
 * It's an estimate: the window is moving and other devices may share the
 * token, so a 429 can still happen, and callers keep their own retry.
 */

const WINDOW_MS = 60_000
const DEFAULT_LIMIT = 60
/** After a 429 without Retry-After: long enough for part of the window to clear. */
const DEFAULT_429_PAUSE_MS = 5_000
const MAX_429_PAUSE_MS = 30_000

/**
 * How many requests a caller leaves for others before waiting. Background
 * lookups (years, release notes) keep the larger reserve, so a record opened
 * meanwhile still gets an answer at once, and another device on the same
 * token doesn't push them into 429s. Their own steady pace (~51 a minute)
 * runs close to it, so they're often held for a second or so; that's normal
 * pacing, not a pause worth showing (see NOTABLE_WAIT_MS).
 */
export const RESERVE = { interactive: 2, background: 10 } as const

/**
 * A hold this long (or any 429 pause) is worth telling the user about; the
 * second-long nudges of normal pacing are not.
 */
export const NOTABLE_WAIT_MS = 3_000
export type Priority = keyof typeof RESERVE

const abortError = () => new DOMException('Aborted', 'AbortError')

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class RequestBudget {
  private limit = DEFAULT_LIMIT
  /** Requests left as of the last answer; null until Discogs has said. */
  private remaining: number | null = null
  private observedAt = 0
  private blockedUntil = 0
  private inFlight = 0
  /** Requests held back for a notable time, see NOTABLE_WAIT_MS. */
  private notableWaits = 0
  private listeners = new Set<() => void>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Forgets everything learned; for tests, where one shared budget spans many cases. */
  reset(): void {
    this.limit = DEFAULT_LIMIT
    this.remaining = null
    this.observedAt = 0
    this.blockedUntil = 0
    this.inFlight = 0
    this.notableWaits = 0
  }

  /** Requests estimated to be available now, after those already in flight. */
  available(): number {
    if (this.remaining === null) return Number.POSITIVE_INFINITY
    const recovered = ((this.now() - this.observedAt) / WINDOW_MS) * this.limit
    return Math.min(this.limit, this.remaining + recovered) - this.inFlight
  }

  /** How long a request of this priority should wait before it starts, in ms. */
  delay(priority: Priority = 'interactive'): number {
    const now = this.now()
    if (this.blockedUntil > now) return this.blockedUntil - now
    const short = RESERVE[priority] - this.available()
    if (short <= 0) return 0
    return Math.ceil((short / this.limit) * WINDOW_MS)
  }

  /**
   * Whether a request is held back for a notable time right now (a 429 pause,
   * or the budget running low), for the UI to say so.
   */
  isPausing(): boolean {
    return this.notableWaits > 0
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  /** Waits until a request of this priority may start, then counts it as in flight. */
  async acquire(priority: Priority = 'interactive', signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw abortError()
      const wait = this.delay(priority)
      if (wait <= 0) break
      const notable = wait >= NOTABLE_WAIT_MS || this.blockedUntil > this.now()
      if (notable && ++this.notableWaits === 1) this.notify()
      try {
        await abortableSleep(wait, signal)
      } finally {
        // Clamped: reset() may have zeroed the count while this one slept.
        if (notable && this.notableWaits > 0 && --this.notableWaits === 0) this.notify()
      }
    }
    this.inFlight++
  }

  /** Ends a request started with acquire, learning from its answer if there is one. */
  release(response?: Response): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    if (response) this.observe(response)
  }

  /** Reads the budget headers of an answer, and a 429's pause. */
  observe(response: Response): void {
    const now = this.now()
    const limit = Number(response.headers.get('x-discogs-ratelimit'))
    if (Number.isFinite(limit) && limit > 0) this.limit = limit
    const remaining = Number(response.headers.get('x-discogs-ratelimit-remaining') ?? NaN)
    // During a 429 pause, an answer that left Discogs before the 429 can
    // arrive late with an older, higher count; don't let it undo the pause.
    const stale = this.blockedUntil > now && remaining > (this.remaining ?? 0)
    if (Number.isFinite(remaining) && remaining >= 0 && !stale) {
      this.remaining = remaining
      this.observedAt = now
    }
    if (response.status === 429) {
      this.remaining = 0
      this.observedAt = now
      const retryAfter = Number(response.headers.get('retry-after') ?? '') * 1000
      const pause = retryAfter > 0 ? Math.min(retryAfter, MAX_429_PAUSE_MS) : DEFAULT_429_PAUSE_MS
      this.blockedUntil = Math.max(this.blockedUntil, now + pause)
    }
  }
}

/** The one budget every Discogs call in the app shares. */
export const discogsBudget = new RequestBudget()
