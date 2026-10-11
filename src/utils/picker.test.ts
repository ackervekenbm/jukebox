// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import { pickAvoiding } from './picker'

const items = (ids: number[]) => ids.map((id) => ({ id }))

describe('pickAvoiding', () => {
  it('returns null when there is nothing to pick from', () => {
    expect(pickAvoiding([], [], 10)).toBeNull()
    expect(pickAvoiding([], [1, 2], 10)).toBeNull()
  })

  it('picks uniformly from everything when skip is 0', () => {
    // The window never opens, so even heavily played releases stay eligible.
    expect(pickAvoiding(items([1, 2, 3]), [1, 2, 3], 0, () => 0.99)?.id).toBe(3)
    expect(pickAvoiding(items([1, 2, 3]), [1, 2, 3], 0, () => 0)?.id).toBe(1)
  })

  it('avoids the most recent picks while alternatives exist', () => {
    // rng pinned to 0 picks the first candidate of the filtered pool.
    expect(pickAvoiding(items([1, 2, 3, 4]), [4, 3], 2, () => 0)?.id).toBe(1)
    // A wider window still leaves the same untouched pool.
    expect(pickAvoiding(items([1, 2, 3, 4]), [4, 3, 2], 10, () => 0)?.id).toBe(1)
  })

  it('shrinks the window instead of failing when the pool would be empty', () => {
    // Only two releases and one is recent: window 10 cannot avoid it.
    expect(pickAvoiding(items([1, 2]), [1], 10, () => 0)?.id).toBe(2)
    // The whole collection is inside the window: fall back to everything.
    expect(pickAvoiding(items([1, 2]), [2, 1], 10, () => 0)?.id).toBe(1)
  })

  it('counts duplicate log entries once', () => {
    expect(pickAvoiding(items([1, 2]), [1, 1, 1], 3, () => 0)?.id).toBe(2)
  })

  it('plays repeat-free until the collection runs out when the window covers it', () => {
    const candidates = items([1, 2, 3])
    const played: number[] = []
    for (let i = 0; i < 3; i++) {
      const pick = pickAvoiding(candidates, played, 10, () => 0)
      if (pick) played.unshift(pick.id)
    }
    expect(played).toEqual([3, 2, 1])
  })

  it('leaves the candidate list untouched', () => {
    const candidates = items([3, 1, 2])
    pickAvoiding(candidates, [3], 5, () => 0)
    expect(candidates.map((candidate) => candidate.id)).toEqual([3, 1, 2])
  })
})
