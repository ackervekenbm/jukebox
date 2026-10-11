// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import {
  activeFilterCount,
  artistDisplayName,
  computeCollectionStats,
  countUniqueAlbums,
  creditedArtists,
  distinctFormats,
  distinctGenres,
  distinctLabels,
  distinctStyles,
  effectiveYears,
  filterReleases,
  groupPressings,
  groupReleases,
  sortPressingGroups,
  toDisplayRelease,
  yearBounds,
  DEFAULT_FILTERS,
  type FilterOptions,
} from './collection'
import { artist, release } from '../test/factories'
import type { DiscogsCollectionRelease } from '../types/discogs'

const basic = release().basic_information

describe('artistDisplayName', () => {
  it('prefers the name, trimming trailing disambiguation numbers', () => {
    expect(artistDisplayName(artist({ name: 'The Cure (2)' }))).toBe('The Cure')
  })

  it('falls back to the anv', () => {
    expect(artistDisplayName(artist({ name: '', anv: 'Smashing Pumpkins' }))).toBe(
      'Smashing Pumpkins',
    )
  })

  it('labels empty artists as unknown', () => {
    expect(artistDisplayName(artist({ name: '', anv: '' }))).toBe('Unknown artist')
    expect(artistDisplayName(artist({ name: '   ' }))).toBe('Unknown artist')
  })
})

describe('creditedArtists', () => {
  it('joins artists with their join tokens', () => {
    const result = creditedArtists([
      artist({ name: 'A' }),
      artist({ name: 'B', join: '&' }),
      artist({ name: 'C', join: ' & ' }),
    ])
    expect(result).toBe('A, B & C')
  })

  it('defaults the separator to a comma', () => {
    expect(creditedArtists([artist({ name: 'A' }), artist({ name: 'B' })])).toBe('A, B')
  })

  it('returns Unknown artist for no artists', () => {
    expect(creditedArtists([])).toBe('Unknown artist')
  })
})

describe('toDisplayRelease', () => {
  it('uses the master year when available for the original year', () => {
    const display = toDisplayRelease(release(), { 900: 1975 })
    expect(display.originalYear).toBe(1975)
    expect(display.year).toBe(basic.year)
  })

  it('falls back to the basic-information year without a master year', () => {
    const display = toDisplayRelease(release({ basic_information: { ...basic, master_id: null } }))
    expect(display.originalYear).toBe(basic.year)
  })

  it('defaults missing titles and artists', () => {
    const display = toDisplayRelease(
      release({
        id: 5,
        instance_id: 6,
        basic_information: { ...basic, title: '', artists: [] },
      }),
    )
    expect(display.title).toBe('Untitled')
    expect(display.artistName).toBe('Unknown artist')
  })

  it('builds a deterministic key from id and instance id', () => {
    const a = toDisplayRelease(release({ id: 10, instance_id: 20 }))
    const b = toDisplayRelease(release({ id: 10, instance_id: 20 }))
    expect(a.key).toBe('10-20')
    expect(a.key).toBe(b.key)
  })

  it('joins format names into a display string', () => {
    const display = toDisplayRelease(
      release({
        basic_information: {
          ...basic,
          formats: [
            { name: 'LP', qty: '2', descriptions: ['Album', 'Reissue'] },
            { name: 'CD', qty: '1', descriptions: [] },
          ],
        },
      }),
    )
    expect(display.formatNames).toEqual(['LP', 'CD'])
    expect(display.formatText).toBe('LP · Album · Reissue / CD')
  })
})

