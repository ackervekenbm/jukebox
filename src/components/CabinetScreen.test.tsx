// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { DiscogsCollectionRelease } from '../types/discogs'
import type { DisplayRelease } from '../utils/collection'
import { makeSortKey } from '../utils/sortName'
import { planCabinet, type CabinetPlan, type PlannedSlot } from '../utils/cabinet'
import type { Cabinet } from '../shared/cabinetDoc'
import { CabinetScreen } from './CabinetScreen'
import type { UseCabinetResult } from '../hooks/useCabinet'

const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

const cab = () => mock.state as unknown as UseCabinetResult

// Why a Discogs job waits has its own tests; here it says whatever a test sets.
const wait = vi.hoisted(() => ({ note: null as string | null, calls: [] as unknown[][] }))
vi.mock('../hooks/useDiscogsWait', () => ({
  useDiscogsWaitNote: (active: boolean, progress: unknown) => {
    wait.calls.push([active, progress])
    return active ? wait.note : null
  },
}))

let nextId = 0

function release(artist: string, title: string, overrides: Partial<DisplayRelease> = {}): DisplayRelease {
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
    ...overrides,
  }
}

const releases = [release('Alpha', 'First'), release('Beta', 'Second')]

function cabinetOf(capacities: number[]): Cabinet {
  return {
    id: 'main',
    name: 'Record Cabinet',
    slots: capacities.map((capacity, index) => ({
      id: `slot-${index + 1}`,
      label: `Shelf ${index + 1}`,
      capacity,
    })),
  }
}

/**
 * A plan built by hand, so screen tests don't depend on how the planner fills
 * shelves (the planner has its own tests).
 */
function planOf(cabinet: Cabinet, shelves: Partial<PlannedSlot>[], rest: Partial<CabinetPlan> = {}): CabinetPlan {
  const slots = cabinet.slots.map((slot, index) => {
    const shelf = shelves[index] ?? {}
    const records = shelf.records ?? []
    const used = shelf.used ?? records.reduce((total, record) => total + record.units, 0)
    return {
      slot,
      records,
      sizeClass: records.length === 0 ? null : '12-inch',
      used,
      overCapacity: Math.max(0, used - slot.capacity),
      ...shelf,
    } satisfies PlannedSlot
  })
  const placements: Record<string, string> = {}
  for (const shelf of slots) for (const record of shelf.records) placements[record.key] = shelf.slot.id
  return { placements, slots, unplaced: [], conflicts: [], ...rest }
}

const onShelf = (display: DisplayRelease, units = 1) => ({ key: display.key, display, units })

const actions = {
  addSlot: vi.fn(),
  updateSlot: vi.fn(),
  removeSlot: vi.fn(),
  restoreSlot: vi.fn(),
  setSort: vi.fn(),
  setSeparateSizeClasses: vi.fn(),
  toggleGatefold: vi.fn(),
  toggleDisplayed: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
}

function setState(cabinet: Cabinet, plan: CabinetPlan, overrides: Record<string, unknown> = {}) {
  mock.state = {
    cabinets: [cabinet],
    cabinet,
    options: { sort: 'chronological', separateSizeClasses: true },
    plan,
    sleeves: {},
    displayed: [],
    gatefoldScan: null,
    gatefoldScanError: null,
    status: 'synced',
    dirty: false,
    error: null,
    ...actions,
    ...overrides,
  }
}

/** Two shelves of 75, one record on each. */
function setDefault() {
  const cabinet = cabinetOf([75, 75])
  setState(cabinet, planOf(cabinet, [{ records: [onShelf(releases[0])] }, { records: [onShelf(releases[1])] }]))
}

beforeEach(() => {
  wait.note = null
  wait.calls = []
  vi.clearAllMocks()
  setDefault()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderScreen(onClose = vi.fn(), list = releases) {
  render(<CabinetScreen cabinet={cab()} releases={list} onClose={onClose} />)
  return onClose
}

const shelfHeader = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) })

