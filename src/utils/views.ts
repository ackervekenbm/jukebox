// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { activeFilterCount, DEFAULT_FILTERS, type Filters } from './collection'

/**
 * A saved view ("smart list") is a named snapshot of the *selection* controls:
 * the search query plus every filter. It deliberately does not capture the
 * folder or the per-artist sort, so a view composes with whatever folder is
 * open and leaves a sort preference the user chose globally untouched.
 */
export interface SavedView {
  id: string
  name: string
  query: string
  filters: Filters
}

/** Keep the list usable (and localStorage small) on a shared device. */
export const MAX_SAVED_VIEWS = 30

/** Normalizes arbitrary (stored, hand-edited) data into a `Filters` shape. */
export function normalizeFilters(value: unknown): Filters {
  const raw = (value ?? {}) as Partial<Record<keyof Filters, unknown>>
  const text = (key: 'format' | 'genre' | 'style' | 'label'): string =>
    typeof raw[key] === 'string' ? (raw[key] as string).trim() : ''
  const year = (key: 'yearMin' | 'yearMax'): number | null => {
    const value = raw[key]
    if (value === null || value === undefined || value === '') return null
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null
  }
  return {
    format: text('format'),
    genre: text('genre'),
    style: text('style'),
    label: text('label'),
    yearMin: year('yearMin'),
    yearMax: year('yearMax'),
  }
}

let idCounter = 0

export function createViewId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  // Fallback for browsers/environments without randomUUID: unique enough for a
  // list of a few dozen local views.
  idCounter += 1
  return `v-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

export function createSavedView(
  name: string,
  query: string,
  filters: Filters = DEFAULT_FILTERS,
  id = createViewId(),
): SavedView {
  return { id, name: name.trim(), query: query.trim(), filters: normalizeFilters(filters) }
}

/** True when the view payload is safe to store/apply (used when loading). */
export function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== 'object' || value === null) return false
  const view = value as Partial<SavedView>
  if (typeof view.id !== 'string' || view.id.trim() === '') return false
  if (typeof view.name !== 'string' || view.name.trim() === '') return false
  return true
}

export function normalizeSavedView(value: unknown): SavedView | null {
  if (!isSavedView(value)) return null
  return {
    id: value.id.trim(),
    name: value.name.trim(),
    query: typeof value.query === 'string' ? value.query.trim() : '',
    filters: normalizeFilters(value.filters),
  }
}

/** Any selection at all? A view with no criteria would just be "everything". */
export function hasCriteria(query: string, filters: Filters): boolean {
  return query.trim() !== '' || activeFilterCount(filters) > 0
}

/** Canonical, comparable form of a selection, so "unchanged" is one comparison. */
function criteriaKey(query: string, filters: Filters): string {
  const normalized = normalizeFilters(filters)
  // A NUL separator: values from Discogs may contain spaces, but never this.
  return [
    query.trim(),
    normalized.format,
    normalized.genre,
    normalized.style,
    normalized.label,
    normalized.yearMin ?? '',
    normalized.yearMax ?? '',
  ].join('\u0001')
}

/** Is the live selection still exactly what the view describes? */
export function sameCriteria(view: SavedView, query: string, filters: Filters): boolean {
  return criteriaKey(view.query, view.filters) === criteriaKey(query, filters)
}

/** Case-insensitive name clash, ignoring the view being renamed. */
export function nameTaken(views: SavedView[], name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return false
  return views.some((view) => view.id !== exceptId && view.name.toLowerCase() === wanted)
}

/** One-line summary of what a view selects, for the view list. */
export function describeCriteria(query: string, filters: Filters): string[] {
  const parts: string[] = []
  const search = query.trim()
  if (search) parts.push(`“${search}”`)

  const field = (label: string, value: string) => {
    if (value) parts.push(`${label}: ${value}`)
  }
  field('Format', filters.format)
  field('Genre', filters.genre)
  field('Style', filters.style)
  field('Label', filters.label)

  const { yearMin, yearMax } = filters
  if (yearMin != null && yearMax != null) parts.push(`${yearMin}–${yearMax}`)
  else if (yearMin != null) parts.push(`from ${yearMin}`)
  else if (yearMax != null) parts.push(`up to ${yearMax}`)

  return parts
}