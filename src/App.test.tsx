// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { artist, release } from './test/factories'
import type { DiscogsCollectionRelease } from './types/discogs'
import { DEFAULT_FILTERS } from './utils/collection'
import { createSavedView, type SavedView } from './utils/views'

// The API is stubbed: these tests are about what the toolbar does with a stored
// selection, not about talking to Discogs.
const api = vi.hoisted(() => ({ releases: [] as DiscogsCollectionRelease[] }))

vi.mock('./api/discogs', () => ({
  DiscogsError: class extends Error {},
  fetchFolders: vi.fn(async () => []),
  fetchCollection: vi.fn(async () => ({
    releases: api.releases,
    items: api.releases.length,
  })),
  fetchCollectionValue: vi.fn(async () => null),
  fetchReleaseDetails: vi.fn(async () => ({ tracks: [], gatefold: false })),
  fetchMasterYears: vi.fn(async () => ({})),
}))

const basic = release().basic_information

api.releases = [
  release({
    id: 1,
    instance_id: 1,
    basic_information: {
      ...basic,
      master_id: 11,
      title: 'Moving Pictures',
      year: 1981,
      genres: ['Rock'],
      styles: ['Prog'],
      labels: [{ name: 'Moon', catno: 'C1', id: 1, resource_url: '' }],
      formats: [{ name: 'LP', qty: '1', descriptions: ['Album'] }],
      artists: [artist({ name: 'Rush' })],
    },
  }),
  release({
    id: 2,
    instance_id: 2,
    basic_information: {
      ...basic,
      master_id: 22,
      title: 'Headhunters',
      year: 1973,
      genres: ['Jazz'],
      styles: ['Fusion'],
      labels: [{ name: 'Blue Note', catno: 'C2', id: 2, resource_url: '' }],
      formats: [{ name: 'LP', qty: '1', descriptions: ['Album'] }],
      artists: [artist({ name: 'Herbie Hancock' })],
    },
  }),
]

const SETTINGS_KEY = 'vinyl-vault:settings'
const VIEWS_KEY = 'vinyl-vault:views'

const rockView = createSavedView('Rock records', '', { ...DEFAULT_FILTERS, genre: 'Rock' }, 'rock')
const lpView = createSavedView('LPs only', '', { ...DEFAULT_FILTERS, format: 'LP' }, 'lp')

function seedSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ username: 'alice', token: 'tok', theme: 'midnight' }),
  )
}

function seedViews(views: SavedView[]) {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views))
}

function storedViews(): unknown[] {
  return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '[]')
}

/** The running totals line, e.g. "2 artists · 2 releases · 2 unique albums". */
const summary = () => screen.getByText(/artists? ·/)

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByText('Moving Pictures')
  return user
}

/** FilterPanel lists genre first; the dropdowns carry no accessible name. */
const genreSelect = () => screen.getAllByRole('combobox')[0]

