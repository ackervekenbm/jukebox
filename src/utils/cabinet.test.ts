// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import { compareReleases, groupReleases, toDisplayRelease } from './collection'
import { artist, fakeRecord, release } from '../test/factories'
import { conflictLabel, planCabinet } from './cabinet'

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

describe('planCabinet sorting', () => {
  // One artist: a 2015 reissue of a 1971 album, a 1980 album and an undated one.
  const reissue = { ...fakeRecord({ id: 1, artist: 'The Band', title: 'Zulu', year: 2015 }), originalYear: 1971 }
  const eighties = fakeRecord({ id: 2, artist: 'The Band', title: 'Alpha', year: 1980 })
  const undated = { ...fakeRecord({ id: 3, artist: 'The Band', title: 'Mid', year: 0 }), originalYear: 0 }
  const other = fakeRecord({ id: 4, artist: 'Abba', title: 'Waterloo', year: 1974 })
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
      fakeRecord({ artist: 'A', title: 'a' }),
      fakeRecord({ artist: 'B', title: 'b' }),
      fakeRecord({ artist: 'C', title: 'c' }),
      fakeRecord({ artist: 'D', title: 'd' }),
      fakeRecord({ artist: 'E', title: 'e' }),
      fakeRecord({ artist: 'F', title: 'f' }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([10, 10, 10]) })
    expect(plan.slots.map((slot) => slot.records.length)).toEqual([2, 2, 2])
    expect(plan.conflicts).toEqual([])
    expect(plan.unplaced).toEqual([])
  })

  it('keeps an artist together even when that overshoots the even target', () => {
    const releases = [
      fakeRecord({ id: 1, artist: 'A', title: 'a1', year: 2010 }),
      fakeRecord({ artist: 'A', title: 'a2', year: 2011, id: 2 }),
      fakeRecord({ artist: 'A', title: 'a3', year: 2012, id: 3 }),
      fakeRecord({ artist: 'B', title: 'b1', id: 4 }),
      fakeRecord({ artist: 'B', title: 'b2', id: 5 }),
      fakeRecord({ artist: 'B', title: 'b3', id: 6 }),
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
      fakeRecord({ artist: 'A', title: 'a', formatText: 'Vinyl · 12"' }),
      fakeRecord({ artist: 'B', title: 'b', formatText: 'Vinyl · 12"' }),
      fakeRecord({ artist: 'C', title: 'c', formatText: 'Vinyl · 12"' }),
      fakeRecord({ artist: 'D', title: 'd', formatText: 'Vinyl · 7"' }),
      fakeRecord({ artist: 'E', title: 'e', formatText: 'Vinyl · 7"' }),
      fakeRecord({ artist: 'F', title: 'f', formatText: 'Vinyl · 7"' }),
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
      ...'ABCDEFGHIJK'.split('').map((artist) => fakeRecord({ artist, title: artist, formatText: 'Vinyl · LP' })),
      fakeRecord({ artist: 'L', title: 'L', formatText: 'Vinyl · 7"' }),
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
      fakeRecord({ artist, title: artist.toLowerCase(), formatText: index % 2 ? 'Vinyl · 7"' : 'Vinyl · 12"' }),
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
      fakeRecord({ artist: artist(i), title: 'lp', formatText: 'Vinyl · LP' }),
    )
    const singles = Array.from({ length: 40 }, (_, i) =>
      fakeRecord({ artist: artist(i * 3), title: 'single', formatText: 'Vinyl · 7"' }),
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
      fakeRecord({ artist, title: artist.toLowerCase(), formatText: index % 2 ? 'Vinyl · 7"' : 'Vinyl · 12"' }),
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
      fakeRecord({ artist: 'C', title: 'c', formatText: 'Vinyl · LP' }),
      fakeRecord({ artist: 'B', title: 'b', formatText: 'Vinyl · 10" · EP' }),
      fakeRecord({ artist: 'D', title: 'd-lp', formatText: 'Vinyl · LP' }),
      fakeRecord({ artist: 'D', title: 'd-cd', formatText: 'CD · Album' }),
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
      fakeRecord({ id: 1, artist: 'B', title: 'b1', formatText: 'CD · Album' }),
      fakeRecord({ id: 2, artist: 'B', title: 'b2', formatText: 'CD · Album' }),
      fakeRecord({ id: 3, artist: 'B', title: 'b3', formatText: 'CD · Album' }),
      fakeRecord({ id: 4, artist: 'D', title: 'd1', year: 2001, formatText: 'Vinyl · LP · Gatefold' }),
      fakeRecord({ id: 5, artist: 'D', title: 'd2', year: 2002, formatText: 'Vinyl · 7"' }),
      fakeRecord({ id: 6, artist: 'D', title: 'd3', year: 2003, formatText: 'Vinyl · LP · Gatefold' }),
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
      fakeRecord({ id: 0, artist: 'C', title: 'c', year: 2000, formatText: 'CD · Album' }),
      fakeRecord({ id: 1, artist: 'D', title: 'd1', year: 2001, formatText: 'Vinyl · LP · Gatefold' }),
      fakeRecord({ id: 2, artist: 'A', title: 'a-cd', year: 2002, formatText: 'CD · Album' }),
      fakeRecord({ id: 3, artist: 'D', title: 'd3', year: 2003, formatText: 'Vinyl · LP · Gatefold' }),
      fakeRecord({ id: 4, artist: 'A', title: 'a-lp', year: 2004, formatText: 'Vinyl · LP' }),
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
      fakeRecord({ id: 1, artist: 'A', title: 'a4', formatText: 'Vinyl · LP · Gatefold' }),
      fakeRecord({ id: 2, artist: 'B', title: 'b3', formatText: 'Vinyl · LP' }),
      fakeRecord({ id: 3, artist: 'C', title: 'c1', formatText: 'Vinyl · LP' }),
      fakeRecord({ id: 4, artist: 'C', title: 'c2', formatText: 'Vinyl · LP · Gatefold' }),
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
      fakeRecord({ artist: 'A', title: 'zebra', year: 1970, formatText: 'Vinyl · LP' }),
      fakeRecord({ artist: 'A', title: 'apple', year: 1980, formatText: 'Vinyl · LP' }),
      fakeRecord({ artist: 'B', title: 'b-lp', year: 1990, formatText: 'Vinyl · LP' }),
      fakeRecord({ artist: 'A', title: 'yellow', year: 1971, formatText: 'Vinyl · 7"' }),
      fakeRecord({ artist: 'A', title: 'banana', year: 1985, formatText: 'Vinyl · 7"' }),
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
    const lps = 'ABCDEFGHI'.split('').map((artist) => fakeRecord({ artist, title: artist, formatText: 'Vinyl · LP' }))
    const box = fakeRecord({
      artist: 'E',
      title: 'box',
      formatText: 'Vinyl · LP · Box Set',
      formats: [{ name: 'Vinyl', qty: '12', descriptions: ['LP'] }],
    })
    const singles = ['S', 'T'].map((artist) => fakeRecord({ artist, title: artist, formatText: 'Vinyl · 7"' }))
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
      fakeRecord({ artist: `A${String(i).padStart(2, '0')}`, title: 't', formatText: 'Vinyl · LP' }),
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
      fakeRecord({ id: 0, artist: 'ABBA', title: 'The D', year: 0, formatText: 'CD · Album' }),
      fakeRecord({ id: 1, artist: 'ABBA', title: 'C', year: 1980, formatText: 'Vinyl · LP · Gatefold' }),
      fakeRecord({ id: 2, artist: 'ABBA', title: 'C', year: 0, formatText: 'Vinyl · LP · Gatefold' }),
      fakeRecord({ id: 3, artist: 'ABBA', title: 'B', year: 1980, formatText: 'Vinyl · 10"' }),
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
      fakeRecord({ artist, title: artist, formatText: artist === 'E' ? 'Vinyl · LP · Gatefold' : 'Vinyl · LP' }),
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
    const others = [fakeRecord({ artist: 'Abba', title: 'a' }), fakeRecord({ artist: 'Yes', title: 'y' })]
    const plan = planCabinet({ releases: [...others, display], cabinet: cabinetWith([10]) })
    const filed = plan.slots[0].records.map((record) => record.display.artistName)
    expect(filed).toEqual(['Abba', 'Yes', 'Zappa'])
    expect(Object.keys(plan.placements)).toHaveLength(3)
  })

  it('reports nothing out of order when every record follows the order', () => {
    const releases = 'ABCDEF'.split('').map((artist) => fakeRecord({ artist, title: artist }))
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
      fakeRecord({ artist: 'A', title: 'a', formatText: 'Vinyl · 12"' }),
      fakeRecord({ artist: 'B', title: 'b', formatText: 'Vinyl · 7"' }),
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
    const releases = [fakeRecord({ artist: 'A', title: 'a' })]
    const plan = planCabinet({ releases, cabinet: { id: 'c', name: 'C', slots: [] } })
    expect(plan.unplaced).toHaveLength(1)
    expect(plan.conflicts).toEqual([{ type: 'unplaced', count: 1 }])
  })

  it('reports records that do not fit as unplaced', () => {
    const releases = [1, 2, 3, 4, 5].map((id) =>
      fakeRecord({ artist: `Artist ${id}`, title: `t${id}`, id }),
    )
    const plan = planCabinet({ releases, cabinet: cabinetWith([3]) })
    expect(plan.slots[0].records).toHaveLength(3)
    expect(plan.unplaced).toHaveLength(2)
    expect(plan.conflicts).toContainEqual({ type: 'unplaced', count: 2 })
  })

  it('fills every shelf before reporting records as unplaced', () => {
    const releases = Array.from({ length: 391 }, (_, index) =>
      fakeRecord({ id: index + 1, artist: `Artist ${String(index).padStart(3, '0')}`, title: `t${index}` }),
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
      fakeRecord({ id: 1, artist: 'A', title: 'a12', formatText: 'Vinyl · 12"' }),
      fakeRecord({ id: 2, artist: 'A', title: 'a7', formatText: 'Vinyl · 7"' }),
      fakeRecord({ id: 3, artist: 'B', title: 'b12', formatText: 'Vinyl · 12"' }),
      fakeRecord({ id: 4, artist: 'B', title: 'b7', formatText: 'Vinyl · 7"' }),
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
      fakeRecord({ id: 1, artist: 'A', title: 'a', formatText: 'Vinyl · 7"' }),
      fakeRecord({ id: 2, artist: 'B', title: 'b', formatText: 'Vinyl · 12"' }),
      fakeRecord({ id: 3, artist: 'C', title: 'c', formatText: 'Vinyl · 12"' }),
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
      fakeRecord({ id: 1, artist: 'B', title: 'b12', formatText: 'Vinyl · 12"' }),
      fakeRecord({ id: 2, artist: 'A', title: 'a7', formatText: 'Vinyl · 7"' }),
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
      fakeRecord({ id: 1, artist: 'A', title: 'a', formatText: 'Vinyl · 12"' }),
      fakeRecord({ id: 2, artist: 'B', title: 'b', formatText: 'Vinyl · 12"' }),
      fakeRecord({ id: 3, artist: 'C', title: 'c', formatText: 'Vinyl · 12"' }),
      ...[4, 5, 6, 7, 8, 9, 10, 11].map((id) =>
        fakeRecord({ id, artist: `S${id}`, title: `s${id}`, formatText: 'Vinyl · 7"' }),
      ),
      ...[12, 13, 14, 15].map((id) =>
        fakeRecord({ id, artist: `O${id}`, title: `o${id}`, formatText: 'CD · Album' }),
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
      fakeRecord({ artist: 'A', title: 'a1', id: 1 }),
      fakeRecord({ artist: 'A', title: 'a2', id: 2 }),
      fakeRecord({ artist: 'A', title: 'a3', id: 3 }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([2, 2]) })
    expect(plan.slots.map((slot) => slot.records.length)).toEqual([2, 1])
    expect(plan.conflicts).toContainEqual({ type: 'artist-split', artist: 'A' })
  })

  it('does not call an artist split when only the kept-apart sizes divide them', () => {
    const releases = [
      fakeRecord({ artist: 'A', title: 'lp1', formatText: 'Vinyl · 12"' }),
      fakeRecord({ artist: 'A', title: 'lp2', formatText: 'Vinyl · 12"' }),
      fakeRecord({ artist: 'A', title: 'single', formatText: 'Vinyl · 7"' }),
      fakeRecord({ artist: 'B', title: 'b', formatText: 'Vinyl · 7"' }),
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
      fakeRecord({ artist: 'A', title: 'lp1', formatText: 'Vinyl · 12"' }),
      fakeRecord({ artist: 'A', title: 'lp2', formatText: 'Vinyl · 12"' }),
      fakeRecord({ artist: 'A', title: 'lp3', formatText: 'Vinyl · 12"' }),
      fakeRecord({ artist: 'A', title: 'single', formatText: 'Vinyl · 7"' }),
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
    const releases = [1, 2, 3].map((id) => fakeRecord({ artist: 'A', title: `a${id}`, id, formatText: 'Vinyl · LP' }))
    const cabinet = cabinetWith([3])
    expect(planCabinet({ releases, cabinet }).unplaced).toEqual([])
    const plan = planCabinet({ releases, cabinet, sleeves: { notes: { '1': 'Gatefold sleeve.' } } })
    expect(plan.slots[0].used).toBe(3)
    expect(plan.unplaced).toHaveLength(1)
  })

  it('counts a gatefold as two spaces against shelf capacity', () => {
    const releases = [
      fakeRecord({ id: 1, artist: 'A', title: 'gatefold', formatText: 'Vinyl · 12" · Gatefold' }),
      fakeRecord({ id: 2, artist: 'B', title: 'normal' }),
      fakeRecord({ id: 3, artist: 'C', title: 'overflow' }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([3]) })
    expect(plan.slots[0].used).toBe(3)
    expect(plan.slots[0].records).toHaveLength(2)
    expect(plan.unplaced).toEqual([releases[2]])
  })

  it('leaves a gatefold unplaced when no shelf has room for both spaces', () => {
    const releases = [
      fakeRecord({ id: 1, artist: 'A', title: 'gatefold', formatText: 'Vinyl · 12" · Gatefold' }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([1, 1]) })
    expect(plan.unplaced).toEqual([releases[0]])
  })

  it('leaves the caller collection untouched', () => {
    const releases = [
      fakeRecord({ artist: 'B', title: 'b', id: 1 }),
      fakeRecord({ artist: 'A', title: 'a', id: 2 }),
    ]
    const before = [...releases]
    planCabinet({ releases, cabinet: cabinetWith([5, 5]) })
    expect(releases).toEqual(before)
  })

  it('orders slot contents by the selected mode', () => {
    const releases = [
      fakeRecord({ artist: 'A', title: 'Zebra', id: 1 }),
      fakeRecord({ artist: 'A', title: 'Apple', id: 2 }),
    ]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([5, 5]),
      options: { sort: 'byName', separateSizeClasses: true },
    })
    expect(keysIn(plan.slots[0].records)).toEqual(['2-2', '1-1'])
  })
})
