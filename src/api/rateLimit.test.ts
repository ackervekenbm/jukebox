// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTABLE_WAIT_MS, RESERVE, RequestBudget } from './rateLimit'

let now = 0
const budget = () => new RequestBudget(() => now)

function answer(remaining: number | null, status = 200, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { 'x-discogs-ratelimit': '60', ...extra }
  if (remaining !== null) headers['x-discogs-ratelimit-remaining'] = String(remaining)
  return new Response('{}', { status, headers })
}

beforeEach(() => {
  now = 1_000_000
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RequestBudget', () => {
  it('lets requests through at once until Discogs has said how many are left', () => {
    const b = budget()
    expect(b.delay('background')).toBe(0)
    b.observe(answer(null))
    expect(b.delay('background')).toBe(0)
  })

  it('holds requests back as the remaining budget runs low, background first', () => {
    const b = budget()
    b.observe(answer(30))
    expect(b.delay('background')).toBe(0)

    b.observe(answer(6))
    // Background keeps a reserve of 10: it is 4 short, about 4 seconds' worth.
    expect(b.delay('background')).toBe(4_000)
    // A request the user is waiting for keeps a reserve of only 2.
    expect(b.delay('interactive')).toBe(0)
    expect(RESERVE.background).toBeGreaterThan(RESERVE.interactive)
  })

  it('holds the lookups\' own steady pace only briefly', () => {
    // ~51 a minute leaves Discogs reporting ~9 left, with one more on its way:
    // a nudge of about two seconds, under what counts as a pause.
    const b = budget()
    b.observe(answer(9))
    void b.acquire('interactive')
    expect(b.delay('background')).toBe(2_000)
    expect(b.delay('background')).toBeLessThan(NOTABLE_WAIT_MS)
  })

  it('counts the budget back up as the moving window clears', () => {
    const b = budget()
    b.observe(answer(0))
    expect(b.delay('interactive')).toBe(2_000)
    now += 2_000
    expect(b.delay('interactive')).toBe(0)
  })

  it('counts requests already on their way against the budget', () => {
    const b = budget()
    b.observe(answer(12))
    expect(b.delay('background')).toBe(0)
    void b.acquire('interactive')
    void b.acquire('interactive')
    expect(b.available()).toBe(10)
    void b.acquire('interactive')
    expect(b.delay('background')).toBe(1_000)
    b.release()
    expect(b.delay('background')).toBe(0)
  })

  it('pauses everyone for as long as a 429 asks, capped at 30 seconds', () => {
    const b = budget()
    b.observe(answer(null, 429, { 'retry-after': '7' }))
    expect(b.delay('interactive')).toBe(7_000)
    expect(b.delay('background')).toBe(7_000)

    const capped = budget()
    capped.observe(answer(null, 429, { 'retry-after': '600' }))
    expect(capped.delay('interactive')).toBe(30_000)
  })

  it('pauses a few seconds after a 429 that gives no Retry-After', () => {
    const b = budget()
    b.observe(answer(null, 429))
    expect(b.delay('interactive')).toBe(5_000)
    now += 4_000
    // Still paused, for everyone.
    expect(b.delay('background')).toBe(1_000)
    now += 1_000
    // Five seconds of the window have cleared: enough for a request the user
    // waits for; background keeps its larger reserve a little longer.
    expect(b.delay('interactive')).toBe(0)
    expect(b.delay('background')).toBe(5_000)
  })

  it('ignores an older, higher count that arrives late during a 429 pause', () => {
    const b = budget()
    b.observe(answer(null, 429, { 'retry-after': '10' }))
    // A 200 that left Discogs before the 429 shows up afterwards.
    b.observe(answer(25))
    now += 10_000
    expect(b.available()).toBe(10)
    // Once the pause is over, a fresh count is taken as usual.
    b.observe(answer(25))
    expect(b.available()).toBe(25)
  })

  it('does not call the brief holds of normal pacing a pause', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const b = new RequestBudget()
    const changes: boolean[] = []
    b.subscribe(() => changes.push(b.isPausing()))
    // Nine left: background is one short, about a second's wait.
    b.observe(answer(9))
    const brief = b.acquire('background')
    expect(b.isPausing()).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    await brief
    b.release()
    expect(changes).toEqual([])

    // Run dry: the wait is long enough to be worth saying.
    b.observe(answer(0))
    const long = b.acquire('background')
    expect(b.isPausing()).toBe(true)
    // Ten short of its reserve: about ten seconds.
    await vi.advanceTimersByTimeAsync(10_000)
    await long
    expect(b.isPausing()).toBe(false)
    expect(changes).toEqual([true, false])
  })

  it('keeps its pause count sane when reset while a request waits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const b = new RequestBudget()
    b.observe(answer(null, 429, { 'retry-after': '3' }))
    const waiting = b.acquire('interactive')
    b.reset()
    await vi.advanceTimersByTimeAsync(3_000)
    await waiting
    expect(b.isPausing()).toBe(false)
    b.observe(answer(null, 429, { 'retry-after': '3' }))
    void b.acquire('interactive')
    expect(b.isPausing()).toBe(true)
  })

  it('says when it is holding a request back, and when it lets go', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const b = new RequestBudget()
    const states: boolean[] = []
    b.subscribe(() => states.push(b.isPausing()))
    b.observe(answer(null, 429, { 'retry-after': '3' }))

    const waiting = b.acquire('interactive')
    expect(b.isPausing()).toBe(true)
    await vi.advanceTimersByTimeAsync(3_000)
    await waiting
    expect(b.isPausing()).toBe(false)
    expect(states).toEqual([true, false])
  })

  it('stops waiting when the caller gives up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const b = new RequestBudget()
    b.observe(answer(null, 429, { 'retry-after': '20' }))
    const controller = new AbortController()

    const waiting = b.acquire('interactive', controller.signal)
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(b.isPausing()).toBe(false)
  })
})