describe('saved views', () => {
  beforeEach(() => {
    localStorage.clear()
    seedSettings()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('applies a stored view and reports it in the toolbar', async () => {
    seedViews([rockView])
    const user = await renderApp()

    expect(summary()).toHaveTextContent('2 artists · 2 releases · 2 unique albums')

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.click(screen.getByRole('button', { name: /^Rock records/ }))

    // Genre Rock keeps only the Rush release.
    expect(summary()).toHaveTextContent('1 artist · 1 release · 1 unique album')
    expect(screen.queryByText('Headhunters')).toBeNull()
    // The button now names the view in use, and nothing was rewritten on disk.
    expect(
      screen.getByRole('button', { name: 'Saved views — Rock records in use' }),
    ).toBeInTheDocument()
    expect(storedViews()).toEqual([rockView])
  })

  it('closes the panel again when the toolbar button is pressed', async () => {
    seedViews([rockView])
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    expect(screen.getByRole('button', { name: /^Rock records/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    expect(screen.queryByRole('button', { name: /^Rock records/ })).toBeNull()
    expect(summary()).toHaveTextContent('2 artists · 2 releases · 2 unique albums')
  })

  it('dismisses the panel on Escape and on a click elsewhere', async () => {
    seedViews([rockView])
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: /^Rock records/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.click(screen.getByLabelText('Search collection'))
    expect(screen.queryByRole('button', { name: /^Rock records/ })).toBeNull()
  })

  it('shows how many releases each view would match', async () => {
    seedViews([rockView, lpView])
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    const rockRow = screen.getByRole('button', { name: /^Rock records/ }).closest('li')
    const lpRow = screen.getByRole('button', { name: /^LPs only/ }).closest('li')
    expect(rockRow).toHaveTextContent('1')
    expect(lpRow).toHaveTextContent('2')
  })

  it('goes back to everything from the views panel', async () => {
    seedViews([rockView, lpView])
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.click(screen.getByRole('button', { name: /^Rock records/ }))
    expect(summary()).toHaveTextContent('1 artist · 1 release · 1 unique album')

    await user.click(screen.getByRole('button', { name: 'Saved views — Rock records in use' }))
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    expect(summary()).toHaveTextContent('2 artists · 2 releases · 2 unique albums')
    expect(screen.getByText('Headhunters')).toBeInTheDocument()
  })

  it('leaves the sort preference alone, as a view is only a selection', async () => {
    seedViews([rockView])
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'A–Z' }))
    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.click(screen.getByRole('button', { name: /^Rock records/ }))

    expect(screen.getByRole('button', { name: 'A–Z' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Year' })).not.toHaveClass('active')
  })

  it('marks a hand-edited view as changed, and can update or revert it', async () => {
    seedViews([rockView])
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.click(screen.getByRole('button', { name: /^Rock records/ }))

    await user.type(screen.getByLabelText('Search collection'), 'rush')
    expect(
      screen.getByRole('button', {
        name: 'Saved views — Rock records in use, changed since saving',
      }),
    ).toHaveClass('edited')

    await user.click(
      screen.getByRole('button', {
        name: 'Saved views — Rock records in use, changed since saving',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Update view' }))
    expect(storedViews()).toEqual([{ ...rockView, query: 'rush' }])
    expect(screen.getByRole('button', { name: 'Saved views — Rock records in use' })).not.toHaveClass(
      'edited',
    )

    await user.type(screen.getByLabelText('Search collection'), 'jazz')
    await user.click(
      screen.getByRole('button', {
        name: 'Saved views — Rock records in use, changed since saving',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Revert' }))
    expect(storedViews()).toEqual([{ ...rockView, query: 'rush' }])
    expect(screen.getByLabelText('Search collection')).toHaveValue('rush')
  })

  it('saves, renames and deletes a view, persisting every step', async () => {
    seedViews([])
    const user = await renderApp()

    // With no search and no filters there is nothing to remember, so the save
    // button stays out of reach however the view is named.
    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.type(
      screen.getByLabelText('Save the current search & filters as a view'),
      'Nothing yet',
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    // Narrow the collection by hand, and the same button comes alive.
    await user.click(screen.getByRole('button', { name: 'Filter the collection' }))
    await user.selectOptions(genreSelect(), 'Jazz')
    await user.click(screen.getByRole('button', { name: 'Filter the collection' }))
    expect(summary()).toHaveTextContent('1 artist · 1 release · 1 unique album')

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.type(
      screen.getByLabelText('Save the current search & filters as a view'),
      'Jazz heads',
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Saving leaves the collection exactly as it was.
    expect(summary()).toHaveTextContent('1 artist · 1 release · 1 unique album')

    const [saved] = storedViews() as SavedView[]
    expect(saved.name).toBe('Jazz heads')
    expect(saved.query).toBe('')
    expect(saved.filters).toEqual({ ...DEFAULT_FILTERS, genre: 'Jazz' })

    await user.click(screen.getByRole('button', { name: 'Rename Jazz heads' }))
    await user.clear(screen.getByLabelText('Rename Jazz heads'))
    await user.type(screen.getByLabelText('Rename Jazz heads'), 'Jazz only{Enter}')
    expect((storedViews() as SavedView[])[0].name).toBe('Jazz only')

    await user.click(screen.getByRole('button', { name: 'Delete Jazz only' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(storedViews()).toEqual([])
    expect(screen.getByText('0 saved')).toBeInTheDocument()
  })

  it('offers a way out when a view matches nothing', async () => {
    seedViews([createSavedView('Dead end', 'nothing matches this', DEFAULT_FILTERS, 'dead')])
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.click(screen.getByRole('button', { name: /^Dead end/ }))
    // The search box is debounced, so the grid settles a moment later.
    expect(await screen.findByText('Nothing matches “Dead end”.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all releases' }))
    expect(await screen.findByText('Headhunters')).toBeInTheDocument()
  })

  it('drops the saved views along with everything else on "clear everything"', async () => {
    seedViews([rockView, lpView])
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Advanced' }))
    await user.click(await screen.findByRole('button', { name: 'Clear everything' }))

    await waitFor(() => expect(localStorage.getItem(VIEWS_KEY)).toBeNull())
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull()
  })
})