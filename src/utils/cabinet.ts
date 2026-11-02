// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { Cabinet, Slot } from '../shared/cabinetDoc'
import { compareReleases, type ArtistSortMode, type DisplayRelease } from './collection'
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
const GATEFOLD_PATTERN = /\bgate[- ]?fold/i

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

/** Discogs format names for records cut on a disc, as opposed to CD, cassette or file. */
const VINYL_FORMATS = new Set(['vinyl', 'lathe cut', 'acetate', 'flexi-disc', 'shellac'])

function isVinyl(display: DisplayRelease): boolean {
  return display.formatNames.some((name) => VINYL_FORMATS.has(name.trim().toLowerCase()))
}

/**
 * The size bucket a release belongs to. Discogs usually leaves the size off an
 * LP ("Vinyl · LP · Album"), so vinyl counts as 12" unless the format states a
 * smaller size ("7\"", "10\""); with several sizes in one release the largest
 * wins. Only releases that aren't vinyl at all (CD, cassette, file) are "other",
 * so they get their own shelf instead of being filed with the records.
 */
export function sizeClassOf(display: DisplayRelease): SizeClass {
  const inches = inchesOf(display)
  if (inches !== null) return inches >= 12 ? '12-inch' : 'small'
  return isVinyl(display) ? '12-inch' : 'other'
}

/**
 * What is known about sleeves beyond the collection listing, keyed by release
 * id. `notes` is what each release's own notes say (fetched once from the full
 * release, which the collection listing leaves out); `overrides` is the
 * user's call, and wins over anything detected.
 */
export interface SleeveFacts {
  notes?: Record<string, boolean>
  overrides?: Record<string, boolean>
}

function formatsOf(display: DisplayRelease) {
  return display.release?.basic_information?.formats ?? []
}

/** Whether release notes describe a gatefold ("Gatefold sleeve.", "gate-fold cover"). */
export function notesSayGatefold(notes: string | undefined): boolean {
  return typeof notes === 'string' && GATEFOLD_PATTERN.test(notes)
}

/** The collection listing names it: a format description or a format's free text. */
function formatSaysGatefold(display: DisplayRelease): boolean {
  if (GATEFOLD_PATTERN.test(display.formatText)) return true
  return formatsOf(display).some((format) => GATEFOLD_PATTERN.test(format.text ?? ''))
}

/** Gatefold as detected from Discogs data alone, ignoring the user's override. */
export function detectedGatefold(display: DisplayRelease, facts: SleeveFacts = {}): boolean {
  return formatSaysGatefold(display) || facts.notes?.[String(display.id)] === true
}

export function isGatefold(display: DisplayRelease, facts: SleeveFacts = {}): boolean {
  return facts.overrides?.[String(display.id)] ?? detectedGatefold(display, facts)
}

/** Vinyl discs in the release ("2×Vinyl" is two), at least one. */
export function discCountOf(display: DisplayRelease): number {
  let discs = 0
  for (const format of formatsOf(display)) {
    if (!VINYL_FORMATS.has(format.name.trim().toLowerCase())) continue
    const qty = Number.parseInt(format.qty, 10)
    discs += Number.isFinite(qty) && qty > 0 ? qty : 1
  }
  return Math.max(1, discs)
}

/**
 * How much shelf space a release takes. A gatefold sleeve is twice as thick as
 * a standard one, and every extra disc adds a space; a release takes whichever
 * is larger, so a gatefold double LP still takes two.
 */
export function spaceUnitsOf(display: DisplayRelease, facts: SleeveFacts = {}): number {
  return Math.max(discCountOf(display), isGatefold(display, facts) ? 2 : 1)
}

/**
 * Whether fetching the release's notes could change its shelf space: a single
 * vinyl disc whose listing doesn't already say gatefold, not checked yet.
 */
export function needsNotesCheck(display: DisplayRelease, facts: SleeveFacts = {}): boolean {
  return (
    isVinyl(display) &&
    discCountOf(display) < 2 &&
    !formatSaysGatefold(display) &&
    facts.notes?.[String(display.id)] === undefined
  )
}

/**
 * The cabinet sorts exactly like the main view: always by artist, and inside an
 * artist by year (`chronological`) or by title (`byName`).
 */
export type CabinetSortMode = ArtistSortMode

export interface CabinetPlanOptions {
  /** Order inside each artist; artists themselves are always in filing order. */
  sort: CabinetSortMode
  /** Keep each size class in its own slot(s) where the space allows. */
  separateSizeClasses: boolean
}

export const DEFAULT_PLAN_OPTIONS: CabinetPlanOptions = {
  sort: 'chronological',
  separateSizeClasses: false,
}

/** A collection record as it appears in a planned slot. */
export interface PlannedRecord {
  key: string
  display: DisplayRelease
  /** Shelf space used: two for a gatefold, one per disc for a multi-disc set. */
  units: number
}

