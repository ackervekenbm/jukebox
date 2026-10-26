// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import type { DiscogsCollectionRelease } from '../types/discogs'
import type { DisplayRelease } from './collection'
import { makeSortKey } from './sortName'
import { planCabinet, sizeClassOf, spaceUnitsOf } from './cabinet'

interface FakeInput {
  artist: string
  title: string
  id?: number
  year?: number
  formatText?: string
}

let counter = 0

function fake(input: FakeInput): DisplayRelease {
  const id = input.id ?? ++counter
  const year = input.year ?? 2020
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
    formatNames: ['Vinyl'],
    formatText: input.formatText ?? 'Vinyl · 12" · LP',
    coverImage: '',
    thumb: '',
    release: {} as DiscogsCollectionRelease,
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

  it('falls back to other when no size is stated', () => {
    expect(sizeClassOf(fake({ artist: 'A', title: 'T', formatText: 'CD · Album' }))).toBe('other')
    expect(sizeClassOf(fake({ artist: 'A', title: 'T', formatText: 'Vinyl · LP' }))).toBe('other')
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
      options: { sort: 'artist', separateSizeClasses: true },
    })
    expect(plan.slots[0].sizeClass).toBe('12-inch')
    expect(plan.slots[1].sizeClass).toBe('small')
    expect(plan.conflicts).toEqual([])
  })

  it('flags a slot that has to mix size classes', () => {
    const releases = [
      fake({ artist: 'A', title: 'a', formatText: 'Vinyl · 12"' }),
      fake({ artist: 'B', title: 'b', formatText: 'Vinyl · 7"' }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([10]) })
    expect(plan.slots[0].sizeClass).toBe('mixed')
    expect(plan.conflicts).toEqual([{ type: 'size-mix', slotId: 'slot-1' }])
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
      options: { sort: 'artist', separateSizeClasses: true },
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
      options: { sort: 'artist', separateSizeClasses: true },
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
      options: { sort: 'artist', separateSizeClasses: true },
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
      options: { sort: 'title', separateSizeClasses: true },
    })
    expect(keysIn(plan.slots[0].records)).toEqual(['2-2', '1-1'])
  })
})
