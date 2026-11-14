// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import { fakeRecord } from '../test/factories'
import {
  discCountOf,
  isGatefold,
  isUserCall,
  mentionsGatefold,
  needsNotesCheck,
  sizeClassOf,
  sleeveSource,
  spaceUnitsOf,
} from './physical'

describe('sizeClassOf', () => {
  it('reads the size from the format text', () => {
    expect(sizeClassOf(fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · 12" · LP' }))).toBe(
      '12-inch',
    )
    expect(sizeClassOf(fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · 7" · Single' }))).toBe(
      'small',
    )
    expect(sizeClassOf(fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · 10" · EP' }))).toBe(
      'small',
    )
  })

  it('counts vinyl without a stated size as 12 inch', () => {
    expect(sizeClassOf(fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · LP · Album' }))).toBe(
      '12-inch',
    )
    expect(sizeClassOf(fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · Single' }))).toBe(
      '12-inch',
    )
  })

  it('only files records as small when a smaller size is stated', () => {
    expect(sizeClassOf(fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · 7" · 45 RPM' }))).toBe(
      'small',
    )
    expect(
      sizeClassOf({ ...fakeRecord({ artist: 'A', title: 'T', formatText: 'Shellac · 10"' }), formatNames: ['Shellac'] }),
    ).toBe('small')
  })

  it('keeps formats that are not vinyl apart as other', () => {
    const cd = { ...fakeRecord({ artist: 'A', title: 'T', formatText: 'CD · Album' }), formatNames: ['CD'] }
    const tape = { ...fakeRecord({ artist: 'A', title: 'T', formatText: 'Cassette · Album' }), formatNames: ['Cassette'] }
    expect(sizeClassOf(cd)).toBe('other')
    expect(sizeClassOf(tape)).toBe('other')
  })

  it('treats a box set with vinyl inside as vinyl', () => {
    const box = {
      ...fakeRecord({ artist: 'A', title: 'T', formatText: 'Box Set / Vinyl · LP' }),
      formatNames: ['Box Set', 'Vinyl'],
    }
    expect(sizeClassOf(box)).toBe('12-inch')
  })

  it('uses the largest vinyl size in a set, counting an unsized LP as 12 inch', () => {
    const set = (formatText: string) =>
      sizeClassOf({ ...fakeRecord({ artist: 'A', title: 'T', formatText }), formatNames: ['Box Set', 'Vinyl'] })
    expect(set('Box Set · Compilation / Vinyl · 12" / Vinyl · 7"')).toBe('12-inch')
    // Discogs leaves the LP's size off; only the bonus single states one.
    expect(set('Vinyl · LP · Album / Vinyl · 7" · Single')).toBe('12-inch')
    expect(set('Box Set / Vinyl · 7" / Vinyl · 7"')).toBe('small')
  })

  it('reads sizes from vinyl formats only', () => {
    const of = (formatText: string, name: string) =>
      sizeClassOf({ ...fakeRecord({ artist: 'A', title: 'T', formatText }), formatNames: [name] })
    expect(of('CD · 3" · Mini', 'CD')).toBe('other')
    expect(of('Reel-To-Reel · 7" · 7 ½ ips', 'Reel-To-Reel')).toBe('other')
    expect(of('Floppy Disk · 3.5"', 'Floppy Disk')).toBe('other')
    // A CD packaged with a 7" is filed by the 7".
    expect(
      sizeClassOf({
        ...fakeRecord({ artist: 'A', title: 'T', formatText: 'CD · Album / Vinyl · 7"' }),
        formatNames: ['CD', 'Vinyl'],
      }),
    ).toBe('small')
  })
})

describe('spaceUnitsOf', () => {
  it('counts a gatefold sleeve as two spaces', () => {
    expect(spaceUnitsOf(fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · 12" · LP · Gatefold' }))).toBe(2)
  })

  it('counts a standard sleeve as one space', () => {
    expect(spaceUnitsOf(fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · 12" · LP' }))).toBe(1)
  })

  it('finds a gatefold in a format\'s free text', () => {
    const record = fakeRecord({
      artist: 'A',
      title: 'T',
      formatText: 'Vinyl · LP · Album',
      formats: [{ name: 'Vinyl', qty: '1', text: '180g, Gatefold', descriptions: ['LP', 'Album'] }],
    })
    expect(spaceUnitsOf(record)).toBe(2)
  })

  it('counts a gatefold the release notes describe', () => {
    // Blink-182 – Enema Of The State (9160941): only the notes say gatefold.
    const record = fakeRecord({ artist: 'blink-182', title: 'Enema Of The State', id: 9160941, formatText: 'Vinyl · LP · Album · Reissue · Stereo' })
    expect(spaceUnitsOf(record)).toBe(1)
    const notes = '180 Gram Heavyweight Vinyl\nGatefold sleeve.\nMade in the EU.'
    expect(spaceUnitsOf(record, { notes: { '9160941': notes } })).toBe(2)
    expect(spaceUnitsOf(record, { notes: { '9160941': 'Printed inner sleeve.' } })).toBe(1)
    expect(spaceUnitsOf(record, { notes: { '9160941': '' } })).toBe(1)
  })

  it('ignores gatefold text on a format that is not vinyl', () => {
    // A CD's gatefold card sleeve doesn't make the LP in the same set thicker.
    const set = fakeRecord({
      artist: 'A',
      title: 'T',
      formatText: 'Vinyl · LP / CD · Album · Gatefold',
      formats: [
        { name: 'Vinyl', qty: '1', descriptions: ['LP'] },
        { name: 'CD', qty: '1', text: 'Gatefold digisleeve', descriptions: ['Album', 'Gatefold'] },
      ],
    })
    expect(spaceUnitsOf(set)).toBe(1)
    const cd = fakeRecord({
      artist: 'A',
      title: 'T',
      formatText: 'CD · Album',
      formats: [{ name: 'CD', qty: '1', text: 'Gatefold Cardboard Sleeve' }],
    })
    expect(isGatefold(cd)).toBe(false)
  })

  it('lets the user\'s call win both ways', () => {
    const plain = fakeRecord({ artist: 'A', title: 'T', id: 1, formatText: 'Vinyl · LP' })
    const folded = fakeRecord({ artist: 'A', title: 'U', id: 2, formatText: 'Vinyl · LP · Gatefold' })
    expect(spaceUnitsOf(plain, { overrides: { '1': true } })).toBe(2)
    expect(spaceUnitsOf(folded, { overrides: { '2': false } })).toBe(1)
    expect(isGatefold(folded, { notes: { '2': 'Gatefold' }, overrides: { '2': false } })).toBe(false)
  })

  it('treats only a call that disagrees with Discogs as the user\'s', () => {
    const lp = fakeRecord({ artist: 'A', title: 'T', id: 1, formatText: 'Vinyl · LP' })
    expect(isUserCall(lp, { overrides: { '1': true } })).toBe(true)
    // Marked as gatefold before the notes said so: it now agrees, so it's Discogs' call.
    expect(isUserCall(lp, { notes: { '1': 'Gatefold sleeve' }, overrides: { '1': true } })).toBe(false)
    expect(isUserCall(lp)).toBe(false)
  })

  it('says where the sleeve call comes from', () => {
    const lp = fakeRecord({ artist: 'A', title: 'T', id: 1, formatText: 'Vinyl · LP' })
    expect(sleeveSource(lp)).toMatch(/^Standard sleeve\. Press/)
    expect(sleeveSource(lp, { notes: { '1': 'Gatefold sleeve' } })).toMatch(/according to Discogs/)
    expect(sleeveSource(lp, { overrides: { '1': true } })).toMatch(/^Gatefold, marked by you/)
  })

  it('gives a multi-disc set one space per disc, gatefold or not', () => {
    const lps = (qty: string, descriptions: string[] = ['LP']) =>
      fakeRecord({
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
    const bonus = fakeRecord({
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
    const double7 = fakeRecord({
      artist: 'A',
      title: 'T',
      formatText: 'Vinyl · 7"',
      formats: [{ name: 'Vinyl', qty: '2', descriptions: ['7"'] }],
    })
    expect(discCountOf(double7)).toBe(2)
  })

  it('counts vinyl discs only in a mixed set', () => {
    const record = fakeRecord({
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
    const lp = fakeRecord({ artist: 'A', title: 'T', id: 1, formatText: 'Vinyl · LP' })
    expect(needsNotesCheck(lp)).toBe(true)
    expect(needsNotesCheck(lp, { notes: { '1': '' } })).toBe(false)
    // The user already decided; the notes can't change that.
    expect(needsNotesCheck(lp, { overrides: { '1': false } })).toBe(false)
    expect(needsNotesCheck(fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · LP · Gatefold' }))).toBe(false)
    expect(needsNotesCheck(fakeRecord({ artist: 'A', title: 'T', formatText: 'CD · Album' }))).toBe(false)
    expect(
      needsNotesCheck(
        fakeRecord({ artist: 'A', title: 'T', formatText: 'Vinyl · LP', formats: [{ name: 'Vinyl', qty: '2' }] }),
      ),
    ).toBe(false)
  })
})