export interface PlannedSlot {
  slot: Slot
  records: PlannedRecord[]
  /** The single size class in the slot, 'mixed' when it breaks the rule, null when empty. */
  sizeClass: SizeClass | 'mixed' | null
  /** Shelf space used by the records, in capacity units. */
  used: number
  /** How many capacity units the slot holds beyond its capacity. */
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
  /** Final record key → slot id. */
  placements: Record<string, string>
  slots: PlannedSlot[]
  unplaced: DisplayRelease[]
  conflicts: CabinetConflict[]
}

export interface CabinetPlanInput {
  releases: DisplayRelease[]
  cabinet: Cabinet
  options?: CabinetPlanOptions
  sleeves?: SleeveFacts
}

interface SortedRecord {
  display: DisplayRelease
  artistKey: string
}

/**
 * Shelf order: the main view's order, unchanged. Artists by their filing name
 * (articles and accents ignored), and inside an artist the main view's Year or
 * A–Z rule, so a shelf reads like the artist's row on screen.
 */
function compareSortedRecords(
  a: SortedRecord,
  b: SortedRecord,
  sort: CabinetSortMode,
): number {
  return (
    compareSortKeys(a.artistKey, b.artistKey) ||
    compareReleases(a.display, b.display, sort) ||
    a.display.key.localeCompare(b.display.key)
  )
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

  keyed.sort((a, b) => compareSortedRecords(a, b, sort))
  return keyed
}

function sortDisplays(
  releases: DisplayRelease[],
  sort: CabinetSortMode,
  artistKeys: Map<string, string>,
): DisplayRelease[] {
  return sortKeyed(releases, sort, artistKeys).map((record) => record.display)
}

function hasRoomAfter(
  slots: Slot[],
  used: Map<string, number>,
  index: number,
  units: number,
): boolean {
  for (let i = index + 1; i < slots.length; i++) {
    if ((used.get(slots[i].id) ?? 0) + units <= slots[i].capacity) return true
  }
  return false
}

/**
 * Places every record into a slot: class-grouped first, then in the requested
 * order, filling each slot to an even share of the collection before moving on.
 * Artists are kept together by walking the already artist-sorted list.
 *
 * Shelf capacity is measured in record spaces, so a gatefold consumes two. The
 * even-target pass can leave unused space in earlier slots (a size class that
 * ends early, or a target reached before the next class starts). A second pass
 * reuses that space before anything is called unplaced, so records are only
 * stranded when the cabinet is genuinely full.
 */
function allocate(
  sorted: SortedRecord[],
  slots: Slot[],
  sizeOf: Map<string, SizeClass>,
  unitsOf: Map<string, number>,
  separateSizeClasses: boolean,
): { placements: Map<string, string>; unplaced: DisplayRelease[] } {
  const placements = new Map<string, string>()
  const unplaced: DisplayRelease[] = []
  if (slots.length === 0) {
    return { placements, unplaced: sorted.map((record) => record.display) }
  }

  const used = new Map<string, number>()
  const classOfSlot = new Map<string, SizeClass>()
  const totalUnits = sorted.reduce(
    (total, record) => total + (unitsOf.get(record.display.key) ?? 1),
    0,
  )
  const target = Math.ceil(totalUnits / slots.length)
  const overflow: SortedRecord[] = []
  let current = 0
  let lastArtist: string | null = null

  const place = (slot: Slot, record: SortedRecord, size: SizeClass, units: number) => {
    placements.set(record.display.key, slot.id)
    used.set(slot.id, (used.get(slot.id) ?? 0) + units)
    if (!classOfSlot.has(slot.id)) classOfSlot.set(slot.id, size)
  }

  for (const record of sorted) {
    const size = sizeOf.get(record.display.key) ?? 'other'
    const units = unitsOf.get(record.display.key) ?? 1
    const sameArtist = lastArtist !== null && record.artistKey === lastArtist
    while (current < slots.length) {
      const slot = slots[current]
      const space = used.get(slot.id) ?? 0
      if (space + units > slot.capacity) {
        current++
        continue
      }
      const slotClass = classOfSlot.get(slot.id)
      // Size classes share a shelf only when no clean slot is left, so a tight
      // cabinet reports a mix instead of stranding records as unplaced.
      if (separateSizeClasses && space > 0 && slotClass !== size) {
        if (hasRoomAfter(slots, used, current, units)) {
          current++
          continue
        }
        break
      }
      // Staying under the same artist is allowed to overshoot the even target
      // (cohesion outranks distribution); capacity is the hard limit.
      if (space >= target && !sameArtist) {
        if (hasRoomAfter(slots, used, current, units)) {
          current++
          continue
        }
        break
      }
      break
    }
    if (current >= slots.length) {
      overflow.push(record)
      continue
    }

    place(slots[current], record, size, units)
    lastArtist = record.artistKey
  }

  // The first pass walks forward only, so a class change or even target can
  // leave room on an earlier shelf. Fill that room, preferring shelves that
  // already hold the same size class, before reporting records as unplaced.
  for (const record of overflow) {
    const size = sizeOf.get(record.display.key) ?? 'other'
    const units = unitsOf.get(record.display.key) ?? 1
    const hasRoom = (slot: Slot) => (used.get(slot.id) ?? 0) + units <= slot.capacity
    const clean = separateSizeClasses
      ? slots.find((slot) => hasRoom(slot) && classOfSlot.get(slot.id) === size)
      : undefined
    const slot = clean ?? slots.find(hasRoom)
    if (!slot) {
      unplaced.push(record.display)
      continue
    }
    place(slot, record, size, units)
  }

  return { placements, unplaced }
}

