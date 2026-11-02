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
  addSlot: vi.fn(),
  updateSlot: vi.fn(),
  removeSlot: vi.fn(),
  setSort: vi.fn(),
  setSeparateSizeClasses: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
}

function setState(capacities: number[], status = 'synced') {
  setCabinet(cabinetOf(capacities), status)
}

function setCabinet(cabinet: Cabinet, status = 'synced') {
  mock.state = {
    cabinets: [cabinet],
    cabinet,
    options: { sort: 'chronological', separateSizeClasses: true },
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

    expect(screen.getByRole('heading', { name: 'Record Cabinet' })).toBeInTheDocument()
    expect(screen.getByText('2 shelves · 150 record spaces')).toBeInTheDocument()
    expect(screen.getAllByText('Shelf 1')).toHaveLength(1)
    expect(screen.getAllByText('Shelf 2')).toHaveLength(1)
    expect(screen.getByText(/2 releases · 2 placed/)).toBeInTheDocument()
    expect(screen.queryByText(/without a slot/)).not.toBeInTheDocument()
  })

  it('has no name fields for the cabinet or its shelves', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Shelf 1/ }))

    expect(screen.queryByLabelText('Cabinet name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Shelf name')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Capacity of Shelf 1')).toBeInTheDocument()
  })

  it('numbers shelves by position, whatever their ids and stored labels', () => {
    setCabinet({
      id: 'main',
      name: 'Old name',
      slots: [
        { id: 'slot-1', label: 'Kitchen', capacity: 75 },
        { id: 'slot-3', label: 'Shelf 3', capacity: 75 },
      ],
    })
    renderScreen()

    expect(screen.getByRole('button', { name: /Shelf 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Shelf 2/ })).toBeInTheDocument()
    expect(screen.queryByText('Kitchen')).not.toBeInTheDocument()
    expect(screen.queryByText('Shelf 3')).not.toBeInTheDocument()
    expect(screen.queryByText('Old name')).not.toBeInTheDocument()
  })

  it('warns about mixed sizes once, and only when sizes are kept apart', () => {
    // Alternating 12" and 7" on shelves of 3, 2 and 1: two shelves have to mix.
    const mixed = ['A', 'B', 'C', 'D', 'E', 'F'].map((artist, index) => ({
      ...release(artist, artist.toLowerCase()),
      formatText: index % 2 ? 'Vinyl · 7"' : 'Vinyl · 12"',
    }))
    const cabinet = cabinetOf([3, 2, 1])
    const show = (separateSizeClasses: boolean) => {
      const options = { sort: 'chronological' as const, separateSizeClasses }
      mock.state = {
        cabinets: [cabinet],
        cabinet,
        options,
        plan: planCabinet({ releases: mixed, cabinet, options }),
        status: 'synced',
        dirty: false,
        error: null,
        ...actions,
      }
      return render(
        <CabinetScreen username="alice" token="tok" releases={mixed} onClose={vi.fn()} />,
      )
    }

    const apart = show(true)
    const warnings = screen.getByRole('list', { name: 'Cabinet warnings' })
    expect(within(warnings).getAllByText(/Mixed record sizes/)).toHaveLength(1)
    expect(within(warnings).getByText('Mixed record sizes on 2 shelves')).toBeInTheDocument()
    expect(screen.getAllByText('Mixed sizes')).toHaveLength(2)
    apart.unmount()

    show(false)
    expect(screen.queryByText(/Mixed record sizes/)).not.toBeInTheDocument()
    expect(screen.queryByText('Mixed sizes')).not.toBeInTheDocument()
  })

  it('tags an empty shelf with no size at all', () => {
    // Two records over three shelves: the planner fills two, the third stays empty.
    setState([75, 75, 75])
    renderScreen()

    const empty = screen.getByRole('button', { name: /Shelf 3/ })
    expect(empty).toHaveTextContent('0 / 75')
    expect(empty).not.toHaveTextContent('Mixed sizes')
    expect(screen.getByRole('button', { name: /Shelf 1/ })).toHaveTextContent('12"')
  })

  it('removes the last shelf too', () => {
    setState([75])
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Shelf 1/ }))

    const remove = screen.getByRole('button', { name: 'Remove Shelf 1' })
    expect(remove).toBeEnabled()
    fireEvent.click(remove)
    expect(actions.removeSlot).toHaveBeenCalledWith('slot-1')
  })

  it('says what to do when there are no shelves', () => {
    setState([])
    renderScreen()

    expect(screen.getByText(/No shelves yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add shelf' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Without a shelf/ })).toHaveTextContent('2 records')
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

  it('offers the main view\'s Year / A–Z order and the size separation', () => {
    renderScreen()

    const order = screen.getByRole('radiogroup', { name: 'Sort within each artist' })
    expect(within(order).getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'Year',
      'A–Z',
    ])
    expect(within(order).getByRole('radio', { name: 'Year' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(order).getByRole('radio', { name: 'A–Z' }))
    expect(actions.setSort).toHaveBeenCalledWith('byName')

    const sizes = screen.getByRole('switch', { name: 'Separate record sizes' })
    expect(sizes).toBeChecked()
    fireEvent.click(sizes)
    expect(actions.setSeparateSizeClasses).toHaveBeenCalledWith(false)
  })

  it('lists records that fit nowhere in a collapsible section shaped like a shelf', () => {
    setState([1])
    renderScreen()

    const warnings = screen.getByRole('list', { name: 'Cabinet warnings' })
    expect(within(warnings).getByText('1 without a slot')).toBeInTheDocument()

    // Collapsed by default, like the shelves, with the count in its header.
    const toggle = screen.getByRole('button', { name: /Without a shelf/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent(/^Without a shelf1 record▸$/)
    expect(screen.queryByText('Second')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const body = document.getElementById('cabinet-unplaced')
    expect(body).toHaveClass('cabinet-slot-body')
    expect(within(body!).getByText('Second')).toBeInTheDocument()
    expect(within(body!).getByText(/add a shelf or raise a capacity/)).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByText('Second')).not.toBeInTheDocument()
  })

  it('shows when a release takes two spaces', () => {
    const gatefold = { ...releases[0], formatText: 'Vinyl · 12" · Gatefold' }
    const cabinet = cabinetOf([75, 75])
    mock.state = {
      cabinets: [cabinet],
      cabinet,
      options: { sort: 'chronological', separateSizeClasses: true },
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

    // One gatefold alone on the shelf: the header gives the spaces used (2), not
    // a second, different record count (1).
    const shelf = screen.getByRole('button', { name: /Shelf 1/ })
    expect(shelf).toHaveTextContent(/^Shelf 12 \/ 7512"▸$/)
    expect(shelf).not.toHaveTextContent('records')

    fireEvent.click(shelf)
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
