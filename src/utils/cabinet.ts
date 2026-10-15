// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { Cabinet, Slot } from '../shared/cabinetDoc'
import type { DisplayRelease } from './collection'
import { compareSortKeys, makeSortKey } from './sortName'

/** Physical size buckets the planner keeps apart where it can. */
export type SizeClass = '12-inch' | 'small' | 'other'

export const SIZE_CLASSES: readonly SizeClass[] = ['12-inch', 'small', 'other']

export const SIZE_CLASS_LABELS: Record<SizeClass, string> = {
  '12-inch': '12"',
  small: '7" / 10"',
  other: 'Other',
}

const INCH_PATTERN = /(\d+(?:[.,]\d+)?)\s*(?:"|″|”|inch|inches)/gi

function inchesOf(display: DisplayRelease): number | null {
  let max: number | null = null
  for (const text of [display.formatText, ...display.formatNames]) {
    if (!text) continue
    INCH_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = INCH_PATTERN.exec(text)) !== null) {
      const inches = Number.parseFloat(match[1].replace(',', '.'))
      if (Number.isFinite(inches) && inches > 0 && (max === null || inches > max)) {
        max = inches
      }
    }
  }
  return max
}

/**
 * The size bucket a release belongs to. Discogs describes sizes in the format
 * descriptions ("12\"", "7\"", "LP"), so we read the largest explicit inch
 * measurement and fall back to "other" rather than guessing — a CD collection
 * then gets its own shelf instead of being filed with the vinyl.
 */
export function sizeClassOf(display: DisplayRelease): SizeClass {
  const inches = inchesOf(display)
  if (inches === null) return 'other'
  return inches >= 12 ? '12-inch' : 'small'
}

export type CabinetSortMode = 'artist' | 'title' | 'year'

export interface CabinetPlanOptions {
  /** Ordering used to lay records out across and inside slots. */
  sort: CabinetSortMode
  /** Keep each size class in its own slot(s) where the space allows. */
  separateSizeClasses: boolean
}

export const DEFAULT_PLAN_OPTIONS: CabinetPlanOptions = {
  sort: 'artist',
  separateSizeClasses: true,
}

/** A collection record as it appears in a planned slot. */
export interface PlannedRecord {
  key: string
  display: DisplayRelease
  /** True when a manual override, not the rules, put it here. */
  overridden: boolean
}

export interface PlannedSlot {
  slot: Slot
  records: PlannedRecord[]
  /** The single size class in the slot, or 'mixed' when it breaks the rule. */
  sizeClass: SizeClass | 'mixed'
  /** How many records the slot holds beyond its capacity. */
  overCapacity: number
}

export type CabinetConflictType = 'over-capacity' | 'size-mix' | 'artist-split' | 'unplaced'

export interface CabinetConflict {
  type: CabinetConflictType
  slotId?: string
  artist?: string
  count?: number
}

export interface CabinetPlan {
  /** Final record key → slot id, overrides included. */
  placements: Record<string, string>
  slots: PlannedSlot[]
  unplaced: DisplayRelease[]
  conflicts: CabinetConflict[]
  /** Overrides whose record vanished from the collection or whose slot is gone. */
  staleOverrides: string[]
}

export interface CabinetPlanInput {
  releases: DisplayRelease[]
  cabinet: Cabinet
  overrides?: Record<string, string>
  options?: CabinetPlanOptions
}

interface SortedRecord {
  display: DisplayRelease
  artistKey: string
}

function sortKeyed(
  releases: DisplayRelease[],
  sort: CabinetSortMode,
  artistKeys: Map<string, string>,
): SortedRecord[] {
  const keyed: SortedRecord[] = releases.map((display) => ({
    display,
    artistKey: artistKeys.get(display.artistName) ?? makeSortKey(display.artistName),
  }))

  const yearOf = (record: SortedRecord) =>
    record.display.year > 0 ? record.display.year : Number.MAX_SAFE_INTEGER

  keyed.sort((a, b) => {
    const artistOrder = compareSortKeys(a.artistKey, b.artistKey)
    const titleOrder = compareSortKeys(a.display.titleKey, b.display.titleKey)
    const yearOrder = yearOf(a) - yearOf(b)
    const keyOrder = a.display.key.localeCompare(b.display.key)

    if (sort === 'title') return titleOrder || yearOrder || artistOrder || keyOrder
    if (sort === 'year') return yearOrder || artistOrder || titleOrder || keyOrder
    return artistOrder || yearOrder || titleOrder || keyOrder
  })

  return keyed
}

function sortDisplays(
  releases: DisplayRelease[],
  sort: CabinetSortMode,
  artistKeys: Map<string, string>,
): DisplayRelease[] {
  return sortKeyed(releases, sort, artistKeys).map((record) => record.display)
}

function hasRoomAfter(slots: Slot[], load: Map<string, number>, index: number): boolean {
  for (let i = index + 1; i < slots.length; i++) {
    if ((load.get(slots[i].id) ?? 0) < slots[i].capacity) return true
  }
  return false
}

/**
 * Places every record into a slot: class-grouped first, then in the requested
 * order, filling each slot to an even share of the collection before moving on.
 * Artists are kept together by walking the already artist-sorted list.
 */
