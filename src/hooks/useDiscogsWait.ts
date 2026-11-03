// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useEffect, useState, useSyncExternalStore } from 'react'
import { discogsBudget } from '../api/rateLimit'

const subscribe = (listener: () => void) => discogsBudget.subscribe(listener)
const isPausing = () => discogsBudget.isPausing()

/** Whether the shared Discogs budget is holding a request back right now. */
export function useDiscogsPausing(): boolean {
  return useSyncExternalStore(subscribe, isPausing, () => false)
}

/** How long progress may stand still before it's worth saying so. */
export const STALL_MS = 15_000

/**
 * Whether a running job has made no progress for a while. \`progress\` is any
 * value that changes when the job moves on (a count); every change restarts
 * the clock.
 */
export function useStalled(active: boolean, progress: unknown, afterMs = STALL_MS): boolean {
  const [stalled, setStalled] = useState(false)
  const [seen, setSeen] = useState({ active, progress })
  if (seen.active !== active || seen.progress !== progress) {
    setSeen({ active, progress })
    setStalled(false)
  }

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setStalled(true), afterMs)
    return () => clearTimeout(timer)
  }, [active, progress, afterMs])

  return active && stalled
}

/**
 * Why a Discogs job isn't moving, to append to its progress text, or null when
 * it is. A deliberate pause for the rate limit says so; otherwise a long
 * silence means Discogs is slow to answer.
 */
export function discogsWaitNote(pausing: boolean, stalled: boolean): string | null {
  if (pausing) return "pausing to stay within Discogs' rate limit"
  if (stalled) return 'waiting for Discogs to answer'
  return null
}

/** The note for a running job: \`progress\` changes whenever it moves on. */
export function useDiscogsWaitNote(active: boolean, progress: unknown): string | null {
  const pausing = useDiscogsPausing()
  const stalled = useStalled(active, progress)
  return active ? discogsWaitNote(pausing, stalled) : null
}
