// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'
import { discogsBudget } from './api/rateLimit'
import { artist, release } from './test/factories'

// A sync stuck in the years phase: one year back, then nothing.
vi.mock('./api/discogs', () => ({
  DiscogsError: class extends Error {},
  fetchFolders: vi.fn(async () => []),
  fetchCollection: vi.fn(async () => ({
    releases: [
      release({
        id: 1,
        instance_id: 1,
        basic_information: { ...release().basic_information, master_id: 11, artists: [artist({ name: 'Rush' })] },
      }),
      release({
        id: 2,
        instance_id: 2,
        basic_information: { ...release().basic_information, master_id: 22, artists: [artist({ name: 'Yes' })] },
      }),
    ],
    items: 2,
  })),
  fetchCollectionValue: vi.fn(async () => null),
  fetchReleaseDetails: vi.fn(async () => ({ tracks: [], notes: '' })),
  fetchMasterYears: vi.fn(
    (_ids: number[], _token: string, onProgress?: (loaded: number, total: number) => void) => {
      onProgress?.(1, 2)
      return new Promise(() => {})
    },
  ),
}))


beforeEach(() => {
  localStorage.setItem(
    'vinyl-vault:settings',
    JSON.stringify({ username: 'alice', token: 'tok', theme: 'midnight' }),
  )
})

afterEach(() => {
  localStorage.clear()
  discogsBudget.reset()
})

describe('the sync banner', () => {
  it('announces the sync and why it waits, but not every step of the count', async () => {
    // A real 429 pause in the shared budget, with a request held behind it.
    discogsBudget.observe(new Response('{}', { status: 429, headers: { 'retry-after': '30' } }))
    void discogsBudget.acquire('interactive').catch(() => {})
    render(<App />)

    const announced = await screen.findByText(
      "Syncing… — pausing to stay within Discogs' rate limit",
    )
    expect(announced).toHaveAttribute('role', 'status')
    expect(announced).not.toHaveTextContent('1 / 2')
    expect(await screen.findByText(/Retrieving original release years… 1 \/ 2/)).toBeInTheDocument()
    expect(announced.closest('.sync-banner')).not.toHaveAttribute('aria-live')
  })
})
