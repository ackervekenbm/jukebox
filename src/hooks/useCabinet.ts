// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cabinet, CabinetDoc, Slot } from '../shared/cabinetDoc'
import type { DisplayRelease } from '../utils/collection'
import {
  detectedGatefold,
  planCabinet,
  type CabinetPlan,
  type CabinetSortMode,
  type SleeveFacts,
} from '../utils/cabinet'
import { useGatefoldNotes, type GatefoldScanProgress } from './useGatefoldNotes'
import { clearCabinet, getCabinet, putCabinet } from '../db/cabinet'
import { loadCabinetOptions, saveCabinetOptions, type CabinetOptions } from '../db/cabinetOptions'
import {
  fetchCabinet,
  pushCabinet,
  revisionEtag,
  revisionFromEtag,
  SyncConflictError,
} from '../api/sync'

const PUSH_DEBOUNCE_MS = 800
const MAX_PUSH_ATTEMPTS = 3
const DEFAULT_SHELF_CAPACITY = 75

export type CabinetStatus = 'local' | 'loading' | 'syncing' | 'synced' | 'offline' | 'error'

export function defaultCabinetSlot(index: number): Slot {
  return { id: `slot-${index}`, label: `Shelf ${index}`, capacity: DEFAULT_SHELF_CAPACITY }
}

/** A starter cabinet: two shelves, roughly the size of a real LP shelf. */
export function defaultCabinet(): Cabinet {
  return {
    id: 'main',
    name: 'Record Cabinet',
    slots: [defaultCabinetSlot(1), defaultCabinetSlot(2)],
  }
}

/**
 * An id for a new shelf that no existing shelf uses: one past the highest
 * `slot-<n>`. Counting the shelves instead would reuse an id after a shelf in
 * the middle was removed, and two shelves would then share placements.
 */
