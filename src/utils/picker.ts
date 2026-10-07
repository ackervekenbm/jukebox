// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

/**
 * Picks one random item, avoiding the most recent picks where the collection
 * allows it.
 *
 * The exclusion window starts at `skip` and shrinks until the remaining pool
 * is non-empty, so a collection smaller than the window degrades gracefully
 * instead of returning nothing — with a window at least as big as the
 * collection the result is simply repeat-free until everything has been
 * played. `recentIds` must be newest first; duplicate ids count once.
 *
 * Returns null only when there is nothing to pick from.
 */
export function pickAvoiding<T extends { id: number }>(
  candidates: T[],
  recentIds: number[],
  skip: number,
  rng: () => number = Math.random,
): T | null {
  if (candidates.length === 0) return null

  const uniqueRecent = [...new Set(recentIds)]
  const window = Math.min(Math.max(0, Math.trunc(skip)), uniqueRecent.length)

  for (let size = window; size > 0; size--) {
    const avoid = new Set(uniqueRecent.slice(0, size))
    const pool = candidates.filter((candidate) => !avoid.has(candidate.id))
    if (pool.length > 0) {
      return pool[Math.floor(rng() * pool.length)]
    }
  }

  // Nothing left outside the window (or skip is 0): pick from everything.
  return candidates[Math.floor(rng() * candidates.length)]
}