describe('filterReleases', () => {
  // Every field is set explicitly so expectations don't depend on factory
  // defaults: titles Blue/Green/Blue Train/The Wall; genres Rock/Jazz/Pop;
  // styles Prog/Cool; labels Vertigo/Blue Note/Harvest; formats LP/CD.
  const releases = [
    release({
      id: 1,
      instance_id: 11,
      basic_information: { ...basic, title: 'Blue', genres: ['Rock'], styles: ['Prog'], labels: [{ id: 1, name: 'Vertigo', catno: '', resource_url: '' }], year: 1999, formats: [{ name: 'LP', qty: '1' }] },
    }),
    release({
      id: 2,
      instance_id: 12,
      basic_information: { ...basic, title: 'Green', genres: ['Jazz'], styles: ['Cool'], labels: [{ id: 2, name: 'Blue Note', catno: '', resource_url: '' }], year: 2001, formats: [{ name: 'CD', qty: '1' }] },
    }),
    release({
      id: 3,
      instance_id: 13,
      basic_information: { ...basic, title: 'Blue Train', genres: ['Pop', 'Jazz'], styles: ['Cool'], labels: [{ id: 2, name: 'Blue Note', catno: '', resource_url: '' }], year: 1957, formats: [{ name: 'LP', qty: '1' }, { name: 'CD', qty: '1' }] },
    }),
    release({
      id: 4,
      instance_id: 14,
      basic_information: { ...basic, title: 'The Wall', genres: ['Rock'], styles: ['Prog'], labels: [{ id: 3, name: 'Harvest', catno: '', resource_url: '' }], year: 1979, formats: [{ name: 'LP', qty: '1' }] },
    }),
  ]

  const ids = (opts: FilterOptions): number[] =>
    filterReleases(releases, opts).map((r) => r.id)

  it('returns the input unchanged when no options are set', () => {
    expect(filterReleases(releases, { ...DEFAULT_FILTERS, query: '' })).toBe(releases)
  })

  it('filters by a case-insensitive genre match', () => {
    expect(ids({ ...DEFAULT_FILTERS, query: '', genre: 'jAzZ' })).toEqual([2, 3])
  })

  it('filters by style', () => {
    expect(ids({ ...DEFAULT_FILTERS, query: '', style: 'cool' })).toEqual([2, 3])
  })

  it('filters by label', () => {
    expect(ids({ ...DEFAULT_FILTERS, query: '', label: 'blue note' })).toEqual([2, 3])
  })

  it('filters by format name or description', () => {
    expect(ids({ ...DEFAULT_FILTERS, query: '', format: 'LP' })).toEqual([1, 3, 4])
    expect(ids({ ...DEFAULT_FILTERS, query: '', format: 'CD' })).toEqual([2, 3])
  })

  it('filters by year range using the basic year when no masters are known', () => {
    expect(ids({ ...DEFAULT_FILTERS, query: '', yearMin: 1970 })).toEqual([1, 2, 4])
    expect(ids({ ...DEFAULT_FILTERS, query: '', yearMax: 2000 })).toEqual([1, 3, 4])
  })

  it('filters by year range using master years when known', () => {
    const withMasters = { 900: 1972, 901: 2001, 902: 1957 }
    const yearReleases = [
      release({ id: 1, basic_information: { ...basic, year: 1990, master_id: 900, title: 'a' } }),
      release({ id: 2, basic_information: { ...basic, year: 1990, master_id: 901, title: 'b' } }),
      release({ id: 3, basic_information: { ...basic, year: 1990, master_id: 902, title: 'c' } }),
    ]
    const from1990 = filterReleases(
      yearReleases,
      { ...DEFAULT_FILTERS, query: '', yearMin: 1990 },
      withMasters,
    )
    expect(from1990.map((r) => r.id)).toEqual([2])
    const until2000 = filterReleases(
      yearReleases,
      { ...DEFAULT_FILTERS, query: '', yearMax: 2000 },
      withMasters,
    )
    expect(until2000.map((r) => r.id)).toEqual([1, 3])
  })

  it('searches title, artists, labels and years', () => {
    expect(ids({ ...DEFAULT_FILTERS, query: 'train' })).toEqual([3])
    expect(ids({ ...DEFAULT_FILTERS, query: 'blue' })).toEqual([1, 2, 3]) // Blue Note label too
    expect(ids({ ...DEFAULT_FILTERS, query: 'test artist' })).toEqual([1, 2, 3, 4])
    expect(ids({ ...DEFAULT_FILTERS, query: '2001' })).toEqual([2])
  })

  it('does not crash when query is missing entirely', () => {
    // FilterOptions requires query at the type level, but legacy/serialized
    // filters may lack it; the runtime guards against that.
    const legacy = { ...DEFAULT_FILTERS } as Partial<FilterOptions>
    delete legacy.query
    expect(filterReleases(releases, legacy as FilterOptions)).toBe(releases)
  })
})

