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
/**
 * Ways Discogs entries say "gatefold": English, plus the words pressings from
 * Germany, France, Italy, Spain, the Netherlands and Japan use, and fold-out
 * and tri-fold jackets (also thicker than a single sleeve).
 */
const GATEFOLD_PATTERN =
  /gate[- ]?fold|klapp(?:cover|hülle|huelle)|pochette ouvrante|copertina apribile|doble carpeta|carpeta doble|uitklaphoes|fold[- ]?out (?:sleeve|cover|jacket)|tri[- ]?fold|見開き/giu
/** "not a gatefold", "unlike the original gatefold": the mention denies it. */
const DENIAL_BEFORE = /\b(?:not|no|non|without|unlike|instead of|rather than|lacks?)\b[^.;:\n]{0,30}$/iu
/** "gatefold poster", "gatefold insert": a gatefold item, not the jacket. */
const ITEM_AFTER = /^[\s-]*(?:poster|insert|inner|booklet|print|card|lyric)/iu

/**
 * Whether a piece of Discogs text says the jacket is a gatefold: a gatefold
 * word that isn't denied just before it or followed by a gatefold item.
 */
export function mentionsGatefold(text: string | undefined): boolean {
  if (!text) return false
  for (const match of text.matchAll(GATEFOLD_PATTERN)) {
    const start = match.index ?? 0
    const before = text.slice(Math.max(0, start - 60), start)
    const after = text.slice(start + match[0].length)
    if (!DENIAL_BEFORE.test(before) && !ITEM_AFTER.test(after)) return true
  }
  return false
}

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
 * id. `notes` holds each release's own notes text (fetched once from the full
 * release, which the collection listing leaves out; '' when it has none), so a
 * better gatefold search re-reads them without asking Discogs again.
 * `overrides` is the user's call, and wins over anything detected.
 */
export interface SleeveFacts {
  notes?: Record<string, string>
  overrides?: Record<string, boolean>
}

/** The vinyl formats of a release; CDs and tapes in a set don't make it thicker. */
function vinylFormatsOf(display: DisplayRelease) {
  return (display.release?.basic_information?.formats ?? []).filter((format) =>
    isVinylName(format.name),
  )
}

/** The listing names it: a vinyl format's descriptions or its free text. */
function formatSaysGatefold(display: DisplayRelease): boolean {
  const parts = display.formatText
    .split(' / ')
    .filter((part) => isVinylName(part.split(' · ')[0] ?? ''))
  return (
    parts.some((part) => mentionsGatefold(part)) ||
    vinylFormatsOf(display).some((format) => mentionsGatefold(format.text))
  )
}

/** Gatefold as detected from Discogs data alone, ignoring the user's call. */
export function detectedGatefold(display: DisplayRelease, facts: SleeveFacts = {}): boolean {
  return formatSaysGatefold(display) || mentionsGatefold(facts.notes?.[String(display.id)])
}

export function isGatefold(display: DisplayRelease, facts: SleeveFacts = {}): boolean {
  return facts.overrides?.[String(display.id)] ?? detectedGatefold(display, facts)
}

/** Whether the user's own call disagrees with detection (an agreeing one changes nothing). */
export function isUserCall(display: DisplayRelease, facts: SleeveFacts = {}): boolean {
  const call = facts.overrides?.[String(display.id)]
  return call !== undefined && call !== detectedGatefold(display, facts)
}

/**
 * Discs that take their own space: the vinyl discs of the release's largest
 * size ("2×Vinyl, LP" is two). A bonus 7" or flexi tucked in an LP's sleeve
 * adds nothing. At least one.
 */
