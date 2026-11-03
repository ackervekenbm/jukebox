// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { discogsBudget } from '../api/rateLimit'
import { STALL_MS, discogsWaitNote, useDiscogsPausing, useDiscogsWaitNote, useStalled } from './useDiscogsWait'

beforeEach(() => {
  vi.useFakeTimers()
  discogsBudget.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useStalled', () => {
  it('says a job has stalled once it has not moved for a while', () => {
    const { result } = renderHook(({ done }) => useStalled(true, done), { initialProps: { done: 0 } })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(STALL_MS)
    })
    expect(result.current).toBe(true)
  })

  it('starts the clock again whenever the job moves on', () => {
    const { result, rerender } = renderHook(({ done }) => useStalled(true, done), {
      initialProps: { done: 0 },
    })
    act(() => {
      vi.advanceTimersByTime(STALL_MS - 1_000)
    })
    rerender({ done: 1 })
    act(() => {
      vi.advanceTimersByTime(STALL_MS - 1_000)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(STALL_MS)
    })
    expect(result.current).toBe(true)
    // Moving on clears it at once.
    rerender({ done: 2 })
    expect(result.current).toBe(false)
  })

  it('never reports a job that is not running', () => {
    const { result } = renderHook(() => useStalled(false, 0))
    act(() => {
      vi.advanceTimersByTime(STALL_MS * 2)
    })
    expect(result.current).toBe(false)
  })
})

describe('useDiscogsPausing', () => {
  it('follows the shared budget holding a request back', async () => {
    const { result } = renderHook(() => useDiscogsPausing())
    expect(result.current).toBe(false)

    discogsBudget.observe(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
    let waiting: Promise<void> = Promise.resolve()
    act(() => {
      waiting = discogsBudget.acquire('interactive')
    })
    expect(result.current).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
      await waiting
    })
    expect(result.current).toBe(false)
    discogsBudget.release()
  })
})

describe('discogsWaitNote', () => {
  it('names a rate-limit pause before a slow answer, and nothing otherwise', () => {
    expect(discogsWaitNote(true, true)).toBe("pausing to stay within Discogs' rate limit")
    expect(discogsWaitNote(false, true)).toBe('waiting for Discogs to answer')
    expect(discogsWaitNote(false, false)).toBeNull()
  })

  it('stays silent for a job that is not running', () => {
    discogsBudget.observe(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
    void discogsBudget.acquire('background')
    const { result } = renderHook(() => useDiscogsWaitNote(false, 0))
    expect(result.current).toBeNull()
  })
})
