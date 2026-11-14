// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useCallback, useMemo, useState } from 'react'
import { clearViews, loadViews, saveViews } from '../db/views'
import type { MasterYears } from '../api/discogs'
import type { DiscogsCollectionRelease } from '../types/discogs'
import { DEFAULT_FILTERS, filterReleases, type Filters } from '../utils/collection'
import { createSavedView, hasCriteria, sameCriteria, type SavedView } from '../utils/views'

interface UseSavedViewsArgs {
  /** The live search and filters, which a view saves and is compared against. */
  query: string
  filters: Filters
  /** The releases in the selected folders, for each view's live match count. */
  scope: DiscogsCollectionRelease[]
  masterYears: MasterYears
  /** Puts a search and filters on screen (applying or clearing a view). */
  onSelect: (query: string, filters: Filters) => void
}

/** The saved views: the stored list, which one is in use, and the toolbar's actions on them. */
export function useSavedViews({ query, filters, scope, masterYears, onSelect }: UseSavedViewsArgs) {
  const [views, setViews] = useState<SavedView[]>(loadViews)
  const [activeViewId, setActiveViewId] = useState<string | null>(null)

  // A view is only "in use" while the live selection still matches it exactly;
  // any hand edit to the search box or filters marks it as changed.
  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? null,
    [views, activeViewId],
  )
  const dirty = activeView ? !sameCriteria(activeView, query, filters) : false
  const canSave = hasCriteria(query, filters)

  // Live match counts, so a stale view (a label the collection no longer has)
  // shows 0 instead of silently promising results.
  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const view of views) {
      result[view.id] = filterReleases(scope, { ...view.filters, query: view.query }, masterYears).length
    }
    return result
  }, [views, scope, masterYears])

  const persist = useCallback((next: SavedView[]) => {
    setViews(next)
    saveViews(next)
  }, [])

  const apply = useCallback(
    (view: SavedView) => {
      onSelect(view.query, { ...view.filters })
      setActiveViewId(view.id)
    },
    [onSelect],
  )

  const clear = useCallback(() => {
    onSelect('', DEFAULT_FILTERS)
    setActiveViewId(null)
  }, [onSelect])

  const add = useCallback(
    (name: string) => persist([...views, createSavedView(name, query, filters)]),
    [persist, views, query, filters],
  )

  const rename = useCallback(
    (id: string, name: string) =>
      persist(views.map((view) => (view.id === id ? { ...view, name: name.trim() } : view))),
    [persist, views],
  )

  const remove = useCallback(
    (id: string) => {
      persist(views.filter((view) => view.id !== id))
      setActiveViewId((current) => (current === id ? null : current))
    },
    [persist, views],
  )

  const update = useCallback(
    (view: SavedView) =>
      persist(
        views.map((entry) =>
          entry.id === view.id ? { ...entry, query: query.trim(), filters: { ...filters } } : entry,
        ),
      ),
    [persist, views, query, filters],
  )

  /** The selection changed some other way (folders, a new account): no view is in use. */
  const deselect = useCallback(() => setActiveViewId(null), [])

  /** "Clear everything": saved views are user data too. */
  const wipe = useCallback(() => {
    clearViews()
    setViews([])
    setActiveViewId(null)
  }, [])

  return { views, activeView, dirty, canSave, counts, apply, clear, add, rename, remove, update, deselect, wipe }
}
