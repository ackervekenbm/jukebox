// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import type { DiscogsCollectionRelease } from '../types/discogs'
import type { DisplayRelease } from './collection'
import { makeSortKey } from './sortName'
import { planCabinet, sizeClassOf } from './cabinet'

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
    const plan = planCabinet({ releases, cabinet: cabinetWith([10, 10]) })
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

  it('moves an overridden record and reports the slot it overfills', () => {
    const releases = [
      fake({ artist: 'A', title: 'a', id: 1 }),
      fake({ artist: 'B', title: 'b', id: 2 }),
      fake({ artist: 'C', title: 'c', id: 3 }),
      fake({ artist: 'D', title: 'd', id: 4 }),
    ]
    const cabinet = cabinetWith([2, 2])
    const plan = planCabinet({
      releases,
      cabinet,
      overrides: { '1-1': 'slot-2' },
    })
    expect(plan.placements['1-1']).toBe('slot-2')
    const target = plan.slots[1]
    expect(target.overCapacity).toBe(1)
    expect(target.records.find((record) => record.key === '1-1')?.overridden).toBe(true)
    expect(plan.conflicts).toContainEqual({ type: 'over-capacity', slotId: 'slot-2', count: 1 })
  })

  it('reports an artist split across slots', () => {
    const releases = [
      fake({ artist: 'A', title: 'a1', id: 1 }),
      fake({ artist: 'A', title: 'a2', id: 2 }),
      fake({ artist: 'B', title: 'b1', id: 3 }),
    ]
    const plan = planCabinet({ releases, cabinet: cabinetWith([2, 2]), overrides: { '1-1': 'slot-2' } })
    expect(plan.conflicts).toContainEqual({ type: 'artist-split', artist: 'A' })
  })

  it('reports overrides whose record or slot is gone', () => {
    const releases = [fake({ artist: 'A', title: 'a', id: 1 })]
    const plan = planCabinet({
      releases,
      cabinet: cabinetWith([5]),
      overrides: { 'ghost-9': 'slot-1', '1-1': 'slot-missing' },
    })
    expect(plan.staleOverrides).toEqual(['ghost-9', '1-1'])
    expect(plan.placements['1-1']).toBe('slot-1')
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
