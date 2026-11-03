// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import type { DiscogsCollectionRelease, DiscogsFormat } from '../types/discogs'
import { compareReleases, groupReleases, toDisplayRelease, type DisplayRelease } from './collection'
import { artist, release } from '../test/factories'
import { makeSortKey } from './sortName'
import {
  conflictLabel,
  discCountOf,
  isGatefold,
  needsNotesCheck,
  isUserCall,
  mentionsGatefold,
  planCabinet,
  sizeClassOf,
  spaceUnitsOf,
} from './cabinet'

interface FakeInput {
  artist: string
  title: string
  id?: number
  year?: number
  formatText?: string
  /** Raw formats; by default one format named like the start of formatText. */
  formats?: DiscogsFormat[]
}

let counter = 0

function fake(input: FakeInput): DisplayRelease {
  const id = input.id ?? ++counter
  const year = input.year ?? 2020
  const formatText = input.formatText ?? 'Vinyl · 12" · LP'
  return {
    key: `${id}-${id}`,
    instanceId: id,
    id,
    title: input.title,
    titleKey: makeSortKey(input.title),
    year,
    originalYear: year,
    artistName: input.artist,
    genres: [],
    styles: [],
    labels: [],
    country: '',
    // Like real data: the format name is what the format text starts with.
    formatNames: [formatText.split(' · ')[0]],
    formatText,
    coverImage: '',
    thumb: '',
    release: {
      basic_information: {
        formats: input.formats ?? [{ name: formatText.split(' · ')[0], qty: '1' }],
      },
    } as unknown as DiscogsCollectionRelease,
    dateAdded: '2024-01-01T00:00:00-00:00',
  }
}

const cabinetWith = (capacities: number[]) => ({
  id: 'cab',
  name: 'Cabinet',
  slots: capacities.map((capacity, index) => ({
    id: `slot-${index + 1}`,
    label: `Slot ${index + 1}`,
    capacity,
  })),
})

const keysIn = (records: { key: string }[]) => records.map((record) => record.key)

