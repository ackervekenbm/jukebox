// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { artist, release } from './test/factories'
import type { DiscogsCollectionRelease } from './types/discogs'

// The API is stubbed: these tests are about how the timeline reshapes itself,
// not about talking to Discogs.
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

/** An ISO timestamp that falls on this local calendar date (machine-TZ safe). */
const addedAt = (year: number, month: number, day = 15) =>
  new Date(year, month - 1, day, 12).toISOString()
const monthLabel = (year: number, month: number) =>
  new Date(year, month - 1, 15).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

api.releases = [
  release({
    id: 1,
    instance_id: 1,
    date_added: addedAt(2024, 5, 2),
    basic_information: {
      ...basic,
      master_id: 11,
      title: 'Moving Pictures',
      year: 1981,
      artists: [artist({ name: 'Rush' })],
    },
  }),
  release({
    id: 3,
    instance_id: 3,
    date_added: addedAt(2024, 3, 10),
    basic_information: {
      ...basic,
      master_id: 11,
      title: 'Moving Pictures',
      year: 1983,
      artists: [artist({ name: 'Rush' })],
    },
  }),
  release({
    id: 4,
    instance_id: 4,
    date_added: addedAt(2023, 11, 20),
    basic_information: {
      ...basic,
      master_id: 14,
      title: 'Caress of Steel',
      year: 1990,
      artists: [artist({ name: 'Rush' })],
    },
  }),
  release({
    id: 2,
    instance_id: 2,
    date_added: addedAt(2024, 5, 15),
    basic_information: {
      ...basic,
      master_id: 22,
      title: 'Headhunters',
      year: 1973,
      artists: [artist({ name: 'Herbie Hancock' })],
    },
  }),
  release({
    id: 5,
    instance_id: 5,
    date_added: '',
    basic_information: {
      ...basic,
      master_id: 33,
      title: 'Lost tapes',
      year: 2001,
      artists: [artist({ name: 'DJ Shadow' })],
    },
  }),
]

const SETTINGS_KEY = 'vinyl-vault:settings'

function seedSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ username: 'alice', token: 'tok', theme: 'midnight' }),
  )
}

const summary = () => screen.getByText(/artists? ·/)

const viewRadio = (name: 'Artists' | 'Albums' | 'Recent') => screen.getByRole('radio', { name })

const monthHeadings = () =>
  screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)

const cardTitles = () =>
  screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByText('Moving Pictures')
  return user
}

describe('recent view', () => {
  beforeEach(() => {
    localStorage.clear()
    seedSettings()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('starts in Artists mode and flips the timeline on with Recent', async () => {
    const user = await renderApp()

    expect(viewRadio('Recent')).toHaveAttribute('aria-checked', 'false')
    await user.click(viewRadio('Recent'))

    expect(viewRadio('Recent')).toHaveAttribute('aria-checked', 'true')
    expect(monthHeadings()).toEqual([
      monthLabel(2024, 5),
      monthLabel(2024, 3),
      monthLabel(2023, 11),
      'Undated',
    ])
    // Newest addition first, month by month, artist credited on every card.
    expect(cardTitles()).toEqual([
      'Headhunters',
      'Moving Pictures',
      'Moving Pictures',
      'Caress of Steel',
      'Lost tapes',
    ])
    expect(screen.getAllByText('Rush')).toHaveLength(3)
    expect(summary()).toHaveTextContent('3 artists · 5 releases · 4 unique albums')
  })

  it('hides the sort control while the timeline is on, restores it after', async () => {
    const user = await renderApp()

    await user.click(viewRadio('Recent'))
    expect(screen.queryByRole('group', { name: 'Sort releases by' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'A–Z' })).toBeNull()

    await user.click(viewRadio('Artists'))
    expect(screen.getByRole('group', { name: 'Sort releases by' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A–Z' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: monthLabel(2024, 5) })).toBeNull()
  })

  it('applies search to the timeline like any other view', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Recent'))

    await user.type(screen.getByLabelText('Search collection'), 'rush')

    await waitFor(() =>
      expect(summary()).toHaveTextContent('1 artist · 3 releases · 2 unique albums'),
    )
    expect(monthHeadings()).toEqual([
      monthLabel(2024, 5),
      monthLabel(2024, 3),
      monthLabel(2023, 11),
    ])
    expect(screen.queryByText('Headhunters')).toBeNull()
    expect(screen.queryByText('Undated')).toBeNull()
  })

  it('shows the shared empty state instead of empty month sections', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Recent'))

    await user.type(screen.getByLabelText('Search collection'), 'zzzz-no-match')

    await waitFor(() =>
      expect(screen.getByText('No releases match your search or filters.')).toBeInTheDocument(),
    )
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  it('opens a release straight from the timeline', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Recent'))

    await user.click(screen.getByRole('button', { name: 'Herbie Hancock — Headhunters' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Herbie Hancock — Headhunters')
    expect(within(dialog).getByText('Headhunters')).toBeInTheDocument()
  })

  it('returns to Artists mode for another account', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Recent'))

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const username = screen.getByLabelText('Discogs username')
    await user.clear(username)
    await user.type(username, 'bob')
    await user.click(screen.getByRole('button', { name: 'Load collection' }))

    expect(await screen.findAllByText('Moving Pictures')).toHaveLength(2)
    expect(viewRadio('Artists')).toHaveAttribute('aria-checked', 'true')
    expect(viewRadio('Recent')).toHaveAttribute('aria-checked', 'false')
  })
})