export function discCountOf(display: DisplayRelease): number {
  const sized = vinylFormatsOf(display).map((format) => {
    const qty = Number.parseInt(format.qty, 10)
    return {
      inches: statedInches([...(format.descriptions ?? []), format.text ?? ''].join(' ')) ?? 12,
      discs: Number.isFinite(qty) && qty > 0 ? qty : 1,
    }
  })
  const largest = Math.max(0, ...sized.map((format) => format.inches))
  const discs = sized
    .filter((format) => format.inches === largest)
    .reduce((total, format) => total + format.discs, 0)
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
 * vinyl disc whose listing doesn't already say gatefold, that the user hasn't
 * decided themselves, and that hasn't been checked yet.
 */
export function needsNotesCheck(display: DisplayRelease, facts: SleeveFacts = {}): boolean {
  const id = String(display.id)
  return (
    isVinyl(display) &&
    discCountOf(display) < 2 &&
    !formatSaysGatefold(display) &&
    facts.overrides?.[id] === undefined &&
    facts.notes?.[id] === undefined
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
 * How a walk fills each shelf before moving on: to a share of the run in
 * proportion to the shelf's size, to an equal share, or to capacity.
 */
type Fill = 'proportional' | 'equal' | 'capacity'

/**
 * Walks an artist-sorted run of records over a run of shelves in order,
 * filling each shelf as `fill` says before moving on. Artists are kept together: staying with the same
 * artist may overshoot the even share, capacity is the hard limit. With
 * `skipOtherSizes`, a shelf that already holds another size is passed over
 * while a later one has room (the old placement, kept as a last resort: it can
 * place a record the ordered layouts can't, at the cost of the order). Returns
 * the records that found no shelf.
 */
function fillRun(
  records: SortedRecord[],
  slots: Slot[],
  state: Allocation,
  sizeOf: Map<string, SizeClass>,
  unitsOf: Map<string, number>,
  fill: Fill,
  skipOtherSizes = false,
): SortedRecord[] {
  const overflow: SortedRecord[] = []
  if (slots.length === 0) return [...records]
  const { placements, used, classOfSlot } = state
  const runUnits = records.reduce((total, record) => total + (unitsOf.get(record.display.key) ?? 1), 0)
  const runCapacity = slots.reduce((total, slot) => total + slot.capacity, 0)
  const targetOf = (slot: Slot) =>
    fill === 'proportional'
      ? Math.ceil((runUnits * slot.capacity) / Math.max(1, runCapacity))
      : fill === 'equal'
        ? Math.ceil(runUnits / slots.length)
        : Number.POSITIVE_INFINITY
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
      const moveOn =
        (space >= targetOf(slot) && !sameArtist) ||
        (skipOtherSizes && space > 0 && classOfSlot.get(slot.id) !== size)
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

/** How many records sit on an earlier shelf than their place in the order. */
function countOutOfOrder(order: SortedRecord[], placements: Map<string, string>, slots: Slot[]): number {
  const shelfIndex = new Map(slots.map((slot, index) => [slot.id, index]))
  let furthest = -1
  let count = 0
  for (const record of order) {
    const slotId = placements.get(record.display.key)
    if (slotId === undefined) continue
    const index = shelfIndex.get(slotId) ?? 0
    if (index < furthest) count++
    else furthest = index
  }
  return count
}

/**
 * The ways to split the size groups into consecutive runs that each get their
 * own shelves, fewest shared boundaries first: every size apart, then two
 * neighbours sharing, …, then all in one run. Each extra share costs at most
 * one mixed shelf, and the order stays the same.
 */
function groupRuns(groups: SortedRecord[][]): SortedRecord[][][] {
  const partitions: SortedRecord[][][] = []
  const k = groups.length
  // Each of the k−1 gaps between groups is either a cut or a share.
  for (let mask = 0; mask < 1 << Math.max(0, k - 1); mask++) {
    const runs: SortedRecord[][] = [[...groups[0]]]
    for (let gap = 0; gap < k - 1; gap++) {
      if (mask & (1 << gap)) runs[runs.length - 1].push(...groups[gap + 1])
      else runs.push([...groups[gap + 1]])
    }
    partitions.push(runs)
  }
  return partitions.sort((a, b) => b.length - a.length)
}

/**
 * Places every record on a shelf in the main view's order, spreading the
 * collection evenly. With sizes kept apart, each size group gets its own run of
 * shelves (see `shelfShares`) and is spread evenly over that run. When the
 * shelves can't hold every group apart, as few neighbouring groups as possible
 * share a run; inside a run the groups follow each other in order, so only the
 * shelf where one size ends and the next begins is shared, and the reading
 * order never jumps back.
 *
 * Shelf capacity is measured in record spaces, so a gatefold consumes two.
 * Keeping artists together can leave records with no room in their run; a last
 * pass puts them in any space left (preferring a shelf of the same size) before
 * calling them unplaced. Those back-filled records can land on an earlier
 * shelf than their place in the order, which planCabinet reports.
 *
 * In a tight cabinet the even spread can strand records that filling each
 * shelf in turn would have placed, and the other way round, so each candidate
 * layout is tried both ways and the best one wins: fewest records without a
 * shelf, then fewest out of order, then (with sizes kept apart) fewest mixed
 * shelves, then the one listed first (fewest shared sizes; equal spread,
 * then proportional, then shelf by shelf). The old size-skipping walk is listed last, so it only wins when it
 * is strictly better by those same rules.
 */
function allocate(
  groups: SortedRecord[][],
  slots: Slot[],
  sizeOf: Map<string, SizeClass>,
  unitsOf: Map<string, number>,
  separateSizeClasses: boolean,
): { placements: Map<string, string>; unplaced: DisplayRelease[] } {
  const all = groups.flat()
  if (slots.length === 0) return { placements: new Map(), unplaced: all.map((r) => r.display) }

  // A record bigger than every shelf (a big box set) fits nowhere. The ordered
  // layouts leave it out, so it can't make a walk give up on everything after
  // it; it simply counts as unplaced.
  const largest = Math.max(...slots.map((slot) => slot.capacity))
  const fits = (record: SortedRecord) => (unitsOf.get(record.display.key) ?? 1) <= largest
  const oversized = all.filter((record) => !fits(record)).map((record) => record.display)
  const placeable = groups.map((group) => group.filter(fits)).filter((group) => group.length > 0)
  const placeableAll = placeable.flat()

  // Every arrangement of runs and shelves worth trying, preferred first.
  type Run = { records: SortedRecord[]; slots: Slot[] }
  const arrangements: Run[][] = []
  const partitions =
    separateSizeClasses && placeable.length > 1 ? groupRuns(placeable) : [[placeableAll]]
  for (const runs of partitions) {
    if (runs.length === 1) {
      arrangements.push([{ records: runs[0], slots }])
      continue
    }
    const shares = shelfShares(runs, slots, unitsOf)
    if (!shares) continue
    let start = 0
    arrangements.push(
      runs.map((records, index) => {
        const run = { records, slots: slots.slice(start, start + shares[index]) }
        start += shares[index]
        return run
      }),
    )
  }

  // Each arrangement spread equally (as before, so a layout that already
  // worked doesn't move), spread in proportion to the shelves (when a small
  // shelf can't take an equal share), and filled shelf by shelf (when sizes
  // must share and spreading strands a record).
  const fills: Fill[] = ['equal', 'proportional', 'capacity']
  const attempts: { arrangement: Run[]; fill: Fill; skip: boolean; dropped: DisplayRelease[] }[] =
    arrangements.flatMap((arrangement) =>
      fills.map((fill) => ({ arrangement, fill, skip: false, dropped: oversized })),
    )
  // Last, exactly what the planner did before: each size apart when that fits,
  // else the size-skipping walk, over every record. It only wins when it is
  // strictly better, and being here means no record is ever left without a
  // shelf where the old layout found one.
  const legacyShares =
    separateSizeClasses && groups.length > 1 ? shelfShares(groups, slots, unitsOf) : null
  if (legacyShares) {
    let start = 0
    const arrangement = groups.map((records, index) => {
      const run = { records, slots: slots.slice(start, start + legacyShares[index]) }
      start += legacyShares[index]
      return run
    })
    attempts.push({ arrangement, fill: 'equal', skip: false, dropped: [] })
  } else {
    const skip = separateSizeClasses && groups.length > 1
    attempts.push({ arrangement: [{ records: all, slots }], fill: 'equal', skip, dropped: [] })
  }

  // With sizes kept apart, a layout that mixes fewer shelves is better too.
  const mixedShelves = (state: Allocation) => {
    if (!separateSizeClasses) return 0
    const sizes = new Map<string, Set<SizeClass>>()
    for (const [key, slotId] of state.placements) {
      const set = sizes.get(slotId) ?? new Set<SizeClass>()
      set.add(sizeOf.get(key) ?? 'other')
      sizes.set(slotId, set)
    }
    return [...sizes.values()].filter((set) => set.size > 1).length
  }

  type Scored = { state: Allocation; unplaced: DisplayRelease[]; outOfOrder: number; mixed: number }
  const better = (a: Scored, b: Scored) =>
    a.unplaced.length !== b.unplaced.length
      ? a.unplaced.length < b.unplaced.length
      : a.outOfOrder !== b.outOfOrder
        ? a.outOfOrder < b.outOfOrder
        : a.mixed < b.mixed

  let best: Scored | null = null
  for (const { arrangement, fill, skip, dropped } of attempts) {
    const state: Allocation = { placements: new Map(), used: new Map(), classOfSlot: new Map() }
    const overflow = arrangement.flatMap((run) =>
      fillRun(run.records, run.slots, state, sizeOf, unitsOf, fill, skip),
    )
    const unplaced = [
      ...dropped,
      ...backfill(overflow, slots, state, sizeOf, unitsOf, separateSizeClasses),
    ]
    const scored = {
      state,
      unplaced,
      outOfOrder: countOutOfOrder(all, state.placements, slots),
      mixed: mixedShelves(state),
    }
    if (!best || better(scored, best)) best = scored
    // Nothing left to gain: no later candidate can do better than this.
    if (best.unplaced.length === 0 && best.outOfOrder === 0 && best.mixed === 0) break
  }

  return { placements: best!.state.placements, unplaced: best!.unplaced }
}

/**
 * Puts records that found no room in their run into any space left, preferring
 * a shelf that already holds their size when sizes are kept apart; returns the
 * ones that fit nowhere.
 */
function backfill(
  overflow: SortedRecord[],
  slots: Slot[],
  state: Allocation,
  sizeOf: Map<string, SizeClass>,
  unitsOf: Map<string, number>,
  separateSizeClasses: boolean,
): DisplayRelease[] {
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
  return unplaced
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

  const sequence = new Map(groups.flat().map((record, index) => [record.display.key, index]))

  const { placements, unplaced: leftOver } = allocate(
    groups,
    cabinet.slots,
    sizeOf,
    unitsOf,
    options.separateSizeClasses,
  )
  const unplaced = [...leftOver].sort(
    (x, y) => (sequence.get(x.key) ?? 0) - (sequence.get(y.key) ?? 0),
  )

  const slotPlans: PlannedSlot[] = cabinet.slots.map((slot) => {
    const records: DisplayRelease[] = []
    for (const [key, slotId] of placements) {
      if (slotId !== slot.id) continue
      const display = byKey.get(key)
      if (display) records.push(display)
    }
    // In the planned order (size group, then artist, then Year/A–Z), so a
    // shelf shared by two sizes reads as the end of one and the start of the
    // next, not as one list that restarts the alphabet.
    const sortedRecords = records.sort(
      (a, b) => (sequence.get(a.key) ?? 0) - (sequence.get(b.key) ?? 0),
    )
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
  const outOfOrder = countOutOfOrder(groups.flat(), placements, cabinet.slots)
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