export function nextSlotId(slots: Slot[]): string {
  let highest = 0
  for (const slot of slots) {
    const match = /^slot-(\d+)$/.exec(slot.id)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `slot-${highest + 1}`
}

/**
 * Gives every shelf an id of its own. Older app versions numbered new shelves
 * by count, so a synced cabinet can hold two shelves with one id; removing one
 * would then remove both. Later duplicates get a fresh id; the first keeps it.
 */
export function withUniqueSlotIds(cabinets: Cabinet[]): Cabinet[] {
  return cabinets.map((entry) => {
    const seen = new Set<string>()
    let changed = false
    const slots: Slot[] = []
    for (const slot of entry.slots) {
      if (seen.has(slot.id)) {
        changed = true
        slots.push({ ...slot, id: nextSlotId([...entry.slots, ...slots]) })
      } else {
        slots.push(slot)
      }
      seen.add(slots[slots.length - 1].id)
    }
    return changed ? { ...entry, slots } : entry
  })
}

/** The cabinets to show for a stored or synced document. */
function cabinetsOf(doc: CabinetDoc): Cabinet[] {
  // No cabinet at all means a document from before cabinets existed; a cabinet
  // without shelves is a layout the user started over, and stays empty.
  return doc.cabinets.length > 0 ? withUniqueSlotIds(doc.cabinets) : [defaultCabinet()]
}

/** The synced document for a computed layout, stamped with the current time. */
export function buildCabinetDoc(
  cabinets: Cabinet[],
  plan: CabinetPlan,
  sleeves: Record<string, boolean> = {},
): CabinetDoc {
  return {
    schemaVersion: 1,
    cabinets,
    placements: plan.placements,
    overrides: {},
    unplaced: plan.unplaced.map((record: DisplayRelease) => record.key),
    sleeves,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Keeps the local copy after a 409: the device that is being edited wins, and
 * the placements are recomputed from the collection anyway.
 */
export function rebaseCabinetDoc(local: CabinetDoc): CabinetDoc {
  return {
    ...local,
    cabinets: local.cabinets,
    overrides: {},
    updatedAt: new Date().toISOString(),
  }
}

export interface UseCabinetArgs {
  username: string
  token: string | null
  releases: DisplayRelease[]
  /** The cabinet only loads and syncs while its screen is on. */
  enabled: boolean
  /** The collection is still enriching: hold the gatefold scan until it's done. */
  collectionBusy?: boolean
}

export interface RemovedSlot {
  slot: Slot
  index: number
}

export interface UseCabinetResult {
  cabinets: Cabinet[]
  cabinet: Cabinet
  options: CabinetOptions
  plan: CabinetPlan
  /** What is known about sleeves: release notes and the user's own calls. */
  sleeves: SleeveFacts
  /** The release-notes gatefold scan, null when idle. */
  gatefoldScan: GatefoldScanProgress | null
  status: CabinetStatus
  dirty: boolean
  error: string | null
  addSlot: (capacity?: number) => void
  updateSlot: (slotId: string, patch: Partial<Slot>) => void
  /** Removes a shelf and returns it with its position, so it can be put back. */
  removeSlot: (slotId: string) => RemovedSlot | null
  /** Puts a removed shelf back where it was. */
  restoreSlot: (removed: RemovedSlot) => void
  setSort: (sort: CabinetSortMode) => void
  setSeparateSizeClasses: (separate: boolean) => void
  /** Flip a record between gatefold and standard sleeve, overriding detection. */
  toggleGatefold: (display: DisplayRelease) => void
  retry: () => void
  reset: () => Promise<void>
}

export function useCabinet({
  username,
  token,
  releases,
  enabled,
  collectionBusy = false,
}: UseCabinetArgs): UseCabinetResult {
  const [cabinets, setCabinets] = useState<Cabinet[]>(() => [defaultCabinet()])
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [options, setOptions] = useState<CabinetOptions>(() => loadCabinetOptions())
  const [revision, setRevision] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<CabinetStatus>('local')
  const [error, setError] = useState<string | null>(null)

  const { notes, progress: gatefoldScan } = useGatefoldNotes({
    releases,
    token,
    enabled,
    paused: collectionBusy,
  })
  const sleeves = useMemo<SleeveFacts>(() => ({ notes, overrides }), [notes, overrides])

  const cabinet = cabinets[0]
  const plan = useMemo(
    () => planCabinet({ releases, cabinet, options, sleeves }),
    [releases, cabinet, options, sleeves],
  )
  const doc = useMemo(
    () => buildCabinetDoc(cabinets, plan, overrides),
    [cabinets, plan, overrides],
  )

  // Detection can only be checked against the live facts, so the toggle reads
  // them through a ref rather than closing over a stale copy.
  const sleevesRef = useRef(sleeves)
  useEffect(() => {
    sleevesRef.current = sleeves
  }, [sleeves])

  // Debounced pushes and retries read the live copies through this ref.
  const live = useRef({ token, revision, doc })
  useEffect(() => {
    live.current = { token, revision, doc }
  }, [token, revision, doc])

  const persist = useCallback(
    (nextDoc: CabinetDoc, nextRevision: number, nextDirty: boolean) => {
      if (!username) return
      void putCabinet({ username, doc: nextDoc, revision: nextRevision, dirty: nextDirty })
    },
    [username],
  )

  // Every local edit bumps this, so a push can tell whether the cabinet moved
  // on while it was in flight.
  const edits = useRef(0)
  const edited = useCallback(() => {
    edits.current++
    setDirty(true)
  }, [])

  /**
   * Pushes a document, rebasing and retrying while the server reports a newer
   * revision. Gives up after a few rounds so a rebase loop cannot spin.
   *
   * An edit made while the push is in flight must not be lost: the push only
   * marks the cabinet clean when nothing changed meanwhile, and a rebase
   * builds on the latest local copy rather than the one it sent.
   */
  const pushOnce = useCallback(
    async (startDoc: CabinetDoc, startRevision: number): Promise<void> => {
      const authToken = live.current.token
      if (!authToken) {
        setStatus('local')
        return
      }
      setStatus('syncing')
      const editsAtStart = edits.current
      let nextDoc = startDoc
      let nextRevision = startRevision

      for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
        try {
          const result = await pushCabinet(authToken, nextDoc, revisionEtag(nextRevision))
          const savedRevision = revisionFromEtag(result.etag, nextRevision + 1)
          setRevision(savedRevision)
          // A push queued behind this one must start from the saved revision.
          live.current = { ...live.current, revision: savedRevision }
          setError(null)
          if (edits.current === editsAtStart) {
            setDirty(false)
            setStatus('synced')
            persist(nextDoc, savedRevision, false)
          } else {
            // Newer edits are waiting; they stay dirty and get their own push.
            persist(live.current.doc, savedRevision, true)
          }
          return
        } catch (err) {
          if (err instanceof SyncConflictError) {
            const base = edits.current === editsAtStart ? nextDoc : live.current.doc
            nextDoc = rebaseCabinetDoc(base)
            nextRevision = revisionFromEtag(err.etag, nextRevision)
            setCabinets(nextDoc.cabinets)
            setOverrides(nextDoc.sleeves ?? {})
            setRevision(nextRevision)
            persist(nextDoc, nextRevision, true)
            continue
          }
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Sync failed')
          return
        }
      }

      setStatus('error')
      setError('Could not reconcile the cabinet with the server')
    },
    [persist],
  )

  // One push at a time: a push asked for while another is in flight waits for
  // it, then sends the latest local copy from the revision it saved.
  const inFlight = useRef(false)
  const queued = useRef(false)
  const push = useCallback(
    async (startDoc: CabinetDoc, startRevision: number): Promise<void> => {
      if (inFlight.current) {
        queued.current = true
        return
      }
      inFlight.current = true
      try {
        await pushOnce(startDoc, startRevision)
        while (queued.current) {
          queued.current = false
          await pushOnce(live.current.doc, live.current.revision)
        }
      } finally {
        inFlight.current = false
      }
    },
    [pushOnce],
  )

  useEffect(() => {
    if (!enabled || !username) return
    let cancelled = false

    void (async () => {
      const stored = await getCabinet(username)
      if (cancelled) return
      if (stored) {
        setCabinets(cabinetsOf(stored.doc))
        setOverrides(stored.doc.sleeves ?? {})
        setRevision(stored.revision)
        setDirty(stored.dirty)
      } else {
        setCabinets([defaultCabinet()])
        setOverrides({})
        setRevision(0)
        setDirty(false)
      }

      if (!token) {
        setStatus('local')
        return
      }

      try {
        const remote = await fetchCabinet(token)
        if (cancelled) return
        const remoteRevision = revisionFromEtag(remote.etag, 0)

        if (!remote.doc) {
          if (stored?.dirty) await push(stored.doc, stored.revision)
          else setStatus('synced')
          return
        }
        if (stored?.dirty) {
          const rebased = rebaseCabinetDoc({ ...stored.doc, cabinets: cabinetsOf(stored.doc) })
          setCabinets(rebased.cabinets)
          setOverrides(rebased.sleeves ?? {})
          setRevision(remoteRevision)
          await push(rebased, remoteRevision)
          return
        }
        setCabinets(cabinetsOf(remote.doc))
        setOverrides(remote.doc.sleeves ?? {})
        setRevision(remoteRevision)
        setStatus('synced')
        persist(remote.doc, remoteRevision, false)
      } catch {
        if (cancelled) return
        setStatus('offline')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, username, token, persist, push])

  useEffect(() => {
    if (!dirty || !enabled) return
    const timer = setTimeout(() => {
      void push(live.current.doc, live.current.revision)
    }, PUSH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [dirty, doc, enabled, push])

  useEffect(() => {
    if (!dirty || !enabled || !username) return
    persist(doc, revision, true)
  }, [dirty, enabled, doc, revision, username, persist])

  const addSlot = useCallback((capacity?: number) => {
    setCabinets((current) => {
      const first = current[0]
      const cap =
        typeof capacity === 'number' && Number.isFinite(capacity) && capacity > 0
          ? Math.max(1, Math.round(capacity))
          : DEFAULT_SHELF_CAPACITY
      // The label is stored for the sync schema; the screen numbers shelves by
      // position instead.
      return [
        {
          ...first,
          slots: [
            ...first.slots,
            {
              id: nextSlotId(first.slots),
              label: `Shelf ${first.slots.length + 1}`,
              capacity: cap,
            },
          ],
        },
        ...current.slice(1),
      ]
    })
    edited()
  }, [edited])

  const updateSlot = useCallback((slotId: string, patch: Partial<Slot>) => {
    setCabinets((current) =>
      current.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              slots: entry.slots.map((slot) =>
                slot.id === slotId ? { ...slot, ...patch, id: slot.id } : slot,
              ),
            }
          : entry,
      ),
    )
    edited()
  }, [edited])

  const removeSlot = useCallback(
    (slotId: string): RemovedSlot | null => {
      const index = cabinets[0].slots.findIndex((slot) => slot.id === slotId)
      if (index < 0) return null
      const removed = { slot: cabinets[0].slots[index], index }
      setCabinets((current) => {
        const first = current[0]
        return [
          { ...first, slots: first.slots.filter((slot) => slot.id !== slotId) },
          ...current.slice(1),
        ]
      })
      edited()
      return removed
    },
    [cabinets, edited],
  )

  const restoreSlot = useCallback(
    ({ slot, index }: RemovedSlot) => {
      setCabinets((current) => {
        const first = current[0]
        // A shelf added since may have taken the id; the restored one then gets
        // a fresh one, so two shelves never share an id.
        const restored = first.slots.some((existing) => existing.id === slot.id)
          ? { ...slot, id: nextSlotId(first.slots) }
          : slot
        const slots = [...first.slots]
        slots.splice(Math.min(index, slots.length), 0, restored)
        return [{ ...first, slots }, ...current.slice(1)]
      })
      edited()
    },
    [edited],
  )

  const setSort = useCallback((sort: CabinetSortMode) => {
    setOptions((current) => {
      const next = { ...current, sort }
      saveCabinetOptions(next)
      return next
    })
  }, [])

  const setSeparateSizeClasses = useCallback((separateSizeClasses: boolean) => {
    setOptions((current) => {
      const next = { ...current, separateSizeClasses }
      saveCabinetOptions(next)
      return next
    })
  }, [])

  const toggleGatefold = useCallback(
    (display: DisplayRelease) => {
      const id = String(display.id)
      // Detection only needs the notes, which the ref holds; the overrides are
      // read from the updater so two quick toggles can't read a stale copy.
      const detected = detectedGatefold(display, { notes: sleevesRef.current.notes })
      setOverrides((current) => {
        const next = !(current[id] ?? detected)
        const updated = { ...current }
        // Agreeing with detection drops the call, so a later fix on Discogs
        // (or in the notes scan) still reaches this record.
        if (next === detected) delete updated[id]
        else updated[id] = next
        return updated
      })
      edited()
    },
    [edited],
  )

  const retry = useCallback(() => {
    setDirty(true)
    setError(null)
    void push(live.current.doc, live.current.revision)
  }, [push])

  const reset = useCallback(async () => {
    if (username) await clearCabinet(username)
    setCabinets([defaultCabinet()])
    setOverrides({})
    setRevision(0)
    setDirty(false)
    setStatus('local')
    setError(null)
  }, [username])

  return {
    cabinets,
    cabinet,
    options,
    plan,
    sleeves,
    gatefoldScan,
    status,
    dirty,
    error,
    addSlot,
    updateSlot,
    removeSlot,
    restoreSlot,
    setSort,
    setSeparateSizeClasses,
    toggleGatefold,
    retry,
    reset,
  }
}