export function planCabinet(input: CabinetPlanInput): CabinetPlan {
  const { releases, cabinet, options = DEFAULT_PLAN_OPTIONS, sleeves } = input

  const artistKeys = new Map<string, string>()
  const sizeOf = new Map<string, SizeClass>()
  const unitsOf = new Map<string, number>()
  for (const display of releases) {
    if (!artistKeys.has(display.artistName)) {
      artistKeys.set(display.artistName, makeSortKey(display.artistName))
    }
    sizeOf.set(display.key, sizeClassOf(display))
    unitsOf.set(display.key, spaceUnitsOf(display, sleeves))
  }

  const byKey = new Map<string, DisplayRelease>()
  for (const display of releases) byKey.set(display.key, display)

  const sorted = options.separateSizeClasses
    ? SIZE_CLASSES.map((sizeClass, index) => ({
        index,
        records: sortKeyed(
          releases.filter((display) => (sizeOf.get(display.key) ?? 'other') === sizeClass),
          options.sort,
          artistKeys,
        ),
      }))
        .filter((group) => group.records.length > 0)
        .sort(
          (a, b) =>
            compareSortedRecords(a.records[0], b.records[0], options.sort) || a.index - b.index,
        )
        .flatMap((group) => group.records)
    : sortKeyed(releases, options.sort, artistKeys)

  const { placements, unplaced } = allocate(
    sorted,
    cabinet.slots,
    sizeOf,
    unitsOf,
    options.separateSizeClasses,
  )

  const slotPlans: PlannedSlot[] = cabinet.slots.map((slot) => {
    const records: DisplayRelease[] = []
    for (const [key, slotId] of placements) {
      if (slotId !== slot.id) continue
      const display = byKey.get(key)
      if (display) records.push(display)
    }
    const sortedRecords = sortDisplays(records, options.sort, artistKeys)
    const classes = new Set(sortedRecords.map((display) => sizeOf.get(display.key) ?? 'other'))
    const plannedRecords = sortedRecords.map((display) => ({
      key: display.key,
      display,
      units: unitsOf.get(display.key) ?? 1,
    }))
    const used = plannedRecords.reduce((total, record) => total + record.units, 0)
    return {
      slot,
      records: plannedRecords,
      // An empty shelf has no size, rather than a "mixed" one.
      sizeClass: classes.size === 0 ? null : classes.size === 1 ? [...classes][0] : 'mixed',
      used,
      overCapacity: Math.max(0, used - slot.capacity),
    }
  })

  const conflicts: CabinetConflict[] = []
  for (const plan of slotPlans) {
    if (plan.overCapacity > 0) {
      conflicts.push({ type: 'over-capacity', slotId: plan.slot.id, count: plan.overCapacity })
    }
  }

  // Mixed sizes only break the rule when the sizes are meant to be kept apart;
  // with that option off, mixing is the expected layout. One warning for the
  // whole cabinet, with how many shelves it affects.
  if (options.separateSizeClasses) {
    const mixed = slotPlans.filter((plan) => plan.records.length > 1 && plan.sizeClass === 'mixed')
    if (mixed.length > 0) conflicts.push({ type: 'size-mix', count: mixed.length })
  }

  // With sizes kept apart, an artist's 12" and 7"/10" records are separate runs
  // by design; only a run that itself crosses shelves is a split.
  const runSlots = new Map<string, { artist: string; slots: Set<string> }>()
  for (const [key, slotId] of placements) {
    const display = byKey.get(key)
    if (!display) continue
    const run = options.separateSizeClasses
      ? `${display.artistName}\u0000${sizeOf.get(key) ?? 'other'}`
      : display.artistName
    const entry = runSlots.get(run) ?? { artist: display.artistName, slots: new Set<string>() }
    entry.slots.add(slotId)
    runSlots.set(run, entry)
  }
  const splitArtists = new Set<string>()
  for (const { artist, slots } of runSlots.values()) {
    if (slots.size > 1) splitArtists.add(artist)
  }
  for (const artist of splitArtists) conflicts.push({ type: 'artist-split', artist })

  if (unplaced.length > 0) conflicts.push({ type: 'unplaced', count: unplaced.length })

  return {
    placements: Object.fromEntries(placements),
    slots: slotPlans,
    unplaced,
    conflicts,
  }
}

export function conflictLabel(conflict: CabinetConflict): string {
  switch (conflict.type) {
    case 'over-capacity':
      return `${conflict.count} over capacity`
    case 'size-mix':
      return `Mixed record sizes on ${conflict.count} ${conflict.count === 1 ? 'shelf' : 'shelves'}`
    case 'artist-split':
      return `${conflict.artist} spans slots`
    case 'unplaced':
      return `${conflict.count} without a slot`
  }
}
