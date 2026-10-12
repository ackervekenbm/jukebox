// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { artist, release } from './test/factories'
import type { DiscogsCollectionRelease } from './types/discogs'

// The API is stubbed: these tests are about how the grid reshapes itself, not
// about talking to Discogs.
const api = vi.hoisted(() => ({ releases: [] as DiscogsCollectionRelease[] }))

vi.mock('./api/discogs', () => ({
  DiscogsError: class extends Error {},
  fetchFolders: vi.fn(async () => []),
  fetchCollection: vi.fn(async () => ({
    releases: api.releases,
    items: api.releases.length,
  })),
  fetchCollectionValue: vi.fn(async () => null),
  fetchReleaseTracklist: vi.fn(async () => ({ tracks: [] })),
  fetchMasterYears: vi.fn(async () => ({})),
}))

const basic = release().basic_information

api.releases = [
  // Rush — Moving Pictures, two pressings of the same master.
  release({
    id: 1,
    instance_id: 1,
    date_added: '2023-01-01T10:00:00Z',
    basic_information: {
      ...basic,
      master_id: 11,
      title: 'Moving Pictures',
      year: 1981,
      country: 'US',
      artists: [artist({ name: 'Rush' })],
      labels: [{ name: 'Moon', catno: 'M-1', id: 1, resource_url: '' }],
      formats: [{ name: 'LP', qty: '1', descriptions: ['Album'] }],
    },
  }),
  release({
    id: 3,
    instance_id: 3,
    date_added: '2023-02-01T10:00:00Z',
    basic_information: {
      ...basic,
      master_id: 11,
      title: 'Moving Pictures',
      year: 1983,
      country: 'UK',
      artists: [artist({ name: 'Rush' })],
      labels: [{ name: 'Moon', catno: 'M-2', id: 1, resource_url: '' }],
      formats: [{ name: 'LP', qty: '1', descriptions: ['Album'] }],
    },
  }),
  // Rush — a second album, deliberately dated later than its title sorts, so
  // chronological and A–Z order disagree.
  release({
    id: 4,
    instance_id: 4,
    date_added: '2023-03-01T10:00:00Z',
    basic_information: {
      ...basic,
      master_id: 14,
      title: 'Caress of Steel',
      year: 1990,
      country: 'CA',
      artists: [artist({ name: 'Rush' })],
      labels: [{ name: 'Moon', catno: 'M-3', id: 1, resource_url: '' }],
      formats: [{ name: 'LP', qty: '1', descriptions: ['Album'] }],
    },
  }),
  // Herbie Hancock — a lone pressing.
  release({
    id: 2,
    instance_id: 2,
    date_added: '2023-04-01T10:00:00Z',
    basic_information: {
      ...basic,
      master_id: 22,
      title: 'Headhunters',
      year: 1973,
      country: 'US',
      artists: [artist({ name: 'Herbie Hancock' })],
      genres: ['Jazz'],
      labels: [{ name: 'Blue Note', catno: 'BN-1', id: 2, resource_url: '' }],
      formats: [{ name: 'LP', qty: '1', descriptions: ['Album'] }],
    },
  }),
]

const SETTINGS_KEY = 'vinyl-vault:settings'
const PREFS_KEY = 'vinyl-vault:prefs'

function seedSettings(overrides: Record<string, unknown> = {}) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ username: 'alice', token: 'tok', theme: 'midnight', ...overrides }),
  )
}

function seedGrouping(groupPressings: boolean) {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ groupPressings }))
}

const summary = () => screen.getByText(/artists? ·/)

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByText('Moving Pictures')
  return user
}

