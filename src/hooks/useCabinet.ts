// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cabinet, CabinetDoc, Slot } from '../shared/cabinetDoc'
import type { DisplayRelease } from '../utils/collection'
import { planCabinet, type CabinetPlan, type CabinetSortMode } from '../utils/cabinet'
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
  return { id: 'main', name: 'Cabinet', slots: [defaultCabinetSlot(1), defaultCabinetSlot(2)] }
}

/** The synced document for a computed layout, stamped with the current time. */
export function buildCabinetDoc(
  cabinets: Cabinet[],
  overrides: Record<string, string>,
  plan: CabinetPlan,
): CabinetDoc {
  return {
    schemaVersion: 1,
    cabinets,
    placements: plan.placements,
    overrides,
    unplaced: plan.unplaced.map((record: DisplayRelease) => record.key),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Merges the server's copy into the local one after a 409: the local cabinets
 * and overrides win (this is the device the user is editing on) and the
 * placements are recomputed from the collection anyway.
 */
export function rebaseCabinetDoc(local: CabinetDoc, server: CabinetDoc): CabinetDoc {
  return {
    ...local,
    cabinets: local.cabinets,
    overrides: { ...server.overrides, ...local.overrides },
    updatedAt: new Date().toISOString(),
  }
}

export interface UseCabinetArgs {
  username: string
  token: string | null
  releases: DisplayRelease[]
  /** The cabinet only loads and syncs while its screen is on. */
  enabled: boolean
}

export interface UseCabinetResult {
  cabinets: Cabinet[]
  cabinet: Cabinet
  overrides: Record<string, string>
  options: CabinetOptions
  plan: CabinetPlan
  status: CabinetStatus
  dirty: boolean
  error: string | null
  setName: (name: string) => void
  addSlot: () => void
  updateSlot: (slotId: string, patch: Partial<Slot>) => void
  removeSlot: (slotId: string) => void
  assign: (recordKey: string, slotId: string) => void
  unassign: (recordKey: string) => void
  setSort: (sort: CabinetSortMode) => void
  setSeparateSizeClasses: (separate: boolean) => void
  retry: () => void
  reset: () => Promise<void>
}

export function useCabinet({ username, token, releases, enabled }: UseCabinetArgs): UseCabinetResult {
  const [cabinets, setCabinets] = useState<Cabinet[]>(() => [defaultCabinet()])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [options, setOptions] = useState<CabinetOptions>(() => loadCabinetOptions())
  const [revision, setRevision] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<CabinetStatus>('local')
  const [error, setError] = useState<string | null>(null)

  const cabinet = cabinets[0]
  const plan = useMemo(
    () => planCabinet({ releases, cabinet, overrides, options }),
    [releases, cabinet, overrides, options],
  )
  const doc = useMemo(() => buildCabinetDoc(cabinets, overrides, plan), [cabinets, overrides, plan])

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

  /**
   * Pushes a document, rebasing and retrying while the server reports a newer
   * revision. Gives up after a few rounds so a rebase loop cannot spin.
   */
  const push = useCallback(
    async (startDoc: CabinetDoc, startRevision: number): Promise<void> => {
      const authToken = live.current.token
      if (!authToken) {
        setStatus('local')
        return
      }
      setStatus('syncing')
      let nextDoc = startDoc
      let nextRevision = startRevision

      for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
        try {
          const result = await pushCabinet(authToken, nextDoc, revisionEtag(nextRevision))
          const savedRevision = revisionFromEtag(result.etag, nextRevision + 1)
          setRevision(savedRevision)
          setDirty(false)
          setError(null)
          setStatus('synced')
          persist(nextDoc, savedRevision, false)
          return
        } catch (err) {
          if (err instanceof SyncConflictError) {
            nextDoc = rebaseCabinetDoc(nextDoc, err.doc ?? nextDoc)
            nextRevision = revisionFromEtag(err.etag, nextRevision)
            setCabinets(nextDoc.cabinets)
            setOverrides(nextDoc.overrides)
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

  useEffect(() => {
    if (!enabled || !username) return
    let cancelled = false

    void (async () => {
      const stored = await getCabinet(username)
      if (cancelled) return
      if (stored) {
        setCabinets(stored.doc.cabinets.length > 0 ? stored.doc.cabinets : [defaultCabinet()])
        setOverrides(stored.doc.overrides)
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
          const rebased = rebaseCabinetDoc(stored.doc, remote.doc)
          setCabinets(rebased.cabinets)
          setOverrides(rebased.overrides)
          setRevision(remoteRevision)
          await push(rebased, remoteRevision)
          return
        }
        setCabinets(remote.doc.cabinets.length > 0 ? remote.doc.cabinets : [defaultCabinet()])
        setOverrides(remote.doc.overrides)
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

  const setName = useCallback((name: string) => {
    setCabinets((current) =>
      current.map((entry, index) => (index === 0 ? { ...entry, name } : entry)),
    )
    setDirty(true)
  }, [])

  const addSlot = useCallback(() => {
    setCabinets((current) => {
      const first = current[0]
      return [
        { ...first, slots: [...first.slots, defaultCabinetSlot(first.slots.length + 1)] },
        ...current.slice(1),
      ]
    })
    setDirty(true)
  }, [])

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
    setDirty(true)
  }, [])

  const removeSlot = useCallback((slotId: string) => {
    setCabinets((current) => {
      const first = current[0]
      if (first.slots.length <= 1) return current
      return [
        { ...first, slots: first.slots.filter((slot) => slot.id !== slotId) },
        ...current.slice(1),
      ]
    })
    setDirty(true)
  }, [])

  const assign = useCallback((recordKey: string, slotId: string) => {
    setOverrides((current) => ({ ...current, [recordKey]: slotId }))
    setDirty(true)
  }, [])

  const unassign = useCallback((recordKey: string) => {
    setOverrides((current) => {
      if (!(recordKey in current)) return current
      const next = { ...current }
      delete next[recordKey]
      return next
    })
    setDirty(true)
  }, [])

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
    overrides,
    options,
    plan,
    status,
    dirty,
    error,
    setName,
    addSlot,
    updateSlot,
    removeSlot,
    assign,
    unassign,
    setSort,
    setSeparateSizeClasses,
    retry,
    reset,
  }
}
