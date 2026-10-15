// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { DiscogsCollectionRelease } from '../types/discogs'
import type { DisplayRelease } from '../utils/collection'
import { makeSortKey } from '../utils/sortName'
import { planCabinet } from '../utils/cabinet'
import type { Cabinet } from '../shared/cabinetDoc'
import { CabinetScreen } from './CabinetScreen'

const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('../hooks/useCabinet', () => ({
  useCabinet: () => mock.state,
}))

let nextId = 0

function release(artist: string, title: string): DisplayRelease {
  const id = ++nextId
  return {
    key: `${id}-${id}`,
    instanceId: id,
    id,
    title,
    titleKey: makeSortKey(title),
    year: 2001,
    originalYear: 2001,
    artistName: artist,
    genres: [],
    styles: [],
    labels: [],
    country: '',
    formatNames: ['Vinyl'],
    formatText: 'Vinyl · 12" · LP',
    coverImage: '',
    thumb: '',
    release: {} as DiscogsCollectionRelease,
    dateAdded: '2024-01-01T00:00:00-00:00',
  }
}

const releases = [release('Alpha', 'First'), release('Beta', 'Second')]

function cabinetOf(capacities: number[]): Cabinet {
  return {
    id: 'main',
    name: 'Cabinet',
    slots: capacities.map((capacity, index) => ({
      id: `slot-${index + 1}`,
      label: `Shelf ${index + 1}`,
      capacity,
    })),
  }
}

const actions = {
  setName: vi.fn(),
  addSlot: vi.fn(),
  updateSlot: vi.fn(),
  removeSlot: vi.fn(),
  assign: vi.fn(),
  unassign: vi.fn(),
  setSort: vi.fn(),
  setSeparateSizeClasses: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
}

function setState(capacities: number[], overrides: Record<string, string> = {}, status = 'synced') {
  const cabinet = cabinetOf(capacities)
  mock.state = {
    cabinets: [cabinet],
    cabinet,
    overrides,
    options: { sort: 'artist', separateSizeClasses: true },
    plan: planCabinet({ releases, cabinet, overrides }),
    status,
    dirty: false,
    error: null,
    ...actions,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setState([75, 75])
})

function renderScreen(onClose = vi.fn()) {
  render(
    <CabinetScreen username="alice" token="tok" releases={releases} onClose={onClose} />,
  )
  return onClose
}

describe('CabinetScreen', () => {
  it('shows the cabinet, both shelves and the placed count', () => {
    renderScreen()

    expect(screen.getByLabelText('Cabinet name')).toHaveValue('Cabinet')
    expect(screen.getAllByLabelText('Shelf name')).toHaveLength(2)
    expect(screen.getByText(/2 releases · 2 placed/)).toBeInTheDocument()
    expect(screen.queryByText(/without a slot/)).not.toBeInTheDocument()
  })

  it('renames the cabinet and shelves', () => {
    renderScreen()

    fireEvent.change(screen.getByLabelText('Cabinet name'), { target: { value: 'Loft' } })
    expect(actions.setName).toHaveBeenCalledWith('Loft')

    fireEvent.change(screen.getAllByLabelText('Shelf name')[0], { target: { value: 'Wall A' } })
    expect(actions.updateSlot).toHaveBeenCalledWith('slot-1', { label: 'Wall A' })
  })

  it('adds a shelf', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add shelf' }))
    expect(actions.addSlot).toHaveBeenCalled()
  })

  it('moves a record to another shelf and back to auto', () => {
    renderScreen()

    const select = screen.getByLabelText('Shelf for First')
    fireEvent.change(select, { target: { value: 'slot-2' } })
    expect(actions.assign).toHaveBeenCalledWith(releases[0].key, 'slot-2')

    fireEvent.change(select, { target: { value: '' } })
    expect(actions.unassign).toHaveBeenCalledWith(releases[0].key)
  })

  it('changes the sort and the size separation', () => {
    renderScreen()

    fireEvent.click(screen.getByRole('radio', { name: 'Year' }))
    expect(actions.setSort).toHaveBeenCalledWith('year')

    fireEvent.click(screen.getByLabelText(/Keep 12"/))
    expect(actions.setSeparateSizeClasses).toHaveBeenCalledWith(false)
  })

  it('lists records that fit nowhere without a slot', () => {
    setState([1])
    renderScreen()

    expect(screen.getByText('Second')).toBeInTheDocument()

    const warnings = screen.getByRole('list', { name: 'Cabinet warnings' })
    expect(within(warnings).getByText('1 without a slot')).toBeInTheDocument()
  })

  it('warns about an overfilled shelf', () => {
    setState([1, 1], { '1-1': 'slot-2' })
    renderScreen()

    const warnings = screen.getByRole('list', { name: 'Cabinet warnings' })
    expect(within(warnings).getByText('1 over capacity')).toBeInTheDocument()
    expect(screen.getByText('Pinned')).toBeInTheDocument()
  })

  it('offers a retry when a sync fails', () => {
    const state = mock.state as { status: string; error: string | null }
    state.status = 'error'
    state.error = 'Could not save the cabinet'
    renderScreen()

    expect(screen.getByText('Could not save the cabinet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(actions.retry).toHaveBeenCalled()
  })

  it('closes from the button and the backdrop', () => {
    const onClose = renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Close cabinet' }))
    expect(onClose).toHaveBeenCalled()
  })
})
