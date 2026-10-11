// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { DiscogsArtistRef, DiscogsCollectionRelease } from '../types/discogs'
import type { MasterYears } from '../api/discogs'
import { compareSortKeys, makeSortKey, sortLetter } from './sortName'

export interface DisplayRelease {
  key: string
  instanceId: number
  id: number
  title: string
  titleKey: string
  year: number
  originalYear: number
  artistName: string
  genres: string[]
  styles: string[]
  labels: string[]
  country: string
  formatNames: string[]
  formatText: string
  coverImage: string
  thumb: string
  release: DiscogsCollectionRelease
  dateAdded: string
}

export interface GroupedArtist {
  id: string
  name: string
  sortKey: string
  letter: string
  releases: DisplayRelease[]
}

export interface Filters {
  format: string
  genre: string
  style: string
  label: string
  yearMin: number | null
  yearMax: number | null
}

export const DEFAULT_FILTERS: Filters = {
  format: '',
  genre: '',
  style: '',
  label: '',
  yearMin: null,
  yearMax: null,
}

export function activeFilterCount(filters: Filters): number {
  let count = 0
  if (filters.format) count++
  if (filters.genre) count++
  if (filters.style) count++
  if (filters.label) count++
  if (filters.yearMin != null) count++
  if (filters.yearMax != null) count++
  return count
}

export interface FilterOptions extends Filters {
  query: string
}

const UNKNOWN_ARTIST = 'Unknown artist'

export function artistDisplayName(artist: DiscogsArtistRef): string {
  const raw = (artist.name || artist.anv || '').trim()
  const cleaned = raw.replace(/\s*\(\d+\)\s*$/, '')
  return cleaned || UNKNOWN_ARTIST
}

export function creditedArtists(artists: DiscogsArtistRef[]): string {
  let result = ''
  artists.forEach((artist, index) => {
    if (index > 0) {
      const join = artists[index - 1].join?.trim()
      result += join && join.length > 0 ? ` ${join} ` : ', '
    }
    result += artistDisplayName(artist)
  })
  return result || UNKNOWN_ARTIST
}

function primaryArtistName(release: DiscogsCollectionRelease): string {
  const artist = release.basic_information.artists?.[0]
  if (!artist) return UNKNOWN_ARTIST
  return artistDisplayName(artist)
}

// A release can be credited to several artists (splits, collaborations). We
// cross-list those under every credited artist, but keep multi-artist
// compilations under a single "Various" group so they don't flood the list.
function artistGroupNames(release: DiscogsCollectionRelease): string[] {
  const artists = release.basic_information?.artists ?? []
  if (artists.length === 0) return [UNKNOWN_ARTIST]

  const primary = artistDisplayName(artists[0])
  if (primary.toLowerCase() === 'various') return [primary]

  const names: string[] = []
  for (const artist of artists) {
    const name = artistDisplayName(artist)
    if (!names.includes(name)) names.push(name)
  }
  return names.length > 0 ? names : [UNKNOWN_ARTIST]
}

function formatTextOf(release: DiscogsCollectionRelease): string {
  return (release.basic_information.formats ?? [])
    .map((format) => {
      const descriptors = (format.descriptions ?? [])
        .map((part) => part.trim())
        .filter(Boolean)
      return [format.name, ...descriptors].join(' · ')
    })
    .join(' / ')
}

function formatNamesOf(release: DiscogsCollectionRelease): string[] {
  const names = (release.basic_information.formats ?? []).map((format) => format.name)
  return [...new Set(names)]
}

function coverImageOf(release: DiscogsCollectionRelease): string {
  const basic = release.basic_information
  return basic?.cover_image || basic?.thumb || ''
}

function originalYearOf(release: DiscogsCollectionRelease, masterYears: MasterYears): number {
  const masterId = release.basic_information?.master_id
  const masterYear = typeof masterId === 'number' ? masterYears[masterId] : undefined
  if (typeof masterYear === 'number' && masterYear > 0) return masterYear
  return release.basic_information?.year ?? 0
}