describe('distinct*', () => {
  const releases = [
    release({
      basic_information: {
        ...basic,
        genres: ['Rock', 'Jazz'],
        styles: ['A', 'B'],
        formats: [
          { name: 'LP', qty: '1' },
          { name: 'LP', qty: '1' },
        ],
        labels: [
          { ...basic.labels[0], name: 'X' },
          { name: 'Y', catno: '', id: 2, resource_url: '' },
        ],
      },
    }),
    release({
      basic_information: {
        ...basic,
        genres: ['Rock'],
        styles: ['B'],
        labels: [{ name: 'Y', catno: '', id: 2, resource_url: '' }],
      },
    }),
  ]

  it('returns sorted, de-duplicated values', () => {
    expect(distinctGenres(releases)).toEqual(['Jazz', 'Rock'])
    expect(distinctStyles(releases)).toEqual(['A', 'B'])
    expect(distinctFormats(releases)).toEqual(['LP'])
    expect(distinctLabels(releases)).toEqual(['X', 'Y'])
  })
})

describe('yearBounds', () => {
  it('computes min and max, ignoring unknown years', () => {
    const releases = [
      release({ basic_information: { ...basic, year: 1957 } }),
      release({ basic_information: { ...basic, year: 0 } }),
      release({ basic_information: { ...basic, year: 2020 } }),
    ]
    expect(yearBounds(releases)).toEqual({ min: 1957, max: 2020 })
  })

  it('uses master years when present', () => {
    const withMasters = { 900: 1975 }
    const bounds = yearBounds([release({ basic_information: { ...basic, year: 2000 } })], withMasters)
    expect(bounds).toEqual({ min: 1975, max: 1975 })
  })

  it('returns null for no usable years', () => {
    expect(yearBounds([])).toBeNull()
    expect(yearBounds([release({ basic_information: { ...basic, year: 0 } })])).toBeNull()
  })
})

describe('countUniqueAlbums', () => {
  it('counts masters once even with many instances', () => {
    const releases = [
      release({ id: 1, basic_information: { ...basic, master_id: 900 } }),
      release({ id: 2, basic_information: { ...basic, master_id: 900 } }),
      release({ id: 3, basic_information: { ...basic, master_id: null } }),
      release({ id: 4, basic_information: { ...basic, master_id: null } }),
    ]
    expect(countUniqueAlbums(releases)).toBe(3)
  })

  it('does not lump masterless (master_id 0) releases into one album', () => {
    const releases = [
      release({ id: 1, basic_information: { ...basic, master_id: 0 } }),
      release({ id: 2, basic_information: { ...basic, master_id: 0 } }),
    ]
    expect(countUniqueAlbums(releases)).toBe(2)
  })
})

describe('effectiveYears', () => {
  it('shows a single line when original equals pressing', () => {
    const display = toDisplayRelease(release(), { 900: 1985 })
    expect(effectiveYears(display)).toEqual([{ value: 1985 }])
  })

  it('labels both lines when they differ', () => {
    const display = toDisplayRelease(release({ basic_information: { ...basic, year: 2000 } }), {
      900: 1975,
    })
    expect(effectiveYears(display)).toEqual([
      { label: 'Original', value: 1975 },
      { label: 'Pressing', value: 2000 },
    ])
  })

  it('omits zero-unknown years', () => {
    const display = toDisplayRelease(
      release({ basic_information: { ...basic, year: 0, master_id: null } }),
    )
    expect(effectiveYears(display)).toEqual([])
  })
})