describe('grouped pressings', () => {
  beforeEach(() => {
    localStorage.clear()
    seedSettings()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('offers only Artists and Recent views, one card per release by default', async () => {
    await renderApp()

    expect(screen.queryByRole('radio', { name: 'Albums' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Artists' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // Both pressings of Moving Pictures have their own card, no stack badge.
    expect(screen.getAllByText('Moving Pictures')).toHaveLength(2)
    expect(screen.queryByText('2 pressings')).toBeNull()
    expect(summary()).toHaveTextContent('2 artists · 4 releases · 3 unique albums')
  })

  it('collapses pressings into one stacked card when the setting is on', async () => {
    seedGrouping(true)
    await renderApp()

    expect(screen.getAllByText('Moving Pictures')).toHaveLength(1)
    expect(screen.getByText('2 pressings')).toBeInTheDocument()
    // The stack's label says how deep it is, for screen readers.
    expect(screen.getByRole('button', { name: 'Rush — Moving Pictures, 2 pressings' })).toBeInTheDocument()
    // A lone pressing keeps its own card and gains no badge.
    expect(screen.queryByText('1 pressing')).toBeNull()
    expect(screen.getByText('Headhunters')).toBeInTheDocument()
    // The shelf still counts pressings and unique albums.
    expect(screen.getByText('3 releases · 2 unique albums')).toBeInTheDocument()
  })

  it('opens the stack at the earliest pressing and steps with the arrows', async () => {
    seedGrouping(true)
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Rush — Moving Pictures, 2 pressings' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('US')).toBeInTheDocument()
    expect(within(dialog).getByText('Pressing 1 of 2')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Next pressing' }))
    expect(within(dialog).getByText('UK')).toBeInTheDocument()
    expect(within(dialog).queryByText('US')).toBeNull()
    expect(within(dialog).getByText('Pressing 2 of 2')).toBeInTheDocument()

    // Wraps around at the end, and back again from the start.
    await user.click(within(dialog).getByRole('button', { name: 'Next pressing' }))
    expect(within(dialog).getByText('Pressing 1 of 2')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Previous pressing' }))
    expect(within(dialog).getByText('Pressing 2 of 2')).toBeInTheDocument()
  })

  it('steps through the stack with the arrow keys', async () => {
    seedGrouping(true)
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Rush — Moving Pictures, 2 pressings' }))
    await screen.findByRole('dialog')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('Pressing 2 of 2')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('Pressing 1 of 2')).toBeInTheDocument()
  })

  it('shows no stack navigation for a lone pressing', async () => {
    seedGrouping(true)
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Herbie Hancock — Headhunters' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(/Pressing \d+ of \d+/)).toBeNull()
  })

  it('reorders stacked cards with the Year / A–Z toggle', async () => {
    seedGrouping(true)
    const user = await renderApp()

    const rushTitles = () =>
      screen
        .getAllByRole('button')
        .map((el) => el.ariaLabel ?? '')
        .filter((label) => label.startsWith('Rush'))

    // Chronological: Moving Pictures (1981) leads Caress of Steel (1990).
    expect(rushTitles()).toEqual(['Rush — Moving Pictures, 2 pressings', 'Rush — Caress of Steel'])

    await user.click(screen.getByRole('button', { name: 'A–Z' }))
    expect(rushTitles()).toEqual(['Rush — Caress of Steel', 'Rush — Moving Pictures, 2 pressings'])
  })

  it('toggles grouping from settings and persists the preference', async () => {
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByLabelText(/Group pressings by master/))
    await user.click(screen.getByRole('button', { name: 'Close settings' }))

    expect(screen.getAllByText('Moving Pictures')).toHaveLength(1)
    expect(localStorage.getItem(PREFS_KEY)).toBe('{"groupPressings":true}')

    // The choice survives reopening the settings panel.
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByLabelText(/Group pressings by master/)).toBeChecked()
  })

  it('clears the grouping preference with "clear everything"', async () => {
    seedGrouping(true)
    const user = await renderApp()
    expect(screen.getAllByText('Moving Pictures')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Advanced' }))
    await user.click(await screen.findByRole('button', { name: 'Clear everything' }))

    await waitFor(() => expect(localStorage.getItem(PREFS_KEY)).toBeNull())
    expect(await screen.findByLabelText(/Discogs username/)).toBeInTheDocument()
  })
})