function allocate(
  sorted: SortedRecord[],
  slots: Slot[],
  sizeOf: Map<string, SizeClass>,
  separateSizeClasses: boolean,
): { placements: Map<string, string>; unplaced: DisplayRelease[] } {
  const placements = new Map<string, string>()
  const unplaced: DisplayRelease[] = []
  if (slots.length === 0) {
    return { placements, unplaced: sorted.map((record) => record.display) }
  }

  const load = new Map<string, number>()
  const classOfSlot = new Map<string, SizeClass>()
  const target = Math.ceil(sorted.length / slots.length)
  let current = 0
  let lastArtist: string | null = null

  for (const record of sorted) {
    const size = sizeOf.get(record.display.key) ?? 'other'
    const sameArtist = lastArtist !== null && record.artistKey === lastArtist
    while (current < slots.length) {
      const slot = slots[current]
      const count = load.get(slot.id) ?? 0
      if (count >= slot.capacity) {
        current++
        continue
      }
      const slotClass = classOfSlot.get(slot.id)
      // Size classes share a shelf only when no clean slot is left, so a tight
      // cabinet reports a mix instead of stranding records as unplaced.
      if (separateSizeClasses && count > 0 && slotClass !== size) {
        if (hasRoomAfter(slots, load, current)) {
          current++
          continue
        }
        break
      }
      // Staying under the same artist is allowed to overshoot the even target
      // (cohesion outranks distribution); capacity is the hard limit.
      if (count >= target && !sameArtist) {
        current++
        continue
      }
      break
    }
    if (current >= slots.length) {
      unplaced.push(record.display)
      continue
    }

    const slot = slots[current]
    placements.set(record.display.key, slot.id)
    load.set(slot.id, (load.get(slot.id) ?? 0) + 1)
    if (!classOfSlot.has(slot.id)) classOfSlot.set(slot.id, size)
    lastArtist = record.artistKey
  }

  return { placements, unplaced }
}

export function planCabinet(input: CabinetPlanInput): CabinetPlan {
  const { releases, cabinet, overrides = {}, options = DEFAULT_PLAN_OPTIONS } = input

  const artistKeys = new Map<string, string>()
  const sizeOf = new Map<string, SizeClass>()
  for (const display of releases) {
    if (!artistKeys.has(display.artistName)) {
      artistKeys.set(display.artistName, makeSortKey(display.artistName))
    }
    sizeOf.set(display.key, sizeClassOf(display))
  }

  const byKey = new Map<string, DisplayRelease>()
  for (const display of releases) byKey.set(display.key, display)

  const ordered = [...releases].sort((a, b) => {
    if (!options.separateSizeClasses) return 0
    return SIZE_CLASSES.indexOf(sizeOf.get(a.key) ?? 'other') -
      SIZE_CLASSES.indexOf(sizeOf.get(b.key) ?? 'other')
  })
  const sorted = sortKeyed(ordered, options.sort, artistKeys)

  const slotIds = new Set(cabinet.slots.map((slot) => slot.id))
  const staleOverrides = Object.keys(overrides).filter(
    (key) => !byKey.has(key) || !slotIds.has(overrides[key]),
  )

  const { placements, unplaced } = allocate(
    sorted,
    cabinet.slots,
    sizeOf,
    options.separateSizeClasses,
  )

  const finalPlacements = new Map(placements)
  const pinned = new Map<string, boolean>()
  for (const [key, slotId] of Object.entries(overrides)) {
    if (!byKey.has(key) || !slotIds.has(slotId)) continue
    finalPlacements.set(key, slotId)
    pinned.set(key, true)
    const unplacedIndex = unplaced.findIndex((display) => display.key === key)
    if (unplacedIndex >= 0) unplaced.splice(unplacedIndex, 1)
  }

  const slotPlans: PlannedSlot[] = cabinet.slots.map((slot) => {
    const records: DisplayRelease[] = []
    for (const [key, slotId] of finalPlacements) {
      if (slotId !== slot.id) continue
      const display = byKey.get(key)
      if (display) records.push(display)
    }
    const sortedRecords = sortDisplays(records, options.sort, artistKeys)
    const classes = new Set(sortedRecords.map((display) => sizeOf.get(display.key) ?? 'other'))
    return {
      slot,
      records: sortedRecords.map((display) => ({
        key: display.key,
        display,
        overridden: pinned.get(display.key) === true,
      })),
      sizeClass: classes.size === 1 ? [...classes][0] : 'mixed',
      overCapacity: Math.max(0, sortedRecords.length - slot.capacity),
    }
  })

  const conflicts: CabinetConflict[] = []
  for (const plan of slotPlans) {
    if (plan.overCapacity > 0) {
      conflicts.push({ type: 'over-capacity', slotId: plan.slot.id, count: plan.overCapacity })
    }
    if (plan.records.length > 1 && plan.sizeClass === 'mixed') {
      conflicts.push({ type: 'size-mix', slotId: plan.slot.id })
    }
  }

  const artistSlots = new Map<string, Set<string>>()
  for (const [key, slotId] of finalPlacements) {
    const display = byKey.get(key)
    if (!display) continue
    const seen = artistSlots.get(display.artistName) ?? new Set<string>()
    seen.add(slotId)
    artistSlots.set(display.artistName, seen)
  }
  for (const [artist, seen] of artistSlots) {
    if (seen.size > 1) conflicts.push({ type: 'artist-split', artist })
  }

  if (unplaced.length > 0) conflicts.push({ type: 'unplaced', count: unplaced.length })

  return {
    placements: Object.fromEntries(finalPlacements),
    slots: slotPlans,
    unplaced,
    conflicts,
    staleOverrides,
  }
}

export function conflictLabel(conflict: CabinetConflict): string {
  switch (conflict.type) {
    case 'over-capacity':
      return `${conflict.count} over capacity`
    case 'size-mix':
      return 'Mixed record sizes'
    case 'artist-split':
      return `${conflict.artist} spans slots`
    case 'unplaced':
      return `${conflict.count} without a slot`
  }
}
