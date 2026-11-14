// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useCallback, useState } from 'react'
import type { MasterYears } from '../api/discogs'
import type { RecentPick } from '../components/ReleaseDetail'
import { getListenLog, getRecentListenIds, logListen, type ListenEntry } from '../db/listenLog'
import type { DiscogsCollectionRelease } from '../types/discogs'
import {
  creditedArtists,
  toDisplayRelease,
  type DisplayRelease,
  type PressingGroup,
} from '../utils/collection'
import { pickAvoiding } from '../utils/picker'

/** Shapes the stored log for the picker history in the detail overlay. */
function toRecentPicks(
  entries: ListenEntry[],
  currentId: number,
  releases: DiscogsCollectionRelease[],
): RecentPick[] {
  return entries
    .filter((entry) => entry.id !== currentId)
    .slice(0, 5)
    .map((entry) => {
      const basic = releases.find((release) => release.id === entry.id)?.basic_information
      if (!basic) return { id: entry.id, at: entry.at, label: `Release #${entry.id}` }
      const artist = basic.artists?.length ? creditedArtists(basic.artists) : ''
      return {
        id: entry.id,
        at: entry.at,
        label: artist ? `${artist} — ${basic.title}` : basic.title,
      }
    })
}

interface UseReleaseDetailArgs {
  releases: DiscogsCollectionRelease[]
  masterYears: MasterYears
  /** What the random picker draws from: the releases on screen. */
  candidates: DiscogsCollectionRelease[]
  /** Whose listen log the picker reads and writes; null without an account. */
  username: string | null
  pickerSkip: number
}

/**
 * The release open in the detail overlay, and how it got there: a card, a
 * pressing stack (with arrows through its pressings) or the random picker
 * (with its recent-pick history).
 */
export function useReleaseDetail({ releases, masterYears, candidates, username, pickerSkip }: UseReleaseDetailArgs) {
  const [selected, setSelected] = useState<DisplayRelease | null>(null)
  // Recent-pick history shown in the detail overlay; non-null only while the
  // release on screen came from the random picker.
  const [recentPicks, setRecentPicks] = useState<RecentPick[] | null>(null)
  // The master whose stack is open in the detail view, and which pressing of
  // it is showing; null for a release opened straight from the grid.
  const [stack, setStack] = useState<{ pressings: DisplayRelease[]; index: number } | null>(null)

  const pickRandom = useCallback(async () => {
    if (candidates.length === 0 || !username) return
    // The listen log only steers and annotates the pick: if IndexedDB fails,
    // pick from everything and open the release without its history.
    const recentIds = await getRecentListenIds(username, pickerSkip).catch(() => [])
    const picked = pickAvoiding(candidates, recentIds, pickerSkip)
    if (!picked) return
    let entries: ListenEntry[] = []
    try {
      // Every pick is logged — including re-rolls from an open detail view —
      // so the skip window always reflects what the picker actually served.
      await logListen(username, picked.id)
      entries = await getListenLog(username)
    } catch (err) {
      console.warn('[picker] could not update the listen log', err)
    }
    setRecentPicks(toRecentPicks(entries, picked.id, releases))
    setSelected(toDisplayRelease(picked, masterYears))
    setStack(null)
  }, [candidates, masterYears, releases, username, pickerSkip])

  /** Opening a card is browsing, not a listen: no history, no stack. */
  const openRelease = useCallback((display: DisplayRelease) => {
    setRecentPicks(null)
    setStack(null)
    setSelected(display)
  }, [])

  /** Opening a stack starts at the primary pressing; the arrows step onward. */
  const openStack = useCallback((group: PressingGroup) => {
    const pressings = group.rows.map((row) => row.release)
    if (pressings.length === 0) return
    setRecentPicks(null)
    setStack({ pressings, index: 0 })
    setSelected(pressings[0])
  }, [])

  /** Steps through the open stack, wrapping around at either end. */
  const stepStack = useCallback(
    (delta: number) => {
      if (!stack || stack.pressings.length === 0) return
      const total = stack.pressings.length
      const index = (stack.index + delta + total) % total
      setStack({ ...stack, index })
      setSelected(stack.pressings[index])
    },
    [stack],
  )

  /** History hops swap the release without logging another listen. */
  const openPick = useCallback(
    (id: number) => {
      const found = releases.find((release) => release.id === id)
      if (!found) return
      setStack(null)
      setSelected(toDisplayRelease(found, masterYears))
    },
    [releases, masterYears],
  )

  const close = useCallback(() => {
    setRecentPicks(null)
    setStack(null)
    setSelected(null)
  }, [])

  return { selected, recentPicks, stack, pickRandom, openRelease, openStack, stepStack, openPick, close }
}
