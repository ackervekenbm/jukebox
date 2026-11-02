// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import type { DiscogsCollectionRelease, DiscogsFormat } from '../types/discogs'
import { compareReleases, type DisplayRelease } from './collection'
import { makeSortKey } from './sortName'
import {
  conflictLabel,
  discCountOf,
  isGatefold,
  needsNotesCheck,
  notesSayGatefold,
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

  it('uses the largest stated size in a multi-disc set', () => {
    expect(
      sizeClassOf(fake({ artist: 'A', title: 'T', formatText: 'Box Set · 12" / 7"' })),
    ).toBe('12-inch')
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
    expect(spaceUnitsOf(record, { notes: { '9160941': true } })).toBe(2)
    expect(spaceUnitsOf(record, { notes: { '9160941': false } })).toBe(1)
  })

  it('lets the user\'s call win both ways', () => {
    const plain = fake({ artist: 'A', title: 'T', id: 1, formatText: 'Vinyl · LP' })
    const folded = fake({ artist: 'A', title: 'U', id: 2, formatText: 'Vinyl · LP · Gatefold' })
    expect(spaceUnitsOf(plain, { overrides: { '1': true } })).toBe(2)
    expect(spaceUnitsOf(folded, { overrides: { '2': false } })).toBe(1)
    expect(isGatefold(folded, { notes: { '2': true }, overrides: { '2': false } })).toBe(false)
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

describe('notesSayGatefold', () => {
  it('recognises the ways notes write it', () => {
    expect(notesSayGatefold('180 Gram Heavyweight Vinyl\nGatefold sleeve.')).toBe(true)
    expect(notesSayGatefold('Comes in a gate-fold cover')).toBe(true)
    expect(notesSayGatefold('Gate fold jacket with lyrics')).toBe(true)
    expect(notesSayGatefold('Printed inner sleeve. Includes a download voucher.')).toBe(false)
    expect(notesSayGatefold(undefined)).toBe(false)
  })
})

describe('needsNotesCheck', () => {
  it('only asks about single vinyl LPs that are not known yet', () => {
    const lp = fake({ artist: 'A', title: 'T', id: 1, formatText: 'Vinyl · LP' })
    expect(needsNotesCheck(lp)).toBe(true)
    expect(needsNotesCheck(lp, { notes: { '1': false } })).toBe(false)
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

  it('flags shelves that have to mix sizes, once for the whole cabinet', () => {
    // Six records alternating 12" and 7" on shelves of 3, 2 and 1: the sizes
    // can't be kept apart, and two shelves end up mixed.
    const releases = ['A', 'B', 'C', 'D', 'E', 'F'].map((artist, index) =>
      fake({ artist, title: artist.toLowerCase(), formatText: index % 2 ? 'Vinyl · 7"' : 'Vinyl · 12"' }),
    )
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([3, 2, 1]),
      options: { sort: 'chronological', separateSizeClasses: true },
    })
    expect(plan.slots.map((slot) => slot.sizeClass)).toEqual(['mixed', 'mixed', 'small'])
    const sizeMix = plan.conflicts.filter((conflict) => conflict.type === 'size-mix')
    expect(sizeMix).toEqual([{ type: 'size-mix', count: 2 }])
    expect(conflictLabel(sizeMix[0])).toBe('Mixed record sizes on 2 shelves')
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
    expect(plan.slots[0].records).toHaveLength(5)
    expect(plan.slots[1].records).toHaveLength(10)
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
    const plan = planCabinet({ releases, cabinet, sleeves: { notes: { '1': true } } })
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