describe('sizeClassOf', () => {
  it('reads the size from the format text', () => {
    expect(sizeClassOf(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · 12" · LP' }))).toBe(
      '12-inch',
    )
    expect(sizeClassOf(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · 7" · Single' }))).toBe(
      'small',
    )
    expect(sizeClassOf(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · 10" · EP' }))).toBe(
      'small',
    )
  })

  it('counts vinyl without a stated size as 12 inch', () => {
    expect(sizeClassOf(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · LP · Album' }))).toBe(
      '12-inch',
    )
    expect(sizeClassOf(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · Single' }))).toBe(
      '12-inch',
    )
  })

  it('only files records as small when a smaller size is stated', () => {
    expect(sizeClassOf(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · 7" · 45 RPM' }))).toBe(
      'small',
    )
    expect(
      sizeClassOf({ ...fake({ artist: 'A', title: 'T', formatText: 'Shellac · 10"' }), formatNames: ['Shellac'] }),
    ).toBe('small')
  })

  it('keeps formats that are not vinyl apart as other', () => {
    const cd = { ...fake({ artist: 'A', title: 'T', formatText: 'CD · Album' }), formatNames: ['CD'] }
    const tape = { ...fake({ artist: 'A', title: 'T', formatText: 'Cassette · Album' }), formatNames: ['Cassette'] }
    expect(sizeClassOf(cd)).toBe('other')
    expect(sizeClassOf(tape)).toBe('other')
  })

  it('treats a box set with vinyl inside as vinyl', () => {
    const box = {
      ...fake({ artist: 'A', title: 'T', formatText: 'Box Set / Vinyl · LP' }),
      formatNames: ['Box Set', 'Vinyl'],
    }
    expect(sizeClassOf(box)).toBe('12-inch')
  })

  it('uses the largest vinyl size in a set, counting an unsized LP as 12 inch', () => {
    const set = (formatText: string) =>
      sizeClassOf({ ...fake({ artist: 'A', title: 'T', formatText }), formatNames: ['Box Set', 'Vinyl'] })
    expect(set('Box Set · Compilation / Vinyl · 12" / Vinyl · 7"')).toBe('12-inch')
    // Discogs leaves the LP's size off; only the bonus single states one.
    expect(set('Vinyl · LP · Album / Vinyl · 7" · Single')).toBe('12-inch')
    expect(set('Box Set / Vinyl · 7" / Vinyl · 7"')).toBe('small')
  })

  it('reads sizes from vinyl formats only', () => {
    const of = (formatText: string, name: string) =>
      sizeClassOf({ ...fake({ artist: 'A', title: 'T', formatText }), formatNames: [name] })
    expect(of('CD · 3" · Mini', 'CD')).toBe('other')
    expect(of('Reel-To-Reel · 7" · 7 ½ ips', 'Reel-To-Reel')).toBe('other')
    expect(of('Floppy Disk · 3.5"', 'Floppy Disk')).toBe('other')
    // A CD packaged with a 7" is filed by the 7".
    expect(
      sizeClassOf({
        ...fake({ artist: 'A', title: 'T', formatText: 'CD · Album / Vinyl · 7"' }),
        formatNames: ['CD', 'Vinyl'],
      }),
    ).toBe('small')
  })
})

describe('spaceUnitsOf', () => {
  it('counts a gatefold sleeve as two spaces', () => {
    expect(spaceUnitsOf(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · 12" · LP · Gatefold' }))).toBe(2)
  })

  it('counts a standard sleeve as one space', () => {
    expect(spaceUnitsOf(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · 12" · LP' }))).toBe(1)
  })

  it('finds a gatefold in a format\'s free text', () => {
    const record = fake({
      artist: 'A',
      title: 'T',
      formatText: 'Vinyl · LP · Album',
      formats: [{ name: 'Vinyl', qty: '1', text: '180g, Gatefold', descriptions: ['LP', 'Album'] }],
    })
    expect(spaceUnitsOf(record)).toBe(2)
  })

  it('counts a gatefold the release notes describe', () => {
    // Blink-182 – Enema Of The State (9160941): only the notes say gatefold.
    const record = fake({ artist: 'blink-182', title: 'Enema Of The State', id: 9160941, formatText: 'Vinyl · LP · Album · Reissue · Stereo' })
    expect(spaceUnitsOf(record)).toBe(1)
    const notes = '180 Gram Heavyweight Vinyl\nGatefold sleeve.\nMade in the EU.'
    expect(spaceUnitsOf(record, { notes: { '9160941': notes } })).toBe(2)
    expect(spaceUnitsOf(record, { notes: { '9160941': 'Printed inner sleeve.' } })).toBe(1)
    expect(spaceUnitsOf(record, { notes: { '9160941': '' } })).toBe(1)
  })

  it('ignores gatefold text on a format that is not vinyl', () => {
    // A CD's gatefold card sleeve doesn't make the LP in the same set thicker.
    const set = fake({
      artist: 'A',
      title: 'T',
      formatText: 'Vinyl · LP / CD · Album · Gatefold',
      formats: [
        { name: 'Vinyl', qty: '1', descriptions: ['LP'] },
        { name: 'CD', qty: '1', text: 'Gatefold digisleeve', descriptions: ['Album', 'Gatefold'] },
      ],
    })
    expect(spaceUnitsOf(set)).toBe(1)
    const cd = fake({
      artist: 'A',
      title: 'T',
      formatText: 'CD · Album',
      formats: [{ name: 'CD', qty: '1', text: 'Gatefold Cardboard Sleeve' }],
    })
    expect(isGatefold(cd)).toBe(false)
  })

  it('lets the user\'s call win both ways', () => {
    const plain = fake({ artist: 'A', title: 'T', id: 1, formatText: 'Vinyl · LP' })
    const folded = fake({ artist: 'A', title: 'U', id: 2, formatText: 'Vinyl · LP · Gatefold' })
    expect(spaceUnitsOf(plain, { overrides: { '1': true } })).toBe(2)
    expect(spaceUnitsOf(folded, { overrides: { '2': false } })).toBe(1)
    expect(isGatefold(folded, { notes: { '2': 'Gatefold' }, overrides: { '2': false } })).toBe(false)
  })

  it('treats only a call that disagrees with Discogs as the user\'s', () => {
    const lp = fake({ artist: 'A', title: 'T', id: 1, formatText: 'Vinyl · LP' })
    expect(isUserCall(lp, { overrides: { '1': true } })).toBe(true)
    // Marked as gatefold before the notes said so: it now agrees, so it's Discogs' call.
    expect(isUserCall(lp, { notes: { '1': 'Gatefold sleeve' }, overrides: { '1': true } })).toBe(false)
    expect(isUserCall(lp)).toBe(false)
  })

  it('gives a multi-disc set one space per disc, gatefold or not', () => {
    const lps = (qty: string, descriptions: string[] = ['LP']) =>
      fake({
        artist: 'A',
        title: 'T',
        formatText: ['Vinyl', ...descriptions].join(' · '),
        formats: [{ name: 'Vinyl', qty, descriptions }],
      })
    expect(spaceUnitsOf(lps('2'))).toBe(2)
    expect(spaceUnitsOf(lps('2', ['LP', 'Gatefold']))).toBe(2)
    expect(spaceUnitsOf(lps('3'))).toBe(3)
    expect(discCountOf(lps('nonsense'))).toBe(1)
  })

  it('does not count a bonus 7" or flexi tucked in an LP\'s sleeve', () => {
    const bonus = fake({
      artist: 'A',
      title: 'T',
      formatText: 'Vinyl · LP · Album / Vinyl · 7" · Single / Flexi-disc · 7"',
      formats: [
        { name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album'] },
        { name: 'Vinyl', qty: '1', descriptions: ['7"', 'Single'] },
        { name: 'Flexi-disc', qty: '1', descriptions: ['7"'] },
      ],
    })
    expect(discCountOf(bonus)).toBe(1)
    expect(spaceUnitsOf(bonus)).toBe(1)
    // A double 7" single still takes two.
    const double7 = fake({
      artist: 'A',
      title: 'T',
      formatText: 'Vinyl · 7"',
      formats: [{ name: 'Vinyl', qty: '2', descriptions: ['7"'] }],
    })
    expect(discCountOf(double7)).toBe(2)
  })

  it('counts vinyl discs only in a mixed set', () => {
    const record = fake({
      artist: 'A',
      title: 'T',
      formatText: 'Vinyl · LP / CD · Album',
      formats: [
        { name: 'Vinyl', qty: '1', descriptions: ['LP'] },
        { name: 'CD', qty: '2', descriptions: ['Album'] },
      ],
    })
    expect(discCountOf(record)).toBe(1)
    expect(spaceUnitsOf(record)).toBe(1)
  })
})

describe('mentionsGatefold', () => {
  it.each([
    '180 Gram Heavyweight Vinyl\nGatefold sleeve.',
    'Comes in a gate-fold cover',
    'Gate fold jacket with lyrics',
    'Pitman Pressing, Gatefold',
    'Issued in gatefold jacket',
    'Klappcover mit Textbeilage',
    'Pochette ouvrante',
    'Copertina apribile',
    'Doble carpeta',
    'Uitklaphoes',
    'Fold-out cover with poster',
    'Tri-fold sleeve',
    '見開きジャケット',
    // A denial in an earlier sentence doesn't carry over.
    'Not on label. Gatefold sleeve.',
  ])('finds a gatefold in "%s"', (text) => {
    expect(mentionsGatefold(text)).toBe(true)
  })

  it.each([
    'Printed inner sleeve. Includes a download voucher.',
    'Unlike the original gatefold issue, this repress comes in a single sleeve.',
    'Not a gatefold.',
    'No gatefold on this pressing',
    'Comes without the gatefold of the first edition',
    'Includes a gatefold poster',
    'With gatefold insert',
    'Gatefold inner sleeve',
    '',
  ])('finds no gatefold in "%s"', (text) => {
    expect(mentionsGatefold(text)).toBe(false)
  })

  it('reads a gatefold that a denied mention is followed by', () => {
    expect(mentionsGatefold('Not the poster: the jacket is a gatefold.')).toBe(true)
    expect(mentionsGatefold(undefined)).toBe(false)
  })
})

describe('needsNotesCheck', () => {
  it('only asks about single vinyl LPs that are not known yet', () => {
    const lp = fake({ artist: 'A', title: 'T', id: 1, formatText: 'Vinyl · LP' })
    expect(needsNotesCheck(lp)).toBe(true)
    expect(needsNotesCheck(lp, { notes: { '1': '' } })).toBe(false)
    // The user already decided; the notes can't change that.
    expect(needsNotesCheck(lp, { overrides: { '1': false } })).toBe(false)
    expect(needsNotesCheck(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · LP · Gatefold' }))).toBe(false)
    expect(needsNotesCheck(fake({ artist: 'A', title: 'T', formatText: 'CD · Album' }))).toBe(false)
    expect(
      needsNotesCheck(
        fake({ artist: 'A', title: 'T', formatText: 'Vinyl · LP', formats: [{ name: 'Vinyl', qty: '2' }] }),
      ),
    ).toBe(false)
  })
})

describe('planCabinet sorting', () => {
  // One artist: a 2015 reissue of a 1971 album, a 1980 album and an undated one.
  const reissue = { ...fake({ id: 1, artist: 'The Band', title: 'Zulu', year: 2015 }), originalYear: 1971 }
  const eighties = fake({ id: 2, artist: 'The Band', title: 'Alpha', year: 1980 })
  const undated = { ...fake({ id: 3, artist: 'The Band', title: 'Mid', year: 0 }), originalYear: 0 }
  const other = fake({ id: 4, artist: 'Abba', title: 'Waterloo', year: 1974 })
  const shelf = (sort: 'chronological' | 'byName') =>
    planCabinet({
      releases: [undated, eighties, reissue, other],
      cabinet: cabinetWith([10]),
      options: { sort, separateSizeClasses: false },
    }).slots[0].records.map((record) => record.display.title)

  const mainView = (sort: 'chronological' | 'byName') =>
    [undated, eighties, reissue].sort((a, b) => compareReleases(a, b, sort)).map((d) => d.title)

  it('files each artist the way the main view lists it, in Year order', () => {
    // "The Band" files under B, after Abba; inside it, the main view's order:
    // by original year (the reissue as 1971), undated last.
    expect(mainView('chronological')).toEqual(['Zulu', 'Alpha', 'Mid'])
    expect(shelf('chronological')).toEqual(['Waterloo', ...mainView('chronological')])
  })

  it('files each artist the way the main view lists it, in A–Z order', () => {
    expect(mainView('byName')).toEqual(['Alpha', 'Mid', 'Zulu'])
    expect(shelf('byName')).toEqual(['Waterloo', ...mainView('byName')])
  })

  it('always keeps artists together, whichever order is picked', () => {
    // Even in A–Z, "Alpha" by The Band never jumps ahead of Abba's "Waterloo".
    for (const sort of ['chronological', 'byName'] as const) {
      expect(shelf(sort)[0]).toBe('Waterloo')
    }
  })
})

describe('planCabinet', () => {
  it('distributes a collection evenly across slots', () => {
    const releases = [
      fake({ artist: 'A', title: 'a' }),
      fake({ artist: 'B', title: 'b' }),
      fake({ artist: 'C', title: 'c' }),
      fake({ artist: 'D', title: 'd' }),
      fake({ artist: 'E', title: 'e' }),
      fake({ artist: 'F', title: 'f' }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([10, 10, 10]) })
    expect(plan.slots.map((slot) => slot.records.length)).toEqual([2, 2, 2])
    expect(plan.conflicts).toEqual([])
    expect(plan.unplaced).toEqual([])
  })

  it('keeps an artist together even when that overshoots the even target', () => {
    const releases = [
      fake({ id: 1, artist: 'A', title: 'a1', year: 2010 }),
      fake({ artist: 'A', title: 'a2', year: 2011, id: 2 }),
      fake({ artist: 'A', title: 'a3', year: 2012, id: 3 }),
      fake({ artist: 'B', title: 'b1', id: 4 }),
      fake({ artist: 'B', title: 'b2', id: 5 }),
      fake({ artist: 'B', title: 'b3', id: 6 }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([10, 10, 10]) })
    expect(plan.slots.map((slot) => keysIn(slot.records))).toEqual([
      ['1-1', '2-2', '3-3'],
      ['4-4', '5-5', '6-6'],
      [],
    ])
    expect(plan.conflicts).toEqual([])
  })

  it('keeps size classes in separate slots', () => {
    const releases = [
      fake({ artist: 'A', title: 'a', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'B', title: 'b', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'C', title: 'c', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'D', title: 'd', formatText: 'Vinyl · 7"' }),
      fake({ artist: 'E', title: 'e', formatText: 'Vinyl · 7"' }),
      fake({ artist: 'F', title: 'f', formatText: 'Vinyl · 7"' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([10, 10]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.slots[0].sizeClass).toBe('12-inch')
    expect(plan.slots[1].sizeClass).toBe('small')
    expect(plan.conflicts).toEqual([])
  })

  it('gives each size its own shelves, spread evenly, when the shelves allow it', () => {
    // An even share of the whole collection (4 per shelf) would leave the 7"
    // sharing the last shelf; per size, the 12"s spread over two shelves and
    // the 7" gets the third.
    const releases = [
      ...'ABCDEFGHIJK'.split('').map((artist) => fake({ artist, title: artist, formatText: 'Vinyl · LP' })),
      fake({ artist: 'L', title: 'L', formatText: 'Vinyl · 7"' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([10, 10, 10]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.slots.map((slot) => [slot.sizeClass, slot.records.length])).toEqual([
      ['12-inch', 6],
      ['12-inch', 5],
      ['small', 1],
    ])
    expect(plan.conflicts).toEqual([])
  })

  it('keeps sizes apart on uneven shelves when they fit', () => {
    // Three 12" and three 7" on shelves of 3, 2 and 1: the 12"s fill the
    // first shelf, the 7"s the other two.
    const releases = ['A', 'B', 'C', 'D', 'E', 'F'].map((artist, index) =>
      fake({ artist, title: artist.toLowerCase(), formatText: index % 2 ? 'Vinyl · 7"' : 'Vinyl · 12"' }),
    )
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([3, 2, 1]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.slots.map((slot) => slot.sizeClass)).toEqual(['12-inch', 'small', 'small'])
    expect(plan.conflicts).toEqual([])
  })

  it('keeps the reading order when the sizes have to share a shelf', () => {
    // Seven shelves of 70; 430 LPs need a little more than six shelves, so the
    // 40 singles can't have a shelf of their own and share the seventh. Like
    // the real cabinet that showed the bug: every shelf is nearly full.
    const artist = (i: number) => `Artist ${String(i).padStart(3, '0')}`
    const lps = Array.from({ length: 430 }, (_, i) =>
      fake({ artist: artist(i), title: 'lp', formatText: 'Vinyl · LP' }),
    )
    const singles = Array.from({ length: 40 }, (_, i) =>
      fake({ artist: artist(i * 3), title: 'single', formatText: 'Vinyl · 7"' }),
    )
    const plan = planCabinet({
      releases: [...singles, ...lps],
      cabinet: cabinetWith([70, 70, 70, 70, 70, 70, 70]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })

    // Shelves 1–6 are LPs only, spread evenly; the seventh holds the last
    // 22 LPs, then the 40 singles.
    expect(plan.slots.map((slot) => slot.records.length)).toEqual([68, 68, 68, 68, 68, 68, 62])
    expect(plan.slots.slice(0, 6).map((slot) => slot.sizeClass)).toEqual(Array(6).fill('12-inch'))
    // Reading the shelves in turn gives every LP A–Z, then every single A–Z:
    // shelf 7 holds the last 22 LPs, not singles first with LPs after them.
    const read = plan.slots.flatMap((slot) => slot.records.map((record) => record.display.key))
    const bySinglesArtist = [...singles].sort((a, b) => a.artistName.localeCompare(b.artistName))
    expect(read).toEqual([...lps, ...bySinglesArtist].map((display) => display.key))

    expect(plan.unplaced).toEqual([])
    expect(plan.conflicts).toEqual([{ type: 'size-mix', count: 1 }])
  })

  it('mixes sizes only when the shelves cannot keep them apart, with one warning', () => {
    // Three 12" and three 7" on shelves of 4 and 2: the 7"s need three spaces
    // and the second shelf has two, so one 7" joins the 12"s.
    const releases = ['A', 'B', 'C', 'D', 'E', 'F'].map((artist, index) =>
      fake({ artist, title: artist.toLowerCase(), formatText: index % 2 ? 'Vinyl · 7"' : 'Vinyl · 12"' }),
    )
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([4, 2]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.slots.map((slot) => slot.sizeClass)).toEqual(['mixed', 'small'])
    expect(plan.unplaced).toEqual([])
    // The LPs, then the singles, in order: nothing back-filled out of order.
    expect(plan.slots.map((slot) => slot.records.map((record) => record.display.artistName))).toEqual([
      ['A', 'C', 'E', 'B'],
      ['D', 'F'],
    ])
    expect(plan.conflicts).toEqual([{ type: 'size-mix', count: 1 }])
    expect(conflictLabel(plan.conflicts[0])).toBe('Mixed sizes on 1 shelf')
    expect(conflictLabel({ type: 'size-mix', count: 2 })).toBe('Mixed sizes on 2 shelves')
  })

  it('shares as few size boundaries as it must', () => {
    // A 10" single, two LPs and a CD on two shelves of 5: three sizes, two
    // shelves. Two neighbouring sizes share one shelf and the third keeps the
    // other, so only one shelf is mixed, not two (chaining all three put a
    // size boundary on each shelf).
    const releases = [
      fake({ artist: 'C', title: 'c', formatText: 'Vinyl · LP' }),
      fake({ artist: 'B', title: 'b', formatText: 'Vinyl · 10" · EP' }),
      fake({ artist: 'D', title: 'd-lp', formatText: 'Vinyl · LP' }),
      fake({ artist: 'D', title: 'd-cd', formatText: 'CD · Album' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([5, 5]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.conflicts).toEqual([{ type: 'size-mix', count: 1 }])
    // Still in order: the single (B), then the LPs, then the CD.
    expect(plan.slots.flatMap((slot) => slot.records.map((record) => record.display.title))).toEqual([
      'b',
      'c',
      'd-lp',
      'd-cd',
    ])
  })

  it('picks the way of filling that places every record', () => {
    // 8 spaces of records on shelves of 1, 4, 2 and 1. Filling each shelf in
    // turn would leave only one-space gaps for the last gatefold; spreading
    // and back-filling places everything, so that layout wins.
    const releases = [
      fake({ id: 1, artist: 'B', title: 'b1', formatText: 'CD · Album' }),
      fake({ id: 2, artist: 'B', title: 'b2', formatText: 'CD · Album' }),
      fake({ id: 3, artist: 'B', title: 'b3', formatText: 'CD · Album' }),
      fake({ id: 4, artist: 'D', title: 'd1', year: 2001, formatText: 'Vinyl · LP · Gatefold' }),
      fake({ id: 5, artist: 'D', title: 'd2', year: 2002, formatText: 'Vinyl · 7"' }),
      fake({ id: 6, artist: 'D', title: 'd3', year: 2003, formatText: 'Vinyl · LP · Gatefold' }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([1, 4, 2, 1]) })
    expect(plan.unplaced).toEqual([])
    expect(plan.slots.reduce((total, slot) => total + slot.used, 0)).toBe(8)
  })

  it('falls back to the size-skipping walk when only it fits every record', () => {
    // Shelves of 4 and 3 holding exactly 7 spaces: two CDs, an LP and two
    // gatefold LPs. Every layout that keeps the order strands a gatefold; the
    // size-skipping walk fits them all, so it wins, out of order as it is.
    const releases = [
      fake({ id: 0, artist: 'C', title: 'c', year: 2000, formatText: 'CD · Album' }),
      fake({ id: 1, artist: 'D', title: 'd1', year: 2001, formatText: 'Vinyl · LP · Gatefold' }),
      fake({ id: 2, artist: 'A', title: 'a-cd', year: 2002, formatText: 'CD · Album' }),
      fake({ id: 3, artist: 'D', title: 'd3', year: 2003, formatText: 'Vinyl · LP · Gatefold' }),
      fake({ id: 4, artist: 'A', title: 'a-lp', year: 2004, formatText: 'Vinyl · LP' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([4, 3]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.unplaced).toEqual([])
    expect(plan.slots.map((slot) => slot.used)).toEqual([4, 3])
  })

  it('places everything in a tight cabinet without size separation', () => {
    // 6 spaces of records in 6, A–Z within each artist, two of them gatefolds.
    const releases = [
      fake({ id: 1, artist: 'A', title: 'a4', formatText: 'Vinyl · LP · Gatefold' }),
      fake({ id: 2, artist: 'B', title: 'b3', formatText: 'Vinyl · LP' }),
      fake({ id: 3, artist: 'C', title: 'c1', formatText: 'Vinyl · LP' }),
      fake({ id: 4, artist: 'C', title: 'c2', formatText: 'Vinyl · LP · Gatefold' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([1, 4, 1]),
      options: { sort: 'byName', separateSizeClasses: false },
    })
    expect(plan.unplaced).toEqual([])
    expect(plan.slots.map((slot) => slot.used)).toEqual([1, 4, 1])
  })

  it('keeps the reading order with the A–Z sort as well', () => {
    // Artist A's titles run the other way round from their years, so A–Z and
    // Year give different shelves. Two LPs' worth too many for the singles to
    // get the second shelf: the LPs (A–Z), then A's singles (A–Z), share the
    // first.
    const releases = [
      fake({ artist: 'A', title: 'zebra', year: 1970, formatText: 'Vinyl · LP' }),
      fake({ artist: 'A', title: 'apple', year: 1980, formatText: 'Vinyl · LP' }),
      fake({ artist: 'B', title: 'b-lp', year: 1990, formatText: 'Vinyl · LP' }),
      fake({ artist: 'A', title: 'yellow', year: 1971, formatText: 'Vinyl · 7"' }),
      fake({ artist: 'A', title: 'banana', year: 1985, formatText: 'Vinyl · 7"' }),
    ]
    const layout = (sort: 'byName' | 'chronological') =>
      planCabinet({
        releases,
        cabinet: cabinetWith([4, 1]),
        options: { sort, separateSizeClasses: true },
      }).slots.map((slot) => slot.records.map((record) => record.display.title))
    expect(layout('byName')).toEqual([['apple', 'zebra', 'b-lp', 'banana'], ['yellow']])
    expect(layout('chronological')).toEqual([['zebra', 'apple', 'b-lp', 'yellow'], ['banana']])
  })

  it('sets a record bigger than every shelf aside, and lays out the rest as usual', () => {
    // A 12-LP box set on shelves of 6 fits nowhere. It counts as without a
    // shelf, and doesn't push the records after it out of order.
    const lps = 'ABCDEFGHI'.split('').map((artist) => fake({ artist, title: artist, formatText: 'Vinyl · LP' }))
    const box = fake({
      artist: 'E',
      title: 'box',
      formatText: 'Vinyl · LP · Box Set',
      formats: [{ name: 'Vinyl', qty: '12', descriptions: ['LP'] }],
    })
    const singles = ['S', 'T'].map((artist) => fake({ artist, title: artist, formatText: 'Vinyl · 7"' }))
    const plan = planCabinet({
      releases: [...lps, box, ...singles],
      cabinet: cabinetWith([6, 6, 6]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.unplaced.map((display) => display.title)).toEqual(['box'])
    // The LPs spread over two shelves, the singles keep the third.
    expect(plan.slots.map((slot) => slot.sizeClass)).toEqual(['12-inch', '12-inch', 'small'])
    expect(plan.conflicts).toEqual([{ type: 'unplaced', count: 1 }])
  })

  it('spreads over uneven shelves by their size, instead of packing them', () => {
    // 26 LPs on shelves of 21 and 12: an equal share (13) is more than the
    // small shelf holds, so the share follows each shelf's size instead.
    const releases = Array.from({ length: 26 }, (_, i) =>
      fake({ artist: `A${String(i).padStart(2, '0')}`, title: 't', formatText: 'Vinyl · LP' }),
    )
    const plan = planCabinet({ releases, cabinet: cabinetWith([21, 12]) })
    expect(plan.conflicts).toEqual([])
    expect(plan.slots.map((slot) => slot.used)).toEqual([17, 9])
  })

  it('prefers the layout with fewer mixed shelves when everything else is equal', () => {
    // A 10" single, two gatefold LPs and a CD by one artist on shelves of 4, 1
    // and 5 (year 0 is undated: those sort last, which puts the CD and one LP
    // at the end). Two layouts place everything in order; the one with one
    // mixed shelf wins over the one with two.
    const releases = [
      fake({ id: 0, artist: 'ABBA', title: 'The D', year: 0, formatText: 'CD · Album' }),
      fake({ id: 1, artist: 'ABBA', title: 'C', year: 1980, formatText: 'Vinyl · LP · Gatefold' }),
      fake({ id: 2, artist: 'ABBA', title: 'C', year: 0, formatText: 'Vinyl · LP · Gatefold' }),
      fake({ id: 3, artist: 'ABBA', title: 'B', year: 1980, formatText: 'Vinyl · 10"' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([4, 1, 5]),
      options: { sort: 'byName', separateSizeClasses: true },
    })
    expect(plan.unplaced).toEqual([])
    expect(plan.conflicts.filter((conflict) => conflict.type !== 'artist-split')).toEqual([
      { type: 'size-mix', count: 1 },
    ])
  })

  it('reports records back-filled onto an earlier shelf as out of order', () => {
    // Shelves of 5 and 5, with a gatefold (2 spaces) among nine records: keeping
    // to an even share leaves Z no room on shelf 2, so it fills the gap on shelf 1.
    const releases = 'ABCDEFGHZ'.split('').map((artist) =>
      fake({ artist, title: artist, formatText: artist === 'E' ? 'Vinyl · LP · Gatefold' : 'Vinyl · LP' }),
    )
    const plan = planCabinet({ releases, cabinet: cabinetWith([5, 5]) })
    expect(plan.unplaced).toEqual([])
    expect(plan.slots[0].records.map((record) => record.display.artistName)).toContain('Z')
    expect(plan.conflicts).toEqual([{ type: 'out-of-order', count: 1 }])
    expect(conflictLabel(plan.conflicts[0])).toBe('1 record out of order')
  })

  it('files a release credited to several artists once, under the first', () => {
    // The main view lists a split under both artists; a cabinet holds one copy.
    const split = release({
      id: 7,
      instance_id: 70,
      basic_information: {
        ...release().basic_information,
        artists: [artist({ name: 'Zappa' }), artist({ name: 'Beefheart', id: 2 })],
      },
    })
    expect(groupReleases([split])).toHaveLength(2)

    const display = toDisplayRelease(split)
    const others = [fake({ artist: 'Abba', title: 'a' }), fake({ artist: 'Yes', title: 'y' })]
    const plan = planCabinet({ releases: [...others, display], cabinet: cabinetWith([10]) })
    const filed = plan.slots[0].records.map((record) => record.display.artistName)
    expect(filed).toEqual(['Abba', 'Yes', 'Zappa'])
    expect(Object.keys(plan.placements)).toHaveLength(3)
  })

  it('reports nothing out of order when every record follows the order', () => {
    const releases = 'ABCDEF'.split('').map((artist) => fake({ artist, title: artist }))
    const plan = planCabinet({ releases, cabinet: cabinetWith([3, 3]) })
    expect(plan.conflicts).toEqual([])
  })

  it('labels every warning with shelves and records, in the singular when it is one', () => {
    expect(conflictLabel({ type: 'unplaced', count: 1 })).toBe('1 record without a shelf')
    expect(conflictLabel({ type: 'unplaced', count: 3 })).toBe('3 records without a shelf')
    expect(conflictLabel({ type: 'artist-split', artist: 'Abba' })).toBe('Abba split across shelves')
    expect(conflictLabel({ type: 'over-capacity', slotId: 's', count: 2 })).toBe('2 spaces over capacity')
  })

  it('does not warn about mixed sizes when they are not kept apart', () => {
    const releases = [
      fake({ artist: 'A', title: 'a', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'B', title: 'b', formatText: 'Vinyl · 7"' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([10]),
      options: { sort: 'chronological', separateSizeClasses: false },
    })
    expect(plan.slots[0].sizeClass).toBe('mixed')
    expect(plan.conflicts).toEqual([])
  })

  it('places every record when the cabinet has no slots', () => {
    const releases = [fake({ artist: 'A', title: 'a' })]
    const plan = planCabinet({ releases, cabinet: { id: 'c', name: 'C', slots: [] } })
    expect(plan.unplaced).toHaveLength(1)
    expect(plan.conflicts).toEqual([{ type: 'unplaced', count: 1 }])
  })

  it('reports records that do not fit as unplaced', () => {
    const releases = [1, 2, 3, 4, 5].map((id) =>
      fake({ artist: `Artist ${id}`, title: `t${id}`, id }),
    )
    const plan = planCabinet({ releases, cabinet: cabinetWith([3]) })
    expect(plan.slots[0].records).toHaveLength(3)
    expect(plan.unplaced).toHaveLength(2)
    expect(plan.conflicts).toContainEqual({ type: 'unplaced', count: 2 })
  })

  it('fills every shelf before reporting records as unplaced', () => {
    const releases = Array.from({ length: 391 }, (_, index) =>
      fake({ id: index + 1, artist: `Artist ${String(index).padStart(3, '0')}`, title: `t${index}` }),
    )

    const one = planCabinet({ releases, cabinet: cabinetWith([70]) })
    expect(one.slots[0].records).toHaveLength(70)
    expect(one.unplaced).toHaveLength(321)

    const two = planCabinet({ releases, cabinet: cabinetWith([70, 70]) })
    expect(two.slots.map((slot) => slot.records.length)).toEqual([70, 70])
    expect(two.unplaced).toHaveLength(251)

    const plenty = planCabinet({ releases, cabinet: cabinetWith(Array(6).fill(70)) })
    expect(plenty.unplaced).toEqual([])
  })

  it('groups size classes even when artists interleave sizes', () => {
    const releases = [
      fake({ id: 1, artist: 'A', title: 'a12', formatText: 'Vinyl · 12"' }),
      fake({ id: 2, artist: 'A', title: 'a7', formatText: 'Vinyl · 7"' }),
      fake({ id: 3, artist: 'B', title: 'b12', formatText: 'Vinyl · 12"' }),
      fake({ id: 4, artist: 'B', title: 'b7', formatText: 'Vinyl · 7"' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([10, 10]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.slots[0].sizeClass).toBe('small')
    expect(plan.slots[1].sizeClass).toBe('12-inch')
    expect(keysIn(plan.slots[0].records)).toEqual(['2-2', '4-4'])
    expect(keysIn(plan.slots[1].records)).toEqual(['1-1', '3-3'])
  })

  it('keeps shelves in artist order when a shelf is added', () => {
    const releases = [
      fake({ id: 1, artist: 'A', title: 'a', formatText: 'Vinyl · 7"' }),
      fake({ id: 2, artist: 'B', title: 'b', formatText: 'Vinyl · 12"' }),
      fake({ id: 3, artist: 'C', title: 'c', formatText: 'Vinyl · 12"' }),
    ]

    const one = planCabinet({ releases, cabinet: cabinetWith([2]) })
    expect(keysIn(one.slots[0].records)).toEqual(['1-1', '2-2'])

    const two = planCabinet({ releases, cabinet: cabinetWith([2, 2]) })
    expect(keysIn(two.slots[0].records)).toEqual(['1-1', '2-2'])
    expect(keysIn(two.slots[1].records)).toEqual(['3-3'])

    const three = planCabinet({ releases, cabinet: cabinetWith([2, 2, 2]) })
    expect(three.slots.map((slot) => keysIn(slot.records))).toEqual([
      ['1-1'],
      ['2-2'],
      ['3-3'],
    ])
  })

  it('starts a size-separated layout with the earliest class', () => {
    const releases = [
      fake({ id: 1, artist: 'B', title: 'b12', formatText: 'Vinyl · 12"' }),
      fake({ id: 2, artist: 'A', title: 'a7', formatText: 'Vinyl · 7"' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([10, 10]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(keysIn(plan.slots[0].records)).toEqual(['2-2'])
    expect(keysIn(plan.slots[1].records)).toEqual(['1-1'])
  })

  it('reuses spare shelf space before leaving records unplaced', () => {
    const releases = [
      fake({ id: 1, artist: 'A', title: 'a', formatText: 'Vinyl · 12"' }),
      fake({ id: 2, artist: 'B', title: 'b', formatText: 'Vinyl · 12"' }),
      fake({ id: 3, artist: 'C', title: 'c', formatText: 'Vinyl · 12"' }),
      ...[4, 5, 6, 7, 8, 9, 10, 11].map((id) =>
        fake({ id, artist: `S${id}`, title: `s${id}`, formatText: 'Vinyl · 7"' }),
      ),
      ...[12, 13, 14, 15].map((id) =>
        fake({ id, artist: `O${id}`, title: `o${id}`, formatText: 'CD · Album' }),
      ),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([10, 10]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.unplaced).toEqual([])
    // Three sizes on two shelves can't all be kept apart. The fewest share:
    // the LPs and CDs share the first shelf, in order, and the singles keep
    // the second to themselves. (Groups go by their first artist: A, O, S.)
    const read = (index: number) => plan.slots[index].records.map((record) => record.display.title)
    expect(read(0)).toEqual(['a', 'b', 'c', 'o12', 'o13', 'o14', 'o15'])
    expect(read(1)).toEqual(['s4', 's5', 's6', 's7', 's8', 's9', 's10', 's11'])
    expect(plan.conflicts).toEqual([{ type: 'size-mix', count: 1 }])
  })

  it('reports an artist split across slots', () => {
    const releases = [
      fake({ artist: 'A', title: 'a1', id: 1 }),
      fake({ artist: 'A', title: 'a2', id: 2 }),
      fake({ artist: 'A', title: 'a3', id: 3 }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([2, 2]) })
    expect(plan.slots.map((slot) => slot.records.length)).toEqual([2, 1])
    expect(plan.conflicts).toContainEqual({ type: 'artist-split', artist: 'A' })
  })

  it('does not call an artist split when only the kept-apart sizes divide them', () => {
    const releases = [
      fake({ artist: 'A', title: 'lp1', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'A', title: 'lp2', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'A', title: 'single', formatText: 'Vinyl · 7"' }),
      fake({ artist: 'B', title: 'b', formatText: 'Vinyl · 7"' }),
    ]
    const options = { sort: 'chronological' as const, separateSizeClasses: true }
    const plan = planCabinet({ releases, cabinet: cabinetWith([10, 10]), options })
    expect(plan.slots.map((slot) => slot.sizeClass)).toEqual(['12-inch', 'small'])
    expect(plan.conflicts).toEqual([])

    // Without the separation the same layout question is a real split.
    const together = planCabinet({
      releases,
      cabinet: cabinetWith([2, 2]),
      options: { ...options, separateSizeClasses: false },
    })
    expect(together.conflicts).toContainEqual({ type: 'artist-split', artist: 'A' })
  })

  it('still reports an artist whose records of one size cross shelves', () => {
    const releases = [
      fake({ artist: 'A', title: 'lp1', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'A', title: 'lp2', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'A', title: 'lp3', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'A', title: 'single', formatText: 'Vinyl · 7"' }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([2, 2, 2]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    const splits = plan.conflicts.filter((conflict) => conflict.type === 'artist-split')
    expect(splits).toEqual([{ type: 'artist-split', artist: 'A' }])
  })

  it('fills shelves by the sleeves it learns from the notes', () => {
    const releases = [1, 2, 3].map((id) => fake({ artist: 'A', title: `a${id}`, id, formatText: 'Vinyl · LP' }))
    const cabinet = cabinetWith([3])
    expect(planCabinet({ releases, cabinet }).unplaced).toEqual([])
    const plan = planCabinet({ releases, cabinet, sleeves: { notes: { '1': 'Gatefold sleeve.' } } })
    expect(plan.slots[0].used).toBe(3)
    expect(plan.unplaced).toHaveLength(1)
  })

  it('counts a gatefold as two spaces against shelf capacity', () => {
    const releases = [
      fake({ id: 1, artist: 'A', title: 'gatefold', formatText: 'Vinyl · 12" · Gatefold' }),
      fake({ id: 2, artist: 'B', title: 'normal' }),
      fake({ id: 3, artist: 'C', title: 'overflow' }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([3]) })
    expect(plan.slots[0].used).toBe(3)
    expect(plan.slots[0].records).toHaveLength(2)
    expect(plan.unplaced).toEqual([releases[2]])
  })

  it('leaves a gatefold unplaced when no shelf has room for both spaces', () => {
    const releases = [
      fake({ id: 1, artist: 'A', title: 'gatefold', formatText: 'Vinyl · 12" · Gatefold' }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([1, 1]) })
    expect(plan.unplaced).toEqual([releases[0]])
  })

  it('leaves the caller collection untouched', () => {
    const releases = [
      fake({ artist: 'B', title: 'b', id: 1 }),
      fake({ artist: 'A', title: 'a', id: 2 }),
    ]
    const before = [...releases]
    planCabinet({ releases, cabinet: cabinetWith([5, 5]) })
    expect(releases).toEqual(before)
  })

  it('orders slot contents by the selected mode', () => {
    const releases = [
      fake({ artist: 'A', title: 'Zebra', id: 1 }),
      fake({ artist: 'A', title: 'Apple', id: 2 }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([5, 5]),
      options: { sort: 'byName', separateSizeClasses: true },
    })
    expect(keysIn(plan.slots[0].records)).toEqual(['2-2', '1-1'])
  })
})