describe('CabinetScreen', () => {
  it('shows the cabinet, its shelves and how much they hold', () => {
    renderScreen()

    expect(screen.getByRole('heading', { name: 'Record Cabinet' })).toBeInTheDocument()
    expect(screen.getByText('2 shelves · 150 record spaces')).toBeInTheDocument()
    expect(screen.getByText('2 releases · 2 placed')).toBeInTheDocument()
    expect(screen.queryByText(/without a shelf/)).not.toBeInTheDocument()
  })

  it('gives each shelf one fill count that says what it counts', () => {
    // One gatefold alone on the shelf: 2 spaces used by 1 record, shown once as spaces.
    const cabinet = cabinetOf([75])
    setState(cabinet, planOf(cabinet, [{ records: [onShelf(releases[0], 2)] }]))
    renderScreen()

    const header = shelfHeader('Shelf 1')
    expect(within(header).getByText('2 / 75 spaces')).toBeInTheDocument()
    expect(header).not.toHaveTextContent(/records?/)
    // Read out as separate phrases, not "Shelf 12 of 75…".
    expect(header).toHaveAccessibleName('Shelf 1, 2 of 75 spaces used, 12"')
  })

  it('has no name fields for the cabinet or its shelves', () => {
    renderScreen()
    fireEvent.click(shelfHeader('Shelf 1'))

    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.getByRole('spinbutton', { name: 'Capacity of Shelf 1' })).toBeInTheDocument()
  })

  it('numbers shelves by position, whatever their ids and stored labels', () => {
    const cabinet: Cabinet = {
      id: 'main',
      name: 'Old name',
      slots: [
        { id: 'slot-1', label: 'Kitchen', capacity: 75 },
        { id: 'slot-3', label: 'Shelf 3', capacity: 75 },
      ],
    }
    setState(cabinet, planOf(cabinet, []))
    renderScreen()

    expect(shelfHeader('Shelf 1')).toBeInTheDocument()
    expect(shelfHeader('Shelf 2')).toBeInTheDocument()
    expect(screen.queryByText('Kitchen')).not.toBeInTheDocument()
    expect(screen.queryByText('Shelf 3')).not.toBeInTheDocument()
    expect(screen.queryByText('Old name')).not.toBeInTheDocument()
  })

  it('shows each record with the year it is sorted by', () => {
    // A 2015 reissue of a 1971 album files (and shows) as 1971, like the main view.
    const reissue = release('The Band', 'Zulu', { year: 2015, originalYear: 1971 })
    const cabinet = cabinetOf([75])
    setState(cabinet, planOf(cabinet, [{ records: [onShelf(reissue)] }]))
    renderScreen(vi.fn(), [reissue])
    fireEvent.click(shelfHeader('Shelf 1'))

    const row = screen.getByText('Zulu').closest('li')!
    expect(within(row).getByText('1971')).toBeInTheDocument()
    expect(within(row).queryByText('2015')).not.toBeInTheDocument()
  })

  describe('warnings', () => {
    it('shows the planner\'s warnings, and tags a mixed shelf only when sizes are kept apart', () => {
      const cabinet = cabinetOf([75, 75])
      const plan = planOf(
        cabinet,
        [{ records: [onShelf(releases[0]), onShelf(releases[1])], sizeClass: 'mixed' }],
        { conflicts: [{ type: 'size-mix', count: 1 }, { type: 'out-of-order', count: 2 }] },
      )

      setState(cabinet, plan)
      const { unmount } = render(
        <CabinetScreen cabinet={cab()} releases={releases} onClose={vi.fn()} />,
      )
      const warnings = screen.getByRole('list', { name: 'Cabinet warnings' })
      expect(within(warnings).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'Mixed sizes on 1 shelf',
        '2 records out of order',
      ])
      expect(within(shelfHeader('Shelf 1')).getByText('Mixed sizes')).toBeInTheDocument()
      // The warning says how to get the sizes apart.
      expect(
        screen.getByText('To keep every size on shelves of its own, add a shelf or make one bigger.'),
      ).toBeInTheDocument()
      unmount()

      // With sizes not kept apart, a mixed shelf is the expected layout.
      setState(cabinet, { ...plan, conflicts: [] }, {
        options: { sort: 'chronological', separateSizeClasses: false },
      })
      renderScreen()
      expect(screen.queryByText('Mixed sizes')).not.toBeInTheDocument()
      expect(screen.queryByText(/keep every size on shelves of its own/)).not.toBeInTheDocument()
    })

    it('says how many shelves are missing when there are fewer shelves than sizes', () => {
      // An LP, a single and a CD on one shelf: no capacity can keep them apart.
      const cd = release('Gamma', 'Disc', { formatNames: ['CD'], formatText: 'CD · Album' })
      const single = release('Delta', 'Seven', { formatText: 'Vinyl · 7"' })
      const cabinet = cabinetOf([75])
      setState(
        cabinet,
        planOf(cabinet, [{ records: [onShelf(releases[0]), onShelf(single), onShelf(cd)], sizeClass: 'mixed' }], {
          conflicts: [{ type: 'size-mix', count: 1 }],
        }),
      )
      renderScreen(vi.fn(), [releases[0], single, cd])
      expect(
        screen.getByText('Each size needs a shelf of its own: add at least 2 more shelves to keep them apart.'),
      ).toBeInTheDocument()
    })

    it('tags an empty shelf with no size at all', () => {
      const cabinet = cabinetOf([75, 75])
      setState(cabinet, planOf(cabinet, [{ records: [onShelf(releases[0])] }]))
      renderScreen()

      const empty = shelfHeader('Shelf 2')
      expect(empty).toHaveTextContent('0 / 75 spaces')
      expect(empty).not.toHaveTextContent('12"')
      expect(empty).not.toHaveTextContent('Mixed sizes')
      expect(shelfHeader('Shelf 1')).toHaveTextContent('12"')
    })

    it('says how far over capacity a shelf is', () => {
      const cabinet = cabinetOf([1])
      setState(cabinet, planOf(cabinet, [{ records: [onShelf(releases[0], 2), onShelf(releases[1])] }]))
      renderScreen()
      expect(within(shelfHeader('Shelf 1')).getByText('2 spaces over')).toBeInTheDocument()
    })
  })

  describe('removing a shelf', () => {
    it('removes the last shelf too, and says what to do next', () => {
      const cabinet = cabinetOf([75])
      setState(cabinet, planOf(cabinet, []))
      actions.removeSlot.mockReturnValue({ slot: cabinet.slots[0], index: 0 })
      renderScreen()
      fireEvent.click(shelfHeader('Shelf 1'))

      const remove = screen.getByRole('button', { name: 'Remove Shelf 1' })
      expect(remove).toBeEnabled()
      fireEvent.click(remove)
      expect(actions.removeSlot).toHaveBeenCalledWith('slot-1')
    })

    it('offers to undo, and puts the shelf back', () => {
      const cabinet = cabinetOf([30, 75])
      const removed = { slot: cabinet.slots[0], index: 0 }
      actions.removeSlot.mockReturnValue(removed)
      renderScreen()
      fireEvent.click(shelfHeader('Shelf 1'))
      fireEvent.click(screen.getByRole('button', { name: 'Remove Shelf 1' }))

      const message = screen.getByRole('status', { name: 'Removed shelf' })
      expect(message).toHaveTextContent('Shelf 1 removed')
      fireEvent.click(within(message).getByRole('button', { name: 'Undo' }))
      expect(actions.restoreSlot).toHaveBeenCalledWith(expect.objectContaining(removed))
      expect(message).toBeEmptyDOMElement()
    })

    it('lets the undo message go after a few seconds', () => {
      vi.useFakeTimers()
      actions.removeSlot.mockReturnValue({ slot: cabinetOf([75]).slots[0], index: 0 })
      renderScreen()
      fireEvent.click(shelfHeader('Shelf 1'))
      fireEvent.click(screen.getByRole('button', { name: 'Remove Shelf 1' }))
      expect(screen.getByRole('status', { name: 'Removed shelf' })).toHaveTextContent('Shelf 1 removed')

      act(() => {
        vi.advanceTimersByTime(8000)
      })
      expect(screen.getByRole('status', { name: 'Removed shelf' })).toBeEmptyDOMElement()
    })

    it('moves focus to the shelf that takes its place', () => {
      const cabinet = cabinetOf([75, 75])
      actions.removeSlot.mockImplementation(() => {
        // The hook drops the shelf; the next render shows only Shelf 2's id.
        const after = { ...cabinet, slots: [cabinet.slots[1]] }
        setState(after, planOf(after, []))
        return { slot: cabinet.slots[0], index: 0 }
      })
      const { rerender } = render(
        <CabinetScreen cabinet={cab()} releases={releases} onClose={vi.fn()} />,
      )
      fireEvent.click(shelfHeader('Shelf 1'))
      fireEvent.click(screen.getByRole('button', { name: 'Remove Shelf 1' }))
      rerender(<CabinetScreen cabinet={cab()} releases={releases} onClose={vi.fn()} />)

      // slot-2 is now first, so it reads "Shelf 1".
      expect(shelfHeader('Shelf 1')).toHaveFocus()
    })
  })

  describe('adding a shelf', () => {
    it('adds a shelf of the size entered, and returns focus to "Add shelf"', () => {
      renderScreen()
      fireEvent.click(screen.getByRole('button', { name: 'Add shelf' }))
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Shelf size' }), { target: { value: '60' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))

      expect(actions.addSlot).toHaveBeenCalledWith(60)
      expect(screen.getByRole('button', { name: 'Add shelf' })).toHaveFocus()
    })

    it('keeps its field named on narrow screens, where the visible label is hidden', () => {
      renderScreen()
      fireEvent.click(screen.getByRole('button', { name: 'Add shelf' }))
      expect(screen.getByRole('spinbutton', { name: 'Shelf size' })).toHaveAttribute(
        'aria-label',
        'Shelf size',
      )
    })

    it.each(['0', '-5', '501', '1e9', '2.5', ''])('refuses a shelf size of "%s" and says why', (value) => {
      renderScreen()
      fireEvent.click(screen.getByRole('button', { name: 'Add shelf' }))
      const field = screen.getByRole('spinbutton', { name: 'Shelf size' })
      fireEvent.change(field, { target: { value } })
      fireEvent.keyDown(field, { key: 'Enter' })

      expect(actions.addSlot).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 500.')
      expect(field).toHaveAttribute('aria-invalid', 'true')
    })

    it('closes on Escape and returns focus to "Add shelf"', () => {
      renderScreen()
      fireEvent.click(screen.getByRole('button', { name: 'Add shelf' }))
      fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Shelf size' }), { key: 'Escape' })

      expect(screen.queryByRole('spinbutton', { name: 'Shelf size' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add shelf' })).toHaveFocus()
    })
  })

  describe('shelf capacity', () => {
    it('saves a valid capacity', () => {
      renderScreen()
      fireEvent.click(shelfHeader('Shelf 1'))
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Capacity of Shelf 1' }), {
        target: { value: '40' },
      })
      expect(actions.updateSlot).toHaveBeenCalledWith('slot-1', { capacity: 40 })
    })

    it('lets the field be cleared while typing, without saving anything', () => {
      renderScreen()
      fireEvent.click(shelfHeader('Shelf 1'))
      const field = screen.getByRole('spinbutton', { name: 'Capacity of Shelf 1' })
      fireEvent.change(field, { target: { value: '' } })

      expect(field).toHaveValue(null)
      expect(actions.updateSlot).not.toHaveBeenCalled()
      expect(screen.getByText('Enter a whole number from 1 to 500.')).toBeInTheDocument()

      // Leaving the field puts the saved size back.
      fireEvent.blur(field)
      expect(field).toHaveValue(75)
    })

    it('refuses a capacity out of range', () => {
      renderScreen()
      fireEvent.click(shelfHeader('Shelf 1'))
      const field = screen.getByRole('spinbutton', { name: 'Capacity of Shelf 1' })
      fireEvent.change(field, { target: { value: '9999' } })

      expect(actions.updateSlot).not.toHaveBeenCalled()
      expect(field).toHaveAttribute('aria-invalid', 'true')
    })
  })

  it('says what to do when there are no shelves', () => {
    const cabinet = cabinetOf([])
    setState(cabinet, planOf(cabinet, [], { unplaced: releases }))
    renderScreen()

    expect(screen.getByText(/No shelves yet/)).toBeInTheDocument()
    expect(screen.getByText('0 shelves')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /^Without a shelf/ })).getByText('2 records')).toBeInTheDocument()
  })

  it('lists the records on display apart, and puts one back with its Display button', () => {
    const cabinet = cabinetOf([75])
    setState(cabinet, planOf(cabinet, [{ records: [onShelf(releases[0])] }]), {
      displayed: [releases[1]],
    })
    renderScreen()

    expect(screen.getByText('2 releases · 1 placed · 1 on display')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'On display, 1 record' }))
    const back = screen.getByRole('button', { name: 'On display: Second' })
    expect(back).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(back)
    expect(actions.toggleDisplayed).toHaveBeenCalledWith(releases[1])

    fireEvent.click(shelfHeader('Shelf 1'))
    expect(screen.getByRole('button', { name: 'On display: First' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('manages records automatically without per-record shelf controls', () => {
    renderScreen()
    expect(screen.queryByLabelText('Shelf for First')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('offers the main view\'s Year / A–Z order as toggle buttons, and the size separation', () => {
    renderScreen()

    const order = screen.getByRole('group', { name: 'Order within each artist' })
    const buttons = within(order).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['Year', 'A–Z'])
    expect(within(order).getByRole('button', { name: 'Year' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(order).getByRole('button', { name: 'A–Z' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(within(order).getByRole('button', { name: 'A–Z' }))
    expect(actions.setSort).toHaveBeenCalledWith('byName')

    const sizes = screen.getByRole('switch', { name: 'Separate record sizes' })
    expect(sizes).toBeChecked()
    fireEvent.click(sizes)
    expect(actions.setSeparateSizeClasses).toHaveBeenCalledWith(false)
  })

  it('lists records that fit nowhere in a collapsible section shaped like a shelf', () => {
    const cabinet = cabinetOf([1])
    setState(
      cabinet,
      planOf(cabinet, [{ records: [onShelf(releases[0])] }], {
        unplaced: [releases[1]],
        conflicts: [{ type: 'unplaced', count: 1 }],
      }),
    )
    renderScreen()

    const warnings = screen.getByRole('list', { name: 'Cabinet warnings' })
    expect(within(warnings).getByText('1 record without a shelf')).toBeInTheDocument()
    expect(screen.getByText('2 releases · 1 placed · 1 without a shelf')).toBeInTheDocument()

    // Collapsed by default, like the shelves, with the count in its header.
    const toggle = screen.getByRole('button', { name: /^Without a shelf/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')
    expect(within(toggle).getByText('1 record')).toBeInTheDocument()
    expect(screen.queryByText('Second')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'cabinet-unplaced')
    const body = document.getElementById('cabinet-unplaced')
    expect(body).toHaveClass('cabinet-slot-body')
    expect(within(body!).getByText('Second')).toBeInTheDocument()
    expect(within(body!).getByText(/add a shelf or make one bigger/)).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByText('Second')).not.toBeInTheDocument()
  })

  it('shows when a release takes two spaces', () => {
    const gatefold = release('Gamma', 'Folded', { formatText: 'Vinyl · 12" · LP · Gatefold' })
    const cabinet = cabinetOf([75])
    setState(cabinet, planOf(cabinet, [{ records: [onShelf(gatefold, 2)] }]))
    renderScreen(vi.fn(), [gatefold])
    fireEvent.click(shelfHeader('Shelf 1'))

    const row = screen.getByText('Folded').closest('li')!
    expect(within(row).getByText('2 spaces')).toBeInTheDocument()
  })

  it('toggles a record between gatefold and standard sleeve', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Shelf 1/ }))

    const toggle = screen.getByRole('button', { name: 'Gatefold: First' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(actions.toggleGatefold).toHaveBeenCalledWith(releases[0])
  })

  it('shows a gatefold found in the release notes, and why it takes two spaces', () => {
    const cabinet = cabinetOf([75, 75])
    const sleeves = { notes: { [String(releases[0].id)]: 'Gatefold sleeve.' } }
    mock.state = {
      cabinets: [cabinet],
      cabinet,
      options: { sort: 'chronological', separateSizeClasses: true },
      plan: planCabinet({ releases, cabinet, sleeves }),
      sleeves,
      displayed: [],
      gatefoldScan: null,
      status: 'synced',
      dirty: false,
      error: null,
      ...actions,
    }
    renderScreen()
    expect(screen.getByText('1 gatefold')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Shelf 1/ }))

    const toggle = screen.getByRole('button', { name: 'Gatefold: First' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAccessibleDescription(/according to Discogs/)
    expect(within(toggle).queryByText('you')).not.toBeInTheDocument()
    expect(within(toggle.closest('li')!).getByText('2 spaces')).toBeInTheDocument()

    // The chips come after the year (right-aligned under it, on the artist's
    // line), so the years line up; the Display button every row has comes
    // last and the Gatefold button just before it, so both line up too.
    const row = toggle.closest('li')!
    const tags = row.querySelector('.cabinet-record-tags')!
    expect(tags.parentElement).toBe(row)
    expect(tags.previousElementSibling).toHaveClass('cabinet-record-year')
    expect(tags.lastElementChild).toHaveAccessibleName('On display: First')
    expect(tags.lastElementChild!.previousElementSibling).toBe(toggle)
  })

  it('reports the release-notes check while it runs', () => {
    const state = mock.state as { gatefoldScan: unknown }
    state.gatefoldScan = { done: 12, total: 40 }
    renderScreen()

    expect(screen.getByText('Checking release notes: 12 of 40 records')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Release notes checked' })
    expect(bar).toHaveAttribute('value', '12')
    expect(bar).toHaveAttribute('max', '40')
  })

  it('says the check waits for the collection to load', () => {
    render(
      <CabinetScreen
        cabinet={cab()}
        releases={releases}
        collectionReady={false}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/checked once your collection has loaded/)).toBeInTheDocument()
  })

  it('marks a sleeve the user decided with a visible "you"', () => {
    // Discogs has no gatefold for First; the user said it is one.
    const cabinet = cabinetOf([75])
    const sleeves = { overrides: { [String(releases[0].id)]: true } }
    setState(cabinet, planOf(cabinet, [{ records: [onShelf(releases[0], 2)] }]), { sleeves })
    renderScreen()
    fireEvent.click(shelfHeader('Shelf 1'))

    const toggle = screen.getByRole('button', { name: /^Gatefold: First/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(within(toggle).getByText('you')).toBeInTheDocument()
    expect(toggle).toHaveAccessibleDescription(/marked by you/)
  })

  it('says a multi-disc release takes its space for its discs', () => {
    const double = release('Gamma', 'Double', {
      formatText: 'Vinyl · LP',
      release: {
        basic_information: { formats: [{ name: 'Vinyl', qty: '2', descriptions: ['LP'] }] },
      } as unknown as DiscogsCollectionRelease,
    })
    const cabinet = cabinetOf([75])
    setState(cabinet, planOf(cabinet, [{ records: [onShelf(double, 2)] }]))
    renderScreen(vi.fn(), [double])
    fireEvent.click(shelfHeader('Shelf 1'))

    const row = screen.getByText('Double').closest('li')!
    expect(within(row).getByText('2 discs')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /^Gatefold: Double/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('has no Gatefold button for a CD', () => {
    const cd = release('Gamma', 'Disc', { formatNames: ['CD'], formatText: 'CD · Album' })
    const cabinet = cabinetOf([75])
    setState(cabinet, planOf(cabinet, [{ records: [onShelf(cd)] }]))
    renderScreen(vi.fn(), [cd])
    fireEvent.click(shelfHeader('Shelf 1'))
    expect(screen.queryByRole('button', { name: /^Gatefold/ })).not.toBeInTheDocument()
  })

  it('says why the release-notes check is not moving', () => {
    const state = mock.state as { gatefoldScan: unknown }
    state.gatefoldScan = { done: 12, total: 40 }
    wait.note = "pausing to stay within Discogs' rate limit"
    renderScreen()

    expect(
      screen.getByText(
        "Checking release notes: 12 of 40 records — pausing to stay within Discogs' rate limit",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Release notes check' })).toHaveTextContent(
      "Now pausing to stay within Discogs' rate limit.",
    )
    // Asked about the running check, keyed on its count.
    expect(wait.calls.at(-1)).toEqual([true, 12])
  })

  it('says when Discogs refused the token for the release notes', () => {
    setDefault()
    ;(mock.state as Record<string, unknown>).gatefoldScanError =
      'Discogs refused the token, so release notes were not checked.'
    renderScreen()
    expect(screen.getByText(/refused the token/)).toBeInTheDocument()
  })

  it('announces the release-notes check starting and finishing, not every step', () => {
    const state = mock.state as { gatefoldScan: unknown }
    state.gatefoldScan = { done: 0, total: 40 }
    const { rerender } = render(
      <CabinetScreen cabinet={cab()} releases={releases} onClose={vi.fn()} />,
    )
    const announcer = screen.getByRole('status', { name: 'Release notes check' })
    expect(announcer).toHaveTextContent('Checking release notes for gatefold sleeves.')
    // The visible count is not a live region.
    expect(screen.getByText(/Checking release notes: 0 of 40/)).not.toHaveAttribute('aria-live')

    state.gatefoldScan = { done: 20, total: 40 }
    rerender(<CabinetScreen cabinet={cab()} releases={releases} onClose={vi.fn()} />)
    expect(announcer).toHaveTextContent('Checking release notes for gatefold sleeves.')

    state.gatefoldScan = null
    rerender(<CabinetScreen cabinet={cab()} releases={releases} onClose={vi.fn()} />)
    expect(announcer).toHaveTextContent('Release notes checked.')
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

  it('closes from the button', () => {
    const onClose = renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Close cabinet' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('still lays out a real plan from the planner', () => {
    // One end-to-end check that the screen and the planner agree on shapes.
    const cabinet = cabinetOf([75, 75])
    setState(cabinet, planCabinet({ releases, cabinet }))
    renderScreen()
    expect(screen.getByText('2 releases · 2 placed')).toBeInTheDocument()
  })
})