export function toDisplayRelease(
  release: DiscogsCollectionRelease,
  masterYears: MasterYears = {},
): DisplayRelease {
  const basic = release.basic_information ?? ({} as DiscogsCollectionRelease['basic_information'])
  const title = basic.title || 'Untitled'
  return {
    key: `${release.id ?? '?'}-${release.instance_id ?? '?'}`,
    instanceId: release.instance_id,
    id: release.id,
    title,
    titleKey: makeSortKey(title),
    year: basic.year,
    originalYear: originalYearOf(release, masterYears),
    artistName: primaryArtistName(release),
    genres: basic.genres ?? [],
    styles: basic.styles ?? [],
    labels: (basic.labels ?? []).map((label) => label.name),
    country: basic.country ?? '',
    formatNames: formatNamesOf(release),
    formatText: formatTextOf(release),
    coverImage: coverImageOf(release),
    thumb: basic.thumb ?? '',
    release,
    dateAdded: release.date_added ?? '',
  }
}

export function filterReleases(
  releases: DiscogsCollectionRelease[],
  options: FilterOptions,
  masterYears: MasterYears = {},
): DiscogsCollectionRelease[] {
  const query = (options.query ?? '').trim().toLowerCase()
  const format = (options.format ?? '').trim().toLowerCase()
  const genre = (options.genre ?? '').trim().toLowerCase()
  const style = (options.style ?? '').trim().toLowerCase()
  const label = (options.label ?? '').trim().toLowerCase()
  const yearMin = options.yearMin ?? 0
  const yearMax = options.yearMax ?? 0

  const hasFilters =
    query || format || genre || style || label || yearMin || yearMax
  if (!hasFilters) return releases

  return releases.filter((release) => {
    const basic = release.basic_information
    if (genre && !(basic.genres ?? []).some((g) => g.toLowerCase() === genre)) return false
    if (style && !(basic.styles ?? []).some((s) => s.toLowerCase() === style)) return false
    if (label && !(basic.labels ?? []).some((l) => l.name?.toLowerCase() === label)) return false
    if (format) {
      const matches = (basic.formats ?? []).some(
        (f) =>
          f.name.toLowerCase() === format ||
          (f.descriptions ?? []).some((d) => d.toLowerCase() === format),
      )
      if (!matches) return false
    }
    const originalYear = originalYearOf(release, masterYears)
    if (yearMin && originalYear < yearMin) return false
    if (yearMax && originalYear > yearMax) return false
    if (query) {
      const haystack = [
        basic.title,
        ...(basic.artists ?? []).map((a) => a.name),
        ...(basic.genres ?? []),
        ...(basic.styles ?? []),
        ...(basic.labels ?? []).map((l) => l.name),
        String(basic.year ?? ''),
        String(originalYearOf(release, masterYears) || ''),
      ]
        .join('  ')
        .toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

export function groupReleases(
  releases: DiscogsCollectionRelease[],
  masterYears: MasterYears = {},
): GroupedArtist[] {
  const byArtist = new Map<string, GroupedArtist>()

  for (const release of releases) {
    const display = toDisplayRelease(release, masterYears)
    for (const name of artistGroupNames(release)) {
      let artist = byArtist.get(name)
      if (!artist) {
        const sortKey = makeSortKey(name)
        artist = {
          id: name,
          name,
          sortKey,
          letter: sortLetter(sortKey),
          releases: [],
        }
        byArtist.set(name, artist)
      }
      artist.releases.push(display)
    }
  }

  const artists = [...byArtist.values()].sort((a, b) =>
    compareSortKeys(a.sortKey, b.sortKey),
  )
  return artists
}

/**
 * How the listing is organized. Deliberately a browsing preference like the
 * per-artist sort: it is not part of a saved view (a view captures the
 * selection only) and it resets with the account, like the open folder.
 */
export type ViewMode = 'artists' | 'albums'

/** One distinct pressing of a group, plus how many copies of it are held. */
export interface PressingRow {
  release: DisplayRelease
  copies: number
}

/** Every pressing of one master (or the copies of one masterless release). */
export interface PressingGroup {
  /** `master-<id>` for a real master, `release-<id>` when Discogs has none. */
  key: string
  /** The card's cover/title: the earliest dated pressing, deterministically. */
  primary: DisplayRelease
  /** Earliest known year across the group (master year when known), 0 if none. */
  year: number
  /** Every instance, oldest pressing first (undated last). */
  pressings: DisplayRelease[]
  /** One entry per distinct release id, so two copies don't list twice. */
  rows: PressingRow[]
}

/**
 * Groups an artist's releases into one card per album.
 *
 * The key mirrors countUniqueAlbums exactly: a real Discogs master (any id
 * above 0) collapses all of its pressings, while masterless releases (0 or a
 * missing id — there is no master to collapse into) each stand alone, keyed by
 * release id so multiple copies of one release still gather together.
 */
export function groupPressings(releases: DisplayRelease[]): PressingGroup[] {
  const byKey = new Map<string, DisplayRelease[]>()

  for (const display of releases) {
    const masterId = display.release?.basic_information?.master_id
    const key =
      typeof masterId === 'number' && masterId > 0
        ? `master-${masterId}`
        : `release-${display.id}`
    const bucket = byKey.get(key)
    if (bucket) bucket.push(display)
    else byKey.set(key, [display])
  }

  const groups: PressingGroup[] = []
  for (const [key, pressings] of byKey) {
    pressings.sort(comparePressings)

    const rows: PressingRow[] = []
    for (const pressing of pressings) {
      const last = rows[rows.length - 1]
      if (last && last.release.id === pressing.id) last.copies++
      else rows.push({ release: pressing, copies: 1 })
    }

    // originalYear is the master year and therefore identical for every
    // pressing of a master; for masterless groups it falls back to the
    // pressing year. Unknown years (0) never win over a known one.
    let year = 0
    for (const pressing of pressings) {
      const candidate = pressing.originalYear || pressing.year
      if (candidate > 0 && (year === 0 || candidate < year)) year = candidate
    }

    groups.push({ key, primary: pressings[0], year, pressings, rows })
  }
  return groups
}

/** Pressings of one album: oldest first, undated last, ties broken stably. */
function comparePressings(a: DisplayRelease, b: DisplayRelease): number {
  const aYear = a.year > 0 ? a.year : Number.MAX_SAFE_INTEGER
  const bYear = b.year > 0 ? b.year : Number.MAX_SAFE_INTEGER
  return (
    aYear - bYear ||
    compareSortKeys(a.titleKey, b.titleKey) ||
    a.id - b.id ||
    a.instanceId - b.instanceId
  )
}

/** Orders album cards within an artist the same way releases are ordered. */
export function sortPressingGroups(
  groups: PressingGroup[],
  mode: ArtistSortMode,
): PressingGroup[] {
  const list = [...groups]
  const yearOf = (group: PressingGroup) => (group.year > 0 ? group.year : Number.MAX_SAFE_INTEGER)
  if (mode === 'chronological') {
    list.sort(
      (a, b) =>
        yearOf(a) - yearOf(b) ||
        compareSortKeys(a.primary.titleKey, b.primary.titleKey) ||
        a.primary.id - b.primary.id,
    )
  } else {
    list.sort(
      (a, b) =>
        compareSortKeys(a.primary.titleKey, b.primary.titleKey) ||
        yearOf(a) - yearOf(b) ||
        a.primary.id - b.primary.id,
    )
  }
  return list
}

export function distinctFormats(releases: DiscogsCollectionRelease[]): string[] {
  const names = new Set<string>()
  for (const release of releases) {
    for (const format of release.basic_information.formats ?? []) {
      names.add(format.name)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function distinctGenres(releases: DiscogsCollectionRelease[]): string[] {
  const names = new Set<string>()
  for (const release of releases) {
    for (const genre of release.basic_information.genres ?? []) {
      names.add(genre)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function distinctStyles(releases: DiscogsCollectionRelease[]): string[] {
  const names = new Set<string>()
  for (const release of releases) {
    for (const style of release.basic_information.styles ?? []) {
      names.add(style)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function distinctLabels(releases: DiscogsCollectionRelease[]): string[] {
  const names = new Set<string>()
  for (const release of releases) {
    for (const label of release.basic_information.labels ?? []) {
      if (label.name) names.add(label.name)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function yearBounds(
  releases: DiscogsCollectionRelease[],
  masterYears: MasterYears = {},
): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const release of releases) {
    const year = originalYearOf(release, masterYears)
    if (year > 0) {
      if (year < min) min = year
      if (year > max) max = year
    }
  }
  return Number.isFinite(min) ? { min, max } : null
}

export function countUniqueAlbums(releases: DiscogsCollectionRelease[]): number {
  const masters = new Set<number>()
  const ids = new Set<number>()
  for (const release of releases) {
    const masterId = release.basic_information?.master_id
    // 0 is Discogs' "no master linked" marker: not a real master, and lumping
    // every masterless release together as one fake album is wrong.
    if (typeof masterId === 'number' && masterId > 0) masters.add(masterId)
    else ids.add(release.id)
  }
  return masters.size + ids.size
}

export interface YearLine {
  label?: string
  value: number
}

export function effectiveYears(display: DisplayRelease): YearLine[] {
  const original = display.originalYear
  const pressing = display.year

  if (original && pressing) {
    if (original === pressing) return [{ value: original }]
    return [
      { label: 'Original', value: original },
      { label: 'Pressing', value: pressing },
    ]
  }
  const lines: YearLine[] = []
  if (original) lines.push({ value: original })
  if (pressing) lines.push({ value: pressing })
  return lines
}

export type ArtistSortMode = 'chronological' | 'byName'

export interface CountItem {
  name: string
  count: number
}

export interface YearBin {
  year: number
  count: number
}

export interface TimelineBin {
  period: string // YYYY-MM
  count: number
  label: string
}

export interface CollectionStats {
  totalReleases: number
  uniqueAlbums: number
  artists: number
  topGenres: CountItem[]
  topStyles: CountItem[]
  topLabels: CountItem[]
  topFormats: CountItem[]
  yearDistribution: YearBin[]
  acquisitionTimeline: TimelineBin[]
}

export function computeCollectionStats(
  releases: DiscogsCollectionRelease[],
  masterYears: MasterYears = {},
): CollectionStats {
  const displayList = releases.map((r) => toDisplayRelease(r, masterYears))
  const uniqueAlbums = countUniqueAlbums(releases)
  const grouped = groupReleases(releases, masterYears)
  const artists = grouped.length
  const totalReleases = releases.length

  const genreMap = new Map<string, number>()
  const styleMap = new Map<string, number>()
  const labelMap = new Map<string, number>()
  const formatMap = new Map<string, number>()
  for (const d of displayList) {
    for (const g of d.genres) {
      if (!g) continue
      genreMap.set(g, (genreMap.get(g) || 0) + 1)
    }
    for (const s of d.styles) {
      if (!s) continue
      styleMap.set(s, (styleMap.get(s) || 0) + 1)
    }
    for (const l of d.labels) {
      if (!l) continue
      labelMap.set(l, (labelMap.get(l) || 0) + 1)
    }
    for (const f of d.formatNames) {
      if (!f) continue
      formatMap.set(f, (formatMap.get(f) || 0) + 1)
    }
  }

  const topGenres = [...genreMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10)
  const topStyles = [...styleMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10)
  const topLabels = [...labelMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10)
  const topFormats = [...formatMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10)

  const yearsMap = new Map<number, number>()
  for (const d of displayList) {
    const y = d.originalYear || d.year
    if (y > 0) {
      yearsMap.set(y, (yearsMap.get(y) || 0) + 1)
    }
  }
  const yearDistribution = [...yearsMap.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year)

  const timelineMap = new Map<string, number>()
  for (const d of displayList) {
    const da = d.dateAdded
    if (!da) continue
    const dt = new Date(da)
    if (isNaN(dt.getTime())) continue
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    timelineMap.set(key, (timelineMap.get(key) || 0) + 1)
  }
  const acquisitionTimeline = [...timelineMap.entries()]
    .map(([period, count]) => {
      const [y, m] = period.split('-')
      const label = new Date(Number(y), Number(m) - 1).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      })
      return { period, count, label }
    })
    .sort((a, b) => a.period.localeCompare(b.period))

  return {
    totalReleases,
    uniqueAlbums,
    artists,
    topGenres,
    topStyles,
    topLabels,
    topFormats,
    yearDistribution,
    acquisitionTimeline,
  }
}