// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useEffect, useRef, useState } from 'react'
import type { DisplayRelease } from '../utils/collection'
import { needsNotesCheck } from '../utils/cabinet'
import { fetchReleaseGatefolds } from '../api/discogs'
import { getReleaseGatefolds, setReleaseGatefold } from '../db/collection'

export interface GatefoldScanProgress {
  done: number
  total: number
}

export interface UseGatefoldNotesArgs {
  releases: DisplayRelease[]
  token: string | null
  /** The scan only runs while the cabinet is on screen. */
  enabled: boolean
  /**
   * Hold off while the collection's own enrichment runs, so the two don't split
   * the Discogs rate budget and throttle each other.
   */
  paused: boolean
}

export interface UseGatefoldNotesResult {
  /** Release id → whether its notes describe a gatefold. */
  notes: Record<string, boolean>
  /** The running scan, null when nothing is left to check. */
  progress: GatefoldScanProgress | null
}

/**
 * What each vinyl release's notes say about its sleeve. The collection listing
 * leaves notes out, so the scan reads the full release once per record it
 * could matter for, caches every answer for good (a sleeve never changes), and
 * streams answers in so the layout updates as it goes. Closing the cabinet
 * stops the scan; it picks up where it left off next time.
 */
export function useGatefoldNotes({
  releases,
  token,
  enabled,
  paused,
}: UseGatefoldNotesArgs): UseGatefoldNotesResult {
  const [notes, setNotes] = useState<Record<string, boolean>>({})
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState<GatefoldScanProgress | null>(null)

  // The scan reads answers through this ref, so a streamed answer doesn't
  // restart the scan it came from.
  const notesRef = useRef(notes)
  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    getReleaseGatefolds()
      .catch(() => ({}))
      .then((cached) => {
        if (cancelled) return
        setNotes(cached)
        notesRef.current = cached
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || !loaded || paused || !token) return
    const ids = [
      ...new Set(
        releases
          .filter((display) => needsNotesCheck(display, { notes: notesRef.current }))
          .map((display) => display.id),
      ),
    ]
    if (ids.length === 0) return

    const controller = new AbortController()
    setProgress({ done: 0, total: ids.length })
    fetchReleaseGatefolds(
      ids,
      token,
      (done, total) => {
        if (!controller.signal.aborted) setProgress({ done, total })
      },
      controller.signal,
      (releaseId, gatefold) => {
        setReleaseGatefold(releaseId, gatefold).catch(() => {})
        if (controller.signal.aborted) return
        setNotes((current) => ({ ...current, [String(releaseId)]: gatefold }))
      },
    )
      .catch(() => {
        // Aborted or failed: unanswered releases are asked again next time.
      })
      .finally(() => {
        if (!controller.signal.aborted) setProgress(null)
      })

    return () => {
      controller.abort()
      setProgress(null)
    }
  }, [enabled, loaded, paused, token, releases])

  return { notes, progress }
}
