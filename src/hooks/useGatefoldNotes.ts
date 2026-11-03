// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useEffect, useRef, useState } from 'react'
import type { DisplayRelease } from '../utils/collection'
import { needsNotesCheck } from '../utils/cabinet'
import { DiscogsError, fetchReleaseNotes } from '../api/discogs'
import { getReleaseNotes, setReleaseNotes } from '../db/collection'

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
   * Hold off until the collection has loaded: while its own enrichment runs the
   * two would split the Discogs rate budget, and after a failed load (a bad
   * token, no network) every request would fail too.
   */
  paused: boolean
  /** Release id → the user's own call; those releases need no notes. */
  overrides?: Record<string, boolean>
}

export interface UseGatefoldNotesResult {
  /** Release id → its notes text ('' when it has none). */
  notes: Record<string, string>
  /** The running scan, null when nothing is left to check. */
  progress: GatefoldScanProgress | null
  /** Why the scan stopped early (Discogs refused the token), else null. */
  error: string | null
}

const NO_OVERRIDES: Record<string, boolean> = {}

/**
 * What each vinyl release's notes say. The collection listing leaves notes
 * out, so the scan reads the full release once per record they could matter
 * for, caches the notes for good, and streams them in so the layout updates as
 * it goes. Closing the cabinet stops the scan; it picks up where it left off
 * next time.
 */
export function useGatefoldNotes({
  releases,
  token,
  enabled,
  paused,
  overrides = NO_OVERRIDES,
}: UseGatefoldNotesArgs): UseGatefoldNotesResult {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState<GatefoldScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The scan reads these through refs, so a streamed answer or a toggle doesn't
  // restart the scan it came from.
  const notesRef = useRef(notes)
  const overridesRef = useRef(overrides)
  useEffect(() => {
    notesRef.current = notes
    overridesRef.current = overrides
  }, [notes, overrides])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    getReleaseNotes()
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
    const facts = { notes: notesRef.current, overrides: overridesRef.current }
    const ids = [
      ...new Set(
        releases.filter((display) => needsNotesCheck(display, facts)).map((display) => display.id),
      ),
    ]
    if (ids.length === 0) return

    const controller = new AbortController()
    setError(null)
    setProgress({ done: 0, total: ids.length })
    fetchReleaseNotes(
      ids,
      token,
      (done, total) => {
        if (!controller.signal.aborted) setProgress({ done, total })
      },
      controller.signal,
      (releaseId, text) => {
        setReleaseNotes(releaseId, text).catch(() => {})
        if (controller.signal.aborted) return
        setNotes((current) => ({ ...current, [String(releaseId)]: text }))
      },
    )
      .catch((err) => {
        // Unanswered releases are asked again next time. A refused token would
        // only fail again, so say so instead of retrying silently.
        if (controller.signal.aborted) return
        if (err instanceof DiscogsError && (err.status === 401 || err.status === 403)) {
          setError('Discogs refused the token, so release notes were not checked.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setProgress(null)
      })

    return () => {
      controller.abort()
      setProgress(null)
    }
  }, [enabled, loaded, paused, token, releases])

  return { notes, progress, error }
}
