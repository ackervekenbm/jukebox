// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StackCard } from './StackCard'
import { artist, release } from '../test/factories'
import { groupPressings, stackCountLabel, toDisplayRelease } from '../utils/collection'
import type { DiscogsCollectionRelease } from '../types/discogs'

const basic = release().basic_information

const display = (over: Partial<DiscogsCollectionRelease> = {}) =>
  toDisplayRelease(release(over))

function groupOf(...pressings: DiscogsCollectionRelease[]) {
  const [group] = groupPressings(pressings.map((p) => display(p)))
  return group
}

describe('StackCard', () => {
  const us = release({
    id: 1,
    instance_id: 1,
    basic_information: {
      ...basic,
      master_id: 11,
      title: 'Moving Pictures',
      year: 1981,
      country: 'US',
      artists: [artist({ name: 'Rush' })],
      formats: [{ name: 'LP', qty: '1', descriptions: ['Album'] }],
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
      artists: [artist({ name: 'Rush' })],
      formats: [{ name: 'LP', qty: '1', descriptions: ['Album'] }],
    },
  })

  it('shows the earliest pressing as the face of the stack', () => {
    render(<StackCard group={groupOf(us, uk)} onOpen={vi.fn()} />)

    expect(screen.getByText('Moving Pictures')).toBeInTheDocument()
    expect(screen.getByText('1981')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Rush — Moving Pictures' }),
    ).toBeInTheDocument()
  })

  it('badges the stack with its pressing count', () => {
    render(<StackCard group={groupOf(us, uk)} onOpen={vi.fn()} />)

    const card = screen.getByRole('button', { name: 'Rush — Moving Pictures, 2 pressings' })
    expect(card).toBeInTheDocument()
    expect(screen.getByText('2 pressings')).toBeInTheDocument()
  })

  it('badges a stack of three or more pressings', () => {
    const third = release({
      id: 3,
      instance_id: 3,
      basic_information: { ...basic, master_id: 11, title: 'Moving Pictures', year: 1985 },
    })
    render(<StackCard group={groupOf(us, uk, third)} onOpen={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'Rush — Moving Pictures, 3 pressings' }),
    ).toBeInTheDocument()
    expect(screen.getByText('3 pressings')).toBeInTheDocument()
  })

  it('badges duplicate copies of one pressing instead of counting rows', () => {
    const copyA = release({
      id: 5,
      instance_id: 5,
      basic_information: { ...basic, master_id: 0, title: 'Headhunters', year: 1973 },
    })
    const copyB = release({
      id: 5,
      instance_id: 6,
      basic_information: { ...basic, master_id: 0, title: 'Headhunters', year: 1973 },
    })

    const group = groupOf(copyA, copyB)
    render(<StackCard group={group} onOpen={vi.fn()} />)

    expect(screen.getByText('2 copies')).toBeInTheDocument()
    expect(stackCountLabel(group)).toBe('2 copies')
  })

  it('opens the whole stack when the face is clicked', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const group = groupOf(us, uk)
    render(<StackCard group={group} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: /Moving Pictures/ }))
    expect(onOpen).toHaveBeenCalledWith(group)
  })

  it('opens the stack with the keyboard', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<StackCard group={groupOf(us, uk)} onOpen={onOpen} />)

    await user.tab()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('has no badge for a lone pressing', () => {
    const group = groupOf(us)
    render(<StackCard group={group} onOpen={vi.fn()} />)

    expect(stackCountLabel(group)).toBe('')
    expect(screen.queryByText(/pressings|copies/)).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Rush — Moving Pictures' }),
    ).toBeInTheDocument()
  })
})
