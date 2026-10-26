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
  setSort: vi.fn(),
  setSeparateSizeClasses: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
}

function setState(capacities: number[], status = 'synced') {
  const cabinet = cabinetOf(capacities)
  mock.state = {
    cabinets: [cabinet],
    cabinet,
    options: { sort: 'artist', separateSizeClasses: true },
    plan: planCabinet({ releases, cabinet }),
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
    expect(screen.getAllByText('Shelf 1')).toHaveLength(1)
    expect(screen.getAllByText('Shelf 2')).toHaveLength(1)
    expect(screen.getByText(/2 releases · 2 placed/)).toBeInTheDocument()
    expect(screen.queryByText(/without a slot/)).not.toBeInTheDocument()
  })

  it('renames the cabinet and shelves', () => {
    renderScreen()

    fireEvent.change(screen.getByLabelText('Cabinet name'), { target: { value: 'Loft' } })
    expect(actions.setName).toHaveBeenCalledWith('Loft')

    fireEvent.click(screen.getByRole('button', { name: /Shelf 1/ }))
    fireEvent.change(screen.getAllByLabelText('Shelf name')[0], { target: { value: 'Wall A' } })
    expect(actions.updateSlot).toHaveBeenCalledWith('slot-1', { label: 'Wall A' })
  })

  it('adds a shelf', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add shelf' }))
    fireEvent.change(screen.getByLabelText('Shelf size'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(actions.addSlot).toHaveBeenCalledWith(60)
  })

  it('manages records automatically without per-record shelf controls', () => {
    renderScreen()

    expect(screen.queryByLabelText('Shelf for First')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
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

  it('shows when a release takes two spaces', () => {
    const gatefold = { ...releases[0], formatText: 'Vinyl · 12" · Gatefold' }
    const cabinet = cabinetOf([75, 75])
    mock.state = {
      cabinets: [cabinet],
      cabinet,
      options: { sort: 'artist', separateSizeClasses: true },
      plan: planCabinet({ releases: [gatefold, releases[1]], cabinet }),
      status: 'synced',
      dirty: false,
      error: null,
      ...actions,
    }
    render(
      <CabinetScreen
        username="alice"
        token="tok"
        releases={[gatefold, releases[1]]}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Shelf 1/ }))
    expect(screen.getByText('2 spaces')).toBeInTheDocument()
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
