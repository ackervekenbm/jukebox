// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecentList } from './RecentList'
import { groupByDateAdded, toDisplayRelease } from '../utils/collection'
import { release } from '../test/factories'

const display = (over: Parameters<typeof release>[0] = {}) => toDisplayRelease(release(over))
const monthLabel = (year: number, month: number) =>
  new Date(year, month - 1, 15).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

const sections = groupByDateAdded([
  display({
    id: 1,
    date_added: new Date(2024, 4, 15, 12).toISOString(),
    basic_information: { ...release().basic_information, title: 'May pickup' },
  }),
  display({
    id: 2,
    date_added: new Date(2024, 3, 2, 12).toISOString(),
    basic_information: { ...release().basic_information, title: 'April pickup' },
  }),
  display({
    id: 3,
    date_added: '',
    basic_information: { ...release().basic_information, title: 'Lost the receipt' },
  }),
])

describe('RecentList', () => {
  it('renders one heading per month, newest first, with counts', () => {
    render(<RecentList sections={sections} onSelectRelease={vi.fn()} />)

    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map((heading) => heading.textContent)).toEqual([
      monthLabel(2024, 5),
      monthLabel(2024, 4),
      'Undated',
    ])
    expect(screen.getAllByText('1 release')).toHaveLength(3)
  })

  it('lists cards newest-first and credits the artist on each', () => {
    render(<RecentList sections={sections} onSelectRelease={vi.fn()} />)

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'May pickup',
      'April pickup',
      'Lost the receipt',
    ])
    expect(screen.getAllByText('Test Artist')).toHaveLength(3)
  })

  it('opens the picked release', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<RecentList sections={sections} onSelectRelease={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Test Artist — April pickup' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].id).toBe(2)
  })

  it('keeps each card inside its own month section', () => {
    render(<RecentList sections={sections} onSelectRelease={vi.fn()} />)

    const months = document.querySelectorAll<HTMLElement>('.recent-month')
    expect(months).toHaveLength(3)
    expect(within(months[1]).getByText('April pickup')).toBeInTheDocument()
    expect(within(months[1]).queryByText('May pickup')).toBeNull()
  })
})
