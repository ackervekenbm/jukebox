// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { clearListenLog } from './db/listenLog'
import { artist, release } from './test/factories'
import type { DiscogsCollectionFolder, DiscogsCollectionRelease } from './types/discogs'

// The API is stubbed: these tests are about what the folder chips select, not
// about talking to Discogs.
const api = vi.hoisted(() => ({
  releases: [] as DiscogsCollectionRelease[],
  folders: [] as DiscogsCollectionFolder[],
}))

vi.mock('./api/discogs', () => ({
  DiscogsError: class extends Error {},
  fetchFolders: vi.fn(async () => api.folders),
  fetchCollection: vi.fn(async () => ({
    releases: api.releases,
    items: api.releases.length,
  })),
  fetchCollectionValue: vi.fn(async () => null),
  fetchReleaseTracklist: vi.fn(async () => ({ tracks: [] })),
  fetchMasterYears: vi.fn(async () => ({})),
}))

const basic = release().basic_information

function inFolder(folderId: number, id: number, title: string, artistName: string) {
  return release({
    id,
    instance_id: id,
    folder_id: folderId,
    basic_information: {
      ...basic,
      master_id: 100 + id,
      title,
      artists: [artist({ name: artistName })],
    },
  })
}

api.releases = [
  inFolder(7, 1, 'Moving Pictures', 'Rush'),
  inFolder(7, 2, 'Selected Ambient Works', 'Aphex Twin'),
  inFolder(9, 3, 'Headhunters', 'Herbie Hancock'),
  inFolder(1, 4, 'Endtroducing', 'DJ Shadow'),
]

api.folders = [
  { id: 0, name: 'All', count: 4 },
  { id: 1, name: 'Uncategorized', count: 1 },
  { id: 7, name: 'Bram', count: 2 },
  { id: 9, name: 'Laura', count: 1 },
]

const SETTINGS_KEY = 'vinyl-vault:settings'

const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const summary = () => screen.getByText(/artists? ·/)

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByText('Moving Pictures')
  return user
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ username: 'alice', token: 'tok', theme: 'midnight' }),
  )
  await clearListenLog()
})

afterEach(() => {
  localStorage.clear()
})

describe('folder chips are multi-select', () => {
  it('starts on "All" with no folder pressed', async () => {
    await renderApp()

    expect(chip('All')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Bram')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('Laura')).toHaveAttribute('aria-pressed', 'false')
    expect(summary()).toHaveTextContent('4 releases')
  })

  it('selects one folder, then adds another to the same listing', async () => {
    const user = await renderApp()

    await user.click(chip('Bram'))
    expect(chip('Bram')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('All')).toHaveAttribute('aria-pressed', 'false')
    expect(summary()).toHaveTextContent('2 releases')
    expect(screen.queryByText('Headhunters')).toBeNull()

    await user.click(chip('Laura'))
    expect(chip('Bram')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Laura')).toHaveAttribute('aria-pressed', 'true')
    expect(summary()).toHaveTextContent('3 releases')
    expect(screen.getByText('Headhunters')).toBeInTheDocument()
    expect(screen.getByText('Moving Pictures')).toBeInTheDocument()
    // Outside the selection.
    expect(screen.queryByText('Endtroducing')).toBeNull()
  })

  it('switches a folder off again, and the last one off returns to All', async () => {
    const user = await renderApp()

    await user.click(chip('Bram'))
    await user.click(chip('Laura'))
    await user.click(chip('Bram'))

    expect(chip('Bram')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('Laura')).toHaveAttribute('aria-pressed', 'true')
    expect(summary()).toHaveTextContent('1 release')
    expect(screen.queryByText('Moving Pictures')).toBeNull()

    await user.click(chip('Laura'))
    expect(chip('All')).toHaveAttribute('aria-pressed', 'true')
    expect(summary()).toHaveTextContent('4 releases')
  })

  it('clears the selection when "All" is clicked', async () => {
    const user = await renderApp()

    await user.click(chip('Bram'))
    await user.click(chip('Laura'))
    await user.click(chip('All'))

    expect(chip('All')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Bram')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('Laura')).toHaveAttribute('aria-pressed', 'false')
    expect(summary()).toHaveTextContent('4 releases')
  })

  it('searches across the union of the selected folders', async () => {
    const user = await renderApp()

    await user.click(chip('Bram'))
    await user.click(chip('Laura'))
    await user.type(screen.getByLabelText('Search collection'), 'hancock')

    await waitFor(() => expect(screen.queryByText('Moving Pictures')).toBeNull())
    expect(screen.getByText('Headhunters')).toBeInTheDocument()
  })

  it('random-picks only from the selected folders', async () => {
    const user = await renderApp()

    await user.click(chip('Laura'))
    await user.click(
      screen.getByRole('button', { name: "Pick a random release from what's shown" }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Herbie Hancock — Headhunters')
  })
})
