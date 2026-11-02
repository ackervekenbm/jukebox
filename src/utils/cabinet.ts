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

/** The largest size a piece of format text states, in inches. */
function statedInches(text: string): number | null {
  let max: number | null = null
  INCH_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INCH_PATTERN.exec(text)) !== null) {
    const inches = Number.parseFloat(match[1].replace(',', '.'))
    if (Number.isFinite(inches) && inches > 0 && (max === null || inches > max)) max = inches
  }
  return max
}

/** Discogs format names for records cut on a disc, as opposed to CD, cassette or file. */
const VINYL_FORMATS = new Set(['vinyl', 'lathe cut', 'acetate', 'flexi-disc', 'shellac'])

const isVinylName = (name: string) => VINYL_FORMATS.has(name.trim().toLowerCase())

function isVinyl(display: DisplayRelease): boolean {
  return display.formatNames.some(isVinylName)
}

/**
 * The size bucket a release belongs to, judged per format in the release
 * ("Vinyl · LP / Vinyl · 7\"" is two formats). Only vinyl formats count:
 * a 3" CD or a 7" reel-to-reel tape is not a single. Discogs usually leaves the
 * size off an LP ("Vinyl · LP · Album"), so a vinyl format counts as 12" unless
 * it states a smaller size ("7\"", "10\""), and the largest vinyl format wins,
 * so an LP with a bonus 7" is still a 12". Releases without any vinyl (CD,
 * cassette, file) are "other" and get their own shelf.
 */
export function sizeClassOf(display: DisplayRelease): SizeClass {
  let largest: number | null = null
  for (const part of display.formatText.split(' / ')) {
    const name = part.split(' · ')[0] ?? ''
    if (!isVinylName(name)) continue
    const inches = statedInches(part) ?? 12
    if (largest === null || inches > largest) largest = inches
  }
  // Format text can be missing; fall back to the format names alone.
  if (largest === null) return isVinyl(display) ? '12-inch' : 'other'
  return largest >= 12 ? '12-inch' : 'small'
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

export type CabinetConflictType =
  | 'over-capacity'
  | 'size-mix'
  | 'artist-split'
  | 'out-of-order'
  | 'unplaced'

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

interface Allocation {
  placements: Map<string, string>
  used: Map<string, number>
  classOfSlot: Map<string, SizeClass>
}

/**
 * Walks an artist-sorted run of records over a run of shelves, filling each to
 * an even share of the run before moving on. Artists are kept together: staying
 * with the same artist may overshoot the even share, capacity is the hard
 * limit. With `keepSizesApart`, a shelf that already holds one size only takes
 * another when no later shelf has room (a tight cabinet reports a mix rather
 * than stranding records). Returns the records that found no shelf.
 */
function fillRun(
  records: SortedRecord[],
  slots: Slot[],
  state: Allocation,
  sizeOf: Map<string, SizeClass>,
  unitsOf: Map<string, number>,
  keepSizesApart: boolean,
): SortedRecord[] {
  const overflow: SortedRecord[] = []
  if (slots.length === 0) return [...records]
  const { placements, used, classOfSlot } = state
  const runUnits = records.reduce((total, record) => total + (unitsOf.get(record.display.key) ?? 1), 0)
  const target = Math.ceil(runUnits / slots.length)
  let current = 0
  let lastArtist: string | null = null

  for (const record of records) {
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
      const moveOn =
        (keepSizesApart && space > 0 && slotClass !== size) || (space >= target && !sameArtist)
      if (moveOn && hasRoomAfter(slots, used, current, units)) {
        current++
        continue
      }
      break
    }
    if (current >= slots.length) {
      overflow.push(record)
      continue
    }
    const slot = slots[current]
    placements.set(record.display.key, slot.id)
    used.set(slot.id, (used.get(slot.id) ?? 0) + units)
    if (!classOfSlot.has(slot.id)) classOfSlot.set(slot.id, size)
    lastArtist = record.artistKey
  }
  return overflow
}

const unitsIn = (records: SortedRecord[], unitsOf: Map<string, number>) =>
  records.reduce((total, record) => total + (unitsOf.get(record.display.key) ?? 1), 0)

/**
 * How many consecutive shelves each size group gets when sizes are kept apart,
 * or null when the shelves can't hold the groups apart at all. Every group gets
 * at least the shelves it needs to fit; spare shelves go to the groups with the
 * most records per shelf, so each group is spread about as evenly as the whole
 * cabinet would be.
 */
