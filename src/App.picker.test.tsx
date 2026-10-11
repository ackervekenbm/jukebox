// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { clearListenLog, getListenLog } from './db/listenLog'
import { artist, release } from './test/factories'
import type { DiscogsCollectionRelease } from './types/discogs'

// The API is stubbed: these tests are about picking and logging, not Discogs.
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
  release({
    id: 1,
    instance_id: 1,
    basic_information: {
      ...basic,
      master_id: 11,
      title: 'Moving Pictures',
      year: 1981,
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
      artists: [artist({ name: 'Herbie Hancock' })],
    },
  }),
  release({
    id: 3,
    instance_id: 3,
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
const PICKER_KEY = 'vinyl-vault:picker'

function seedSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ username: 'alice', token: 'tok', theme: 'midnight' }),
  )
}

const fab = () =>
  screen.getByRole('button', { name: "Pick a random release from what's shown" })

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByText('Moving Pictures')
  return user
}

beforeEach(async () => {
  // localStorage resets per test; the listen log lives in IndexedDB, which
  // fake-indexeddb keeps for the whole file, so clear it explicitly.
  localStorage.clear()
  seedSettings()
  await clearListenLog()
})
afterEach(() => {
  localStorage.clear()
})

describe('random picker listen log', () => {
  it('logs every pick and shows the earlier ones in the detail view', async () => {
    const user = await renderApp()

    await user.click(fab())
    const first = (await screen.findByRole('dialog')).getAttribute('aria-label') ?? ''
    // The log holds only this release so far, and history excludes it.
    expect(screen.queryByText('Recent picks')).toBeNull()

    // Re-roll from the open detail view: also a logged pick, and the skip
    // window (default 10 over a 3-release collection) forces a different one.
    await user.click(fab())
    const second = screen.getByRole('dialog').getAttribute('aria-label') ?? ''
    expect(second).not.toBe(first)

    const history = screen.getByText('Recent picks')
    const list = history.closest('.detail-section')
    expect(list).not.toBeNull()
    const [historyButton] = within(list as HTMLElement).getAllByRole('button')
    expect(historyButton).toHaveTextContent(first)
    expect(historyButton).toHaveTextContent('just now')

    const log = await getListenLog('alice')
    expect(log).toHaveLength(2)
    expect(new Set(log.map((entry) => entry.id)).size).toBe(2)

    // Hopping through the history swaps releases without logging a listen.
    await user.click(historyButton)
    expect(screen.getByRole('dialog')).toHaveAccessibleName(first)
    await waitFor(async () => expect(await getListenLog('alice')).toHaveLength(2))
  })

  it('shows no history when a release is opened from the grid', async () => {
    const user = await renderApp()

    await user.click(fab())
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Close release details' }))

    await user.click(screen.getByRole('button', { name: 'Rush — Moving Pictures' }))
    await screen.findByRole('dialog')
    expect(screen.queryByText('Recent picks')).toBeNull()
  })

  it('persists the skip window from settings, clamped to the safe range', async () => {
    await renderApp()

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const input = screen.getByLabelText(/Skip the last/)
    expect(input).toHaveValue(10)

    fireEvent.change(input, { target: { value: '25' } })
    expect(input).toHaveValue(25)
    expect(JSON.parse(localStorage.getItem(PICKER_KEY) ?? 'null')).toEqual({ skip: 25 })

    fireEvent.change(input, { target: { value: '999' } })
    expect(input).toHaveValue(100)
    expect(JSON.parse(localStorage.getItem(PICKER_KEY) ?? 'null')).toEqual({ skip: 100 })

    fireEvent.change(input, { target: { value: '0' } })
    expect(JSON.parse(localStorage.getItem(PICKER_KEY) ?? 'null')).toEqual({ skip: 0 })
    expect(input).toHaveValue(0)
  })

  it('clears the listen log and the picker preference with "clear everything"', async () => {
    const user = await renderApp()

    await user.click(fab())
    await user.click(fab())
    expect(await getListenLog('alice')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Close release details' }))
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Advanced' }))
    await user.click(await screen.findByRole('button', { name: 'Clear everything' }))

    await waitFor(async () => expect(await getListenLog('alice')).toEqual([]))
    expect(localStorage.getItem(PICKER_KEY)).toBeNull()
    // The account is gone, so the setup form asks for credentials again.
    expect(screen.getByLabelText(/Discogs username/)).toBeInTheDocument()
  })
})
