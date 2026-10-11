// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { artist, release } from './test/factories'
import type { DiscogsCollectionRelease } from './types/discogs'
import { DEFAULT_FILTERS } from './utils/collection'
import { createSavedView } from './utils/views'

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
const VIEWS_KEY = 'vinyl-vault:views'

function seedSettings(overrides: Record<string, unknown> = {}) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ username: 'alice', token: 'tok', theme: 'midnight', ...overrides }),
  )
}

const summary = () => screen.getByText(/artists? ·/)

const viewRadio = (name: 'Artists' | 'Albums') => screen.getByRole('radio', { name })

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByText('Moving Pictures')
  return user
}

const albumButtons = () =>
  screen.getAllByRole('button').filter((el) => /^(Rush|Herbie Hancock) — /.test(el.ariaLabel ?? ''))

describe('albums view', () => {
  beforeEach(() => {
    localStorage.clear()
    seedSettings()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('starts in Artists mode, one card per pressing', async () => {
    await renderApp()

    expect(viewRadio('Artists')).toHaveAttribute('aria-checked', 'true')
    expect(viewRadio('Albums')).toHaveAttribute('aria-checked', 'false')
    expect(summary()).toHaveTextContent('2 artists · 4 releases · 3 unique albums')
    // Both pressings of Moving Pictures have their own card.
    expect(screen.getAllByText('Moving Pictures')).toHaveLength(2)
    // The artist shelf counts pressings and unique albums, as before.
    expect(screen.getByText('3 releases · 2 unique albums')).toBeInTheDocument()
  })

  it('collapses pressings into one album card when Albums is picked', async () => {
    const user = await renderApp()

    await user.click(viewRadio('Albums'))

    expect(viewRadio('Albums')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByText('Moving Pictures')).toHaveLength(1)
    expect(screen.getByText('2 pressings')).toBeInTheDocument()
    // A lone pressing keeps its own card but gains no badge or rows.
    expect(screen.queryByText('1 pressing')).toBeNull()
    expect(screen.getByText('Headhunters')).toBeInTheDocument()
    // The shelf now counts albums first; the summary line still describes the
    // filtered collection exactly as the issue requires.
    expect(screen.getByText('2 albums · 3 releases')).toBeInTheDocument()
    expect(screen.getByText('1 album · 1 release')).toBeInTheDocument()
    expect(summary()).toHaveTextContent('2 artists · 4 releases · 3 unique albums')
  })

  it('lists the pressings of an album on its card', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Albums'))

    // Exactly two pressing rows, both for Moving Pictures: the lone pressings
    // (Caress of Steel, Headhunters) get no rows at all.
    expect(
      screen.getAllByRole('button', { name: /^Open / }).map((el) => el.ariaLabel),
    ).toEqual([
      'Open Moving Pictures — 1981 · US · LP · Moon',
      'Open Moving Pictures — 1983 · UK · LP · Moon',
    ])
  })

  it('opens the earliest pressing from the card body', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Albums'))

    await user.click(screen.getByRole('button', { name: 'Rush — Moving Pictures' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Rush — Moving Pictures')
    expect(within(dialog).getByText('US')).toBeInTheDocument()
    expect(within(dialog).queryByText('UK')).toBeNull()
  })

  it('opens the exact pressing from its row', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Albums'))

    await user.click(
      screen.getByRole('button', { name: 'Open Moving Pictures — 1983 · UK · LP · Moon' }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('UK')).toBeInTheDocument()
    expect(within(dialog).queryByText('US')).toBeNull()
  })

  it('reorders album cards with the Year / A–Z toggle', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Albums'))

    const rushTitles = () =>
      albumButtons()
        .map((el) => el.ariaLabel ?? '')
        .filter((label) => label.startsWith('Rush'))

    // Chronological: Moving Pictures (1981) leads Caress of Steel (1990).
    expect(rushTitles()).toEqual(['Rush — Moving Pictures', 'Rush — Caress of Steel'])

    await user.click(screen.getByRole('button', { name: 'A–Z' }))
    expect(rushTitles()).toEqual(['Rush — Caress of Steel', 'Rush — Moving Pictures'])
  })

  it('keeps the albums view when a saved view is applied', async () => {
    localStorage.setItem(
      VIEWS_KEY,
      JSON.stringify([createSavedView('Rock records', '', { ...DEFAULT_FILTERS, genre: 'Rock' }, 'rock')]),
    )
    const user = await renderApp()

    await user.click(viewRadio('Albums'))
    await user.click(screen.getByRole('button', { name: 'Saved views' }))
    await user.click(screen.getByRole('button', { name: /^Rock records/ }))

    expect(viewRadio('Albums')).toHaveAttribute('aria-checked', 'true')
    // The selection narrowed (Herbie is Jazz), the grouping stayed put.
    expect(summary()).toHaveTextContent('1 artist · 3 releases · 2 unique albums')
  })

  it('goes back to Artists mode for another account', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Albums'))
    expect(viewRadio('Albums')).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const username = screen.getByLabelText('Discogs username')
    await user.clear(username)
    await user.type(username, 'bob')
    await user.click(screen.getByRole('button', { name: 'Load collection' }))

    expect(await screen.findAllByText('Moving Pictures')).toHaveLength(2)
    expect(viewRadio('Artists')).toHaveAttribute('aria-checked', 'true')
    expect(viewRadio('Albums')).toHaveAttribute('aria-checked', 'false')
  })

  it('collapses an artist shelf with the same keyboard-friendly header', async () => {
    const user = await renderApp()
    await user.click(viewRadio('Albums'))

    const header = screen.getByRole('button', { name: /2 albums · 3 releases/ })
    await user.click(header)
    expect(screen.queryByText('2 pressings')).toBeNull()

    await user.click(header)
    expect(screen.getByText('2 pressings')).toBeInTheDocument()
  })
})