function shelfShares(groups: SortedRecord[][], slots: Slot[], unitsOf: Map<string, number>): number[] | null {
  const units = groups.map((group) => unitsIn(group, unitsOf))
  const fits = (counts: number[]) => {
    let start = 0
    return counts.every((count, index) => {
      const capacity = slots.slice(start, start + count).reduce((total, slot) => total + slot.capacity, 0)
      start += count
      return capacity >= units[index]
    })
  }

  // The fewest shelves each group needs, taken in shelf order.
  const minimum: number[] = []
  let next = 0
  for (const need of units) {
    let capacity = 0
    let count = 0
    while (capacity < need && next < slots.length) {
      capacity += slots[next++].capacity
      count++
    }
    if (capacity < need) return null
    minimum.push(Math.max(1, count))
  }
  const spare = slots.length - minimum.reduce((total, count) => total + count, 0)
  if (spare < 0) return null

  const shares = [...minimum]
  for (let i = 0; i < spare; i++) {
    let best = 0
    for (let g = 1; g < shares.length; g++) {
      if (units[g] / (shares[g] + 1) > units[best] / (shares[best] + 1)) best = g
    }
    shares[best]++
  }
  // Uneven shelf sizes can make the spread-out shares too tight; the minimum
  // shares (with the spare shelves at the end) always fit.
  if (fits(shares)) return shares
  const padded = [...minimum]
  padded[padded.length - 1] += spare
  return fits(padded) ? padded : null
}

/**
 * Places every record on a shelf in the main view's order, spreading the
 * collection evenly. With sizes kept apart, each size group gets its own run of
 * shelves (see `shelfShares`) and is spread evenly over that run; only when
 * the shelves can't hold the groups apart does one walk over all shelves mix
 * them where it must.
 *
 * Shelf capacity is measured in record spaces, so a gatefold consumes two.
 * Keeping artists together can leave records with no room in their run; a last
 * pass puts them in any space left (preferring a shelf of the same size) before
 * calling them unplaced. Those back-filled records can land on an earlier
 * shelf than their place in the order, which planCabinet reports.
 */
function allocate(
  groups: SortedRecord[][],
  slots: Slot[],
  sizeOf: Map<string, SizeClass>,
  unitsOf: Map<string, number>,
  separateSizeClasses: boolean,
): { placements: Map<string, string>; unplaced: DisplayRelease[] } {
  const state: Allocation = { placements: new Map(), used: new Map(), classOfSlot: new Map() }
  const all = groups.flat()
  if (slots.length === 0) return { placements: state.placements, unplaced: all.map((r) => r.display) }

  let overflow: SortedRecord[] = []
  const shares = separateSizeClasses && groups.length > 1 ? shelfShares(groups, slots, unitsOf) : null
  if (shares) {
    let start = 0
    groups.forEach((group, index) => {
      const run = slots.slice(start, start + shares[index])
      start += shares[index]
      overflow.push(...fillRun(group, run, state, sizeOf, unitsOf, false))
    })
  } else {
    overflow = fillRun(all, slots, state, sizeOf, unitsOf, separateSizeClasses)
  }

  const unplaced: DisplayRelease[] = []
  for (const record of overflow) {
    const size = sizeOf.get(record.display.key) ?? 'other'
    const units = unitsOf.get(record.display.key) ?? 1
    const hasRoom = (slot: Slot) => (state.used.get(slot.id) ?? 0) + units <= slot.capacity
    const clean = separateSizeClasses
      ? slots.find((slot) => hasRoom(slot) && state.classOfSlot.get(slot.id) === size)
      : undefined
    const slot = clean ?? slots.find(hasRoom)
    if (!slot) {
      unplaced.push(record.display)
      continue
    }
    state.placements.set(record.display.key, slot.id)
    state.used.set(slot.id, (state.used.get(slot.id) ?? 0) + units)
    if (!state.classOfSlot.has(slot.id)) state.classOfSlot.set(slot.id, size)
  }

  return { placements: state.placements, unplaced }
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

  // With sizes kept apart, each size is its own run, in the order of each run's
  // first record, so the cabinet still starts with the earliest artist.
  const groups = options.separateSizeClasses
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
        .map((group) => group.records)
    : [sortKeyed(releases, options.sort, artistKeys)]

  const { placements, unplaced } = allocate(
    groups,
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
    const mixed = slotPlans.filter((plan) => plan.sizeClass === 'mixed')
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

  // A record back-filled onto an earlier shelf than its place in the order
  // breaks the reading order; say how many, so the layout isn't trusted blindly.
  const shelfIndex = new Map(cabinet.slots.map((slot, index) => [slot.id, index]))
  let furthest = -1
  let outOfOrder = 0
  for (const record of groups.flat()) {
    const slotId = placements.get(record.display.key)
    if (slotId === undefined) continue
    const index = shelfIndex.get(slotId) ?? 0
    if (index < furthest) outOfOrder++
    else furthest = index
  }
  if (outOfOrder > 0) conflicts.push({ type: 'out-of-order', count: outOfOrder })

  if (unplaced.length > 0) conflicts.push({ type: 'unplaced', count: unplaced.length })

  return {
    placements: Object.fromEntries(placements),
    slots: slotPlans,
    unplaced,
    conflicts,
  }
}

/** "1 shelf", "3 shelves". */
export function plural(count = 0, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}

export function conflictLabel(conflict: CabinetConflict): string {
  switch (conflict.type) {
    case 'over-capacity':
      return `${plural(conflict.count, 'space')} over capacity`
    case 'size-mix':
      return `Mixed sizes on ${plural(conflict.count, 'shelf', 'shelves')}`
    case 'artist-split':
      return `${conflict.artist} split across shelves`
    case 'out-of-order':
      return `${plural(conflict.count, 'record')} out of order`
    case 'unplaced':
      return `${plural(conflict.count, 'record')} without a shelf`
  }
}