describe('groupReleases', () => {
  it('groups releases by artist and orders artists alphabetically', () => {
    const groups = groupReleases([
      release({ id: 1, basic_information: { ...basic, artists: [artist({ name: 'Zebra' })] } }),
      release({ id: 2, basic_information: { ...basic, artists: [artist({ name: 'Apple' })] } }),
    ])
    expect(groups.map((g) => g.name)).toEqual(['Apple', 'Zebra'])
    expect(groups[0].letter).toBe('A')
  })

  it('cross-lists multi-artist releases under every credited artist', () => {
    const groups = groupReleases([
      release({
        id: 1,
        basic_information: { ...basic, artists: [artist({ name: 'Alice' }), artist({ name: 'Bob', id: 2 })] },
      }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].releases[0].id).toBe(1)
    expect(groups[1].releases[0].id).toBe(1)
  })

  it('keeps Various compilations in a single group', () => {
    const groups = groupReleases([
      release({
        id: 1,
        basic_information: {
          ...basic,
          artists: [artist({ name: 'Various' }), artist({ name: 'Alice' })],
        },
      }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Various')
  })
})

describe('groupPressings', () => {
  const display = (
    over: Partial<DiscogsCollectionRelease> = {},
    masterYears: Record<number, number> = {},
  ) => toDisplayRelease(release(over), masterYears)

  it('collapses every pressing of one master into a single group', () => {
    const us = display({
      id: 1,
      instance_id: 1,
      basic_information: { ...basic, master_id: 11, title: 'Album', year: 1981, country: 'US' },
    })
    const uk = display({
      id: 2,
      instance_id: 2,
      basic_information: { ...basic, master_id: 11, title: 'Album', year: 1983, country: 'UK' },
    })

    const groups = groupPressings([us, uk])

    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('master-11')
    expect(groups[0].pressings.map((p) => p.id)).toEqual([1, 2])
    expect(groups[0].rows).toHaveLength(2)
  })

  it('orders pressings oldest first and makes the earliest the primary', () => {
    const pressings = [
      display({
        id: 1,
        instance_id: 1,
        basic_information: { ...basic, master_id: 11, year: 1981 },
      }),
      display({
        id: 2,
        instance_id: 2,
        basic_information: { ...basic, master_id: 11, year: 1979 },
      }),
      display({
        id: 3,
        instance_id: 3,
        basic_information: { ...basic, master_id: 11, year: 1983 },
      }),
    ]

    const [group] = groupPressings(pressings)

    expect(group.pressings.map((p) => p.id)).toEqual([2, 1, 3])
    expect(group.primary.id).toBe(2)
  })

  it('sends undated pressings to the end, never to primary', () => {
    const undated = display({
      id: 1,
      instance_id: 1,
      basic_information: { ...basic, master_id: 11, year: 0 },
    })
    const dated = display({
      id: 2,
      instance_id: 2,
      basic_information: { ...basic, master_id: 11, year: 1981 },
    })

    const [group] = groupPressings([undated, dated])

    expect(group.pressings.map((p) => p.id)).toEqual([2, 1])
    expect(group.primary.id).toBe(2)
    expect(group.year).toBe(1981)
  })

  it.each<[string, number | null | undefined]>([
    ['0', 0],
    ['null', null],
    ['undefined', undefined],
  ])('keeps masterless (master_id %s) releases in their own release-keyed groups', (_, masterId) => {
    const one = display({
      id: 1,
      instance_id: 1,
      basic_information: {
        ...basic,
        // Deliberately out of contract for the undefined case: the wire payload
        // can miss the field, and grouping must not care whether 0, null or a
        // missing id marks "no master".
        master_id: masterId as number | null,
        year: 1970,
      },
    })
    const two = display({
      id: 2,
      instance_id: 2,
      basic_information: {
        ...basic,
        master_id: masterId as number | null,
        year: 1971,
      },
    })

    const groups = groupPressings([one, two])

    expect(groups.map((g) => g.key)).toEqual(['release-1', 'release-2'])
    expect(groups.every((g) => g.rows.length === 1)).toBe(true)
  })

  it('gathers two copies of the same masterless release into one group', () => {
    const copyA = display({
      id: 7,
      instance_id: 1,
      basic_information: { ...basic, master_id: 0, year: 1970 },
    })
    const copyB = display({
      id: 7,
      instance_id: 2,
      basic_information: { ...basic, master_id: 0, year: 1970 },
    })

    const [group] = groupPressings([copyA, copyB])

    expect(group.key).toBe('release-7')
    expect(group.pressings).toHaveLength(2)
    expect(group.rows).toHaveLength(1)
    expect(group.rows[0].copies).toBe(2)
  })

  it('counts duplicate instances of one pressing as copies on a shared row', () => {
    const copyA = display({ id: 5, instance_id: 1, basic_information: { ...basic, master_id: 11 } })
    const copyB = display({ id: 5, instance_id: 2, basic_information: { ...basic, master_id: 11 } })
    const other = display({ id: 6, instance_id: 3, basic_information: { ...basic, master_id: 11 } })

    const [group] = groupPressings([copyA, copyB, other])

    expect(group.rows.map((row) => row.release.id)).toEqual([5, 6])
    expect(group.rows.map((row) => row.copies)).toEqual([2, 1])
    expect(group.pressings).toHaveLength(3)
  })

  it('uses the master year as the group year when it is known', () => {
    const pressings = [
      display(
        { id: 1, instance_id: 1, basic_information: { ...basic, master_id: 11, year: 1981 } },
        { 11: 1974 },
      ),
      display(
        { id: 2, instance_id: 2, basic_information: { ...basic, master_id: 11, year: 1983 } },
        { 11: 1974 },
      ),
    ]

    expect(groupPressings(pressings)[0].year).toBe(1974)
  })

  it('returns no groups for an empty list and never mutates the input order', () => {
    expect(groupPressings([])).toEqual([])
    const one = display({ id: 1, instance_id: 1, basic_information: { ...basic, master_id: 11, year: 1981 } })
    const two = display({ id: 2, instance_id: 2, basic_information: { ...basic, master_id: 11, year: 1979 } })
    const input = [one, two]
    groupPressings(input)
    expect(input.map((d) => d.id)).toEqual([1, 2])
  })
})

describe('sortPressingGroups', () => {
  const display = (over: Partial<DiscogsCollectionRelease> = {}) =>
    toDisplayRelease(release(over))

  const older = groupPressings([
    display({
      id: 1,
      instance_id: 1,
      basic_information: { ...basic, master_id: 11, title: 'Zebra', year: 1970 },
    }),
  ])[0]
  const newer = groupPressings([
    display({
      id: 2,
      instance_id: 2,
      basic_information: { ...basic, master_id: 12, title: 'Apple', year: 1990 },
    }),
  ])[0]
  const undated = groupPressings([
    display({
      id: 3,
      instance_id: 3,
      basic_information: { ...basic, master_id: 13, title: 'Mango', year: 0 },
    }),
  ])[0]

  it('sorts chronological by group year with undated groups last', () => {
    expect(sortPressingGroups([undated, newer, older], 'chronological').map((g) => g.key)).toEqual([
      'master-11',
      'master-12',
      'master-13',
    ])
  })

  it('sorts A–Z by title with the group year as tie-break', () => {
    expect(sortPressingGroups([older, newer, undated], 'byName').map((g) => g.key)).toEqual([
      'master-12',
      'master-13',
      'master-11',
    ])
  })

  it('leaves the input array untouched', () => {
    const input = [newer, older]
    sortPressingGroups(input, 'chronological')
    expect(input.map((g) => g.key)).toEqual(['master-12', 'master-11'])
  })
})

describe('activeFilterCount', () => {
  it('counts only non-default filters', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0)
    expect(
      activeFilterCount({ ...DEFAULT_FILTERS, genre: 'Rock', yearMin: 1970, yearMax: null }),
    ).toBe(2)
  })
})
describe('computeCollectionStats', () => {
  const collection = [
    release({
      id: 1,
      instance_id: 1,
      date_added: '2021-03-04T10:00:00Z',
      basic_information: {
        ...basic,
        year: 1971,
        genres: ['Rock', 'Prog Rock'],
        styles: ['Heavy Psych'],
        labels: [{ name: 'Radar', catno: 'C1', id: 1, resource_url: '' }],
        formats: [{ name: 'LP', qty: '1' }],
        artists: [artist({ name: 'Rush' })],
      },
    }),
    release({
      id: 2,
      instance_id: 2,
      date_added: '2021-03-20T10:00:00Z',
      basic_information: {
        ...basic,
        master_id: 901,
        year: 1977,
        genres: ['Rock'],
        styles: ['Arena Rock', 'Heavy Psych'],
        labels: [
          { name: 'Radar', catno: 'C2', id: 1, resource_url: '' },
          { name: 'Mercury', catno: 'C3', id: 2, resource_url: '' },
        ],
        formats: [{ name: 'LP', qty: '1' }],
        artists: [artist({ name: 'Rush' })],
      },
    }),
    release({
      id: 3,
      instance_id: 3,
      date_added: '2022-11-02T10:00:00Z',
      basic_information: {
        ...basic,
        master_id: 0,
        year: 1985,
        genres: ['Jazz'],
        styles: ['Fusion'],
        labels: [{ name: 'Blue Note', catno: 'C4', id: 3, resource_url: '' }],
        formats: [{ name: 'CD', qty: '1' }],
        artists: [artist({ name: 'Herbie Hancock' })],
      },
    }),
  ]

  it('reports totals scoped to the given releases', () => {
    const stats = computeCollectionStats(collection, { 901: 1976 })
    expect(stats.totalReleases).toBe(3)
    expect(stats.uniqueAlbums).toBe(3)
    expect(stats.artists).toBe(2)
  })

  it('ranks genres, styles, labels and formats by count', () => {
    const stats = computeCollectionStats(collection, { 901: 1976 })
    expect(stats.topGenres[0]).toEqual({ name: 'Rock', count: 2 })
    expect(stats.topStyles[0]).toEqual({ name: 'Heavy Psych', count: 2 })
    expect(stats.topLabels[0]).toEqual({ name: 'Radar', count: 2 })
    expect(stats.topFormats).toEqual([
      { name: 'LP', count: 2 },
      { name: 'CD', count: 1 },
    ])
  })

  it('caps the ranked lists at ten entries', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      release({
        id: 100 + i,
        instance_id: 100 + i,
        basic_information: {
          ...basic,
          genres: [`Genre ${i}`],
          styles: [`Style ${i}`],
          labels: [{ name: `Label ${i}`, catno: 'x', id: i, resource_url: '' }],
        },
      }),
    )
    const stats = computeCollectionStats(many)
    expect(stats.topGenres).toHaveLength(10)
    expect(stats.topStyles).toHaveLength(10)
    expect(stats.topLabels).toHaveLength(10)
  })

  it('prefers the master year over the pressing year and sorts chronologically', () => {
    const stats = computeCollectionStats(collection, { 901: 1976 })
    expect(stats.yearDistribution).toEqual([
      { year: 1971, count: 1 },
      { year: 1976, count: 1 },
      { year: 1985, count: 1 },
    ])
  })

  it('buckets acquisitions by month in chronological order', () => {
    const stats = computeCollectionStats(collection, { 901: 1976 })
    expect(stats.acquisitionTimeline.map((b) => b.period)).toEqual([
      '2021-03',
      '2022-11',
    ])
    expect(stats.acquisitionTimeline[0].count).toBe(2)
    expect(stats.acquisitionTimeline[0].label).toMatch(/2021/)
  })

  it('skips releases with unparseable acquisition dates', () => {
    const stats = computeCollectionStats(
      [release({ date_added: '' }), release({ id: 2, instance_id: 2, date_added: 'nope' })],
    )
    expect(stats.acquisitionTimeline).toEqual([])
  })

  it('returns empty collections rather than throwing', () => {
    const stats = computeCollectionStats([])
    expect(stats.totalReleases).toBe(0)
    expect(stats.topGenres).toEqual([])
    expect(stats.yearDistribution).toEqual([])
  })
})
