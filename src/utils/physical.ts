// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

/*
 * What a record physically is, read from its Discogs data: its size class,
 * how many discs, whether the sleeve is a gatefold, and so how much shelf
 * space it takes. The shelf planner (cabinet.ts) and the release detail use it.
 */

import type { DisplayRelease } from './collection'

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

/** Where the sleeve call comes from, so a wrong one can be traced and corrected. */
export function sleeveSource(display: DisplayRelease, facts: SleeveFacts = {}): string {
  if (isUserCall(display, facts)) {
    return isGatefold(display, facts)
      ? 'Gatefold, marked by you. Press again to go back to what Discogs says.'
      : 'Standard sleeve, marked by you. Press again to go back to what Discogs says.'
  }
  return detectedGatefold(display, facts)
    ? 'Gatefold, according to Discogs. Press if it is a standard sleeve.'
    : 'Standard sleeve. Press to mark it as a gatefold.'
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
