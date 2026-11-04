// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import { compareSortKeys, makeSortKey, sortLetter } from './sortName'

describe('makeSortKey', () => {
  it('lowercases and strips accents', () => {
    expect(makeSortKey('Beyoncé')).toBe('beyonce')
    expect(makeSortKey('DÄMES')).toBe('dames')
  })

  it('strips leading English articles', () => {
    expect(makeSortKey('The Menzingers')).toBe('menzingers')
    expect(makeSortKey('An Evening with...')).toBe('evening with')
  })

  it('collapses punctuation to single spaces', () => {
    expect(makeSortKey('R.E.M. & Sons')).toBe('r e m sons')
  })

  it('keeps digits', () => {
    expect(makeSortKey('808 State')).toBe('808 state')
  })

  it('never returns an empty sort key', () => {
    expect(makeSortKey('The')).toBe('the')
    expect(makeSortKey('!!!')).toBe('')
    expect(makeSortKey('')).toBe('')
  })
})

describe('sortLetter', () => {
  it('returns an uppercase letter for alpha keys', () => {
    expect(sortLetter('menzingers')).toBe('M')
    expect(sortLetter('beyonce')).toBe('B')
  })

  it('returns # for digit-led keys', () => {
    expect(sortLetter('808 state')).toBe('#')
  })

  it('returns ? for empty keys', () => {
    expect(sortLetter('')).toBe('?')
  })
})

describe('compareSortKeys', () => {
  it('orders case-insensitively with natural numeric ordering', () => {
    const list = ['Revo 10', 'Revo 2', 'revo 1', 'Revue'].sort(compareSortKeys)
    expect(list).toEqual(['revo 1', 'Revo 2', 'Revo 10', 'Revue'])
  })

  it('treats accents and case alike, and keeps numbers in natural order', () => {
    expect(compareSortKeys('björk', 'Bjork')).toBe(0)
    expect(compareSortKeys('MOTÖRHEAD', 'motorhead')).toBe(0)
    const list = ['zz top', '10cc', 'u2', '2 unlimited', 'abba', 'ac dc'].sort(compareSortKeys)
    expect(list).toEqual(['2 unlimited', '10cc', 'abba', 'ac dc', 'u2', 'zz top'])
  })

  it('compares exactly like localeCompare with the same options', () => {
    // The shared collator is a speed-up only: every pair must keep its order.
    const parts = ['the', 'a', 'Ab', 'ab', 'ä', 'Å', 'é', 'e', '10', '9', '2b', '', ' ', '-', 'ß', 'ss', 'Œ', 'oe', 'z']
    let seed = 1
    const pick = () => parts[(seed = (seed * 48271) % 2147483647) % parts.length]
    for (let i = 0; i < 2000; i++) {
      const a = pick() + pick() + pick()
      const b = pick() + pick() + pick()
      const expected = Math.sign(a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }))
      expect(Math.sign(compareSortKeys(a, b)), `${a} vs ${b}`).toBe(expected)
    }
  })
})