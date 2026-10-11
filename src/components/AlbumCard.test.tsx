// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlbumCard } from './AlbumCard'
import { groupPressings, toDisplayRelease } from '../utils/collection'
import { release } from '../test/factories'
import type { DiscogsCollectionRelease } from '../types/discogs'

const basic = release().basic_information

function group(releases: DiscogsCollectionRelease[]) {
  return groupPressings(releases.map((r) => toDisplayRelease(r)))[0]
}

const us = release({
  id: 1,
  instance_id: 1,
  basic_information: {
    ...basic,
    master_id: 11,
    title: 'Moving Pictures',
    year: 1981,
    country: 'US',
    labels: [{ name: 'Moon', catno: 'M-1', id: 1, resource_url: '' }],
  },
})
const uk = release({
  id: 2,
  instance_id: 2,
  basic_information: {
    ...basic,
    master_id: 11,
    title: 'Moving Pictures',
    year: 1983,
    country: 'UK',
    formats: [{ name: 'LP', qty: '1', descriptions: ['Album', 'Reissue'] }],
    labels: [{ name: 'Moon', catno: 'M-2', id: 1, resource_url: '' }],
  },
})
const japan = release({
  id: 3,
  instance_id: 3,
  basic_information: {
    ...basic,
    master_id: 11,
    title: 'Moving Pictures',
    year: 1979,
    country: 'Japan',
    labels: [{ name: 'Moon', catno: 'M-3', id: 1, resource_url: '' }],
  },
})

describe('AlbumCard', () => {
  it('badges the card with its pressing count', () => {
    render(<AlbumCard group={group([us, uk, japan])} onOpen={vi.fn()} />)
    expect(screen.getByText('3 pressings')).toBeInTheDocument()
    // The primary is the earliest pressing, shown as the card face.
    expect(screen.getByRole('button', { name: 'Test Artist — Moving Pictures' })).toBeInTheDocument()
    expect(screen.getAllByText('1979').length).toBeGreaterThan(0)
  })

  it('lists every pressing with year, country, format and label', () => {
    render(<AlbumCard group={group([us, uk, japan])} onOpen={vi.fn()} />)

    const rows = screen.getAllByRole('button').filter((el) => el.classList.contains('pressing-row'))
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Open Moving Pictures — 1979 · Japan · LP · Moon',
      'Open Moving Pictures — 1981 · US · LP · Moon',
      'Open Moving Pictures — 1983 · UK · LP · Moon',
    ])
  })

  it('opens the primary pressing from the card body', () => {
    const onOpen = vi.fn()
    render(<AlbumCard group={group([us, uk, japan])} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Test Artist — Moving Pictures' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0].id).toBe(3)
  })

  it('opens the exact pressing from its row', () => {
    const onOpen = vi.fn()
    render(<AlbumCard group={group([us, uk, japan])} onOpen={onOpen} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Moving Pictures — 1981 · US · LP · Moon' }),
    )
    expect(onOpen.mock.calls[0][0].id).toBe(1)
  })

  it('shows no badge and no rows for a lone pressing', () => {
    render(<AlbumCard group={group([us])} onOpen={vi.fn()} />)
    expect(screen.queryByText(/pressing/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Open Moving Pictures/ })).toBeNull()
  })

  it('badges two copies of one pressing instead of listing it twice', () => {
    const copy = release({ ...us, instance_id: 9 })
    render(<AlbumCard group={group([us, copy])} onOpen={vi.fn()} />)
    expect(screen.getByText('2 copies')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Moving Pictures/ })).toBeNull()
  })

  it('counts a shared row twice on the copies chip', () => {
    const copy = release({ ...us, instance_id: 9 })
    const withCopy = group([us, copy, uk])
    render(<AlbumCard group={withCopy} onOpen={vi.fn()} />)

    const rows = screen.getAllByRole('button').filter((el) => el.classList.contains('pressing-row'))
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('×2 copies')).toBeInTheDocument()
    expect(within(rows[1]).queryByText(/copies/)).toBeNull()
  })

  it('collapses long pressing lists behind a "+N more" toggle', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 8 }, (_, index) =>
      release({
        id: 100 + index,
        instance_id: index,
        basic_information: {
          ...basic,
          master_id: 11,
          title: 'Moving Pictures',
          year: 1980 + index,
          country: 'US',
        },
      }),
    )
    render(<AlbumCard group={group(many)} onOpen={vi.fn()} />)

    expect(screen.getAllByRole('button').filter((el) => el.classList.contains('pressing-row'))).toHaveLength(6)
    const more = screen.getByRole('button', { name: '+2 more' })
    expect(more).toHaveAttribute('aria-expanded', 'false')

    await user.click(more)
    expect(screen.getAllByRole('button').filter((el) => el.classList.contains('pressing-row'))).toHaveLength(8)
    expect(screen.getByRole('button', { name: 'Show fewer pressings' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('opens the primary pressing with the keyboard', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<AlbumCard group={group([us, uk, japan])} onOpen={onOpen} />)

    screen.getByRole('button', { name: 'Test Artist — Moving Pictures' }).focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
