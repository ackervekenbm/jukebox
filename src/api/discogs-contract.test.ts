// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCollection,
  fetchCollectionValue,
  fetchFolders,
  fetchMasterYears,
  fetchReleaseTracklist,
} from './discogs'
import type {
  DiscogsCollectionFolderResponse,
  DiscogsFoldersResponse,
  DiscogsMaster,
  DiscogsRelease,
} from '../types/discogs'

// Real responses captured from the Discogs API by
// scripts/refresh-discogs-fixtures.mjs. These tests are hermetic: `fetch` is
// mocked below, so CI never touches the network. When the fixtures are absent
// (before the first refresh) every suite skips, keeping the required `check`
// green — run `npm run fixtures` locally or let the nightly
// discogs-contract workflow populate them.
const FIXTURE_PREFIX = '/src/test/fixtures/discogs/'
const raw = import.meta.glob('/src/test/fixtures/discogs/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

function fixture(name: string): unknown {
  return raw[`${FIXTURE_PREFIX}${name}`]
}

const foldersFixture = fixture('folders.json')
const collectionFixture = fixture('collection-page.json')
const valueFixture = fixture('collection-value.json')

const collectionSample = collectionFixture as DiscogsCollectionFolderResponse | undefined
const releaseId = collectionSample?.releases[0]?.id
const releaseFixture = releaseId !== undefined ? fixture(`release-${releaseId}.json`) : undefined
const masterYears: { id: number; data?: DiscogsMaster }[] = [
  ...new Set(
    (collectionSample?.releases ?? [])
      .map((release) => release.basic_information.master_id)
      .filter((id): id is number => id !== null && typeof id === 'number'),
  ),
]
  .slice(0, 2)
  .map((id) => ({ id, data: fixture(`master-${id}.json`) as DiscogsMaster | undefined }))
  .filter((entry) => entry.data !== undefined)

if (!collectionFixture) {
  console.info(
    'Discogs contract fixtures not present — run `DISCOGS_TOKEN=... npm run fixtures` ' +
      'or let the nightly discogs-contract workflow generate them.',
  )
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const result = handler(url, init)
      return result instanceof Promise ? result : Promise.resolve(result)
    }),
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe.skipIf(!foldersFixture)('Discogs contract: folders', () => {
  it('parses a real folders payload into the app shape', async () => {
    const data = foldersFixture as DiscogsFoldersResponse
    mockFetch(() => json(data))

    const folders = await fetchFolders('alice', 'tok')

    expect(folders).toEqual(data.folders)
    expect(folders.length).toBeGreaterThan(0)
    for (const folder of folders) {
      expect(typeof folder.id).toBe('number')
      expect(typeof folder.name).toBe('string')
      expect(folder.name.trim().length).toBeGreaterThan(0)
      expect(typeof folder.count).toBe('number')
    }
  })
})

describe.skipIf(!collectionFixture)('Discogs contract: collection page', () => {
  it('parses a real collection page and stops after one page', async () => {
    const data = collectionFixture as DiscogsCollectionFolderResponse
    expect(data.releases.length).toBeGreaterThan(0)
    mockFetch(() => json(data))
    const onProgress = vi.fn()

    const result = await fetchCollection('alice', 'tok', onProgress)

    expect(result.releases).toEqual(data.releases)
    expect(result.items).toBe(data.pagination.items)
    expect(onProgress).toHaveBeenCalledTimes(1)
    for (const release of result.releases) {
      expect(typeof release.id).toBe('number')
      expect(typeof release.instance_id).toBe('number')
      expect(release.basic_information.title.trim().length).toBeGreaterThan(0)
      expect(release.basic_information.artists.length).toBeGreaterThan(0)
      expect(typeof release.basic_information.year).toBe('number')
    }
  })
})

describe.skipIf(masterYears.length === 0)('Discogs contract: master years', () => {
  it('resolves an integer year for each real master', async () => {
    const ids = masterYears.map(({ id }) => id)
    mockFetch((url: string) => {
      const match = /\/masters\/(\d+)$/.exec(url)
      const id = match ? Number(match[1]) : 0
      const master = masterYears.find((entry) => entry.id === id)?.data
      return master ? json(master) : json({ message: 'Not found' })
    })

    const promise = fetchMasterYears(ids, 'tok')
    await vi.advanceTimersByTimeAsync(200)

    const result = await promise
    expect(Object.keys(result)).toHaveLength(ids.length)
    for (const id of ids) {
      const year = result[id]
      const master = masterYears.find((entry) => entry.id === id)?.data
      expect(typeof year).toBe('number')
      expect(year).toBe(master?.year)
      expect(Number.isInteger(year)).toBe(true)
      expect(year).toBeGreaterThan(1800)
    }
  })
})

describe.skipIf(releaseFixture === undefined)('Discogs contract: release tracklist', () => {
  it('parses the real release tracklist', async () => {
    const data = releaseFixture as DiscogsRelease
    mockFetch(() => json(data))

    const tracks = await fetchReleaseTracklist(data.id, 'tok')

    expect(tracks).toEqual(data.tracklist)
    expect(tracks.length).toBeGreaterThan(0)
    for (const track of tracks) {
      expect(typeof track.position).toBe('string')
      expect(track.title.trim().length).toBeGreaterThan(0)
      expect(typeof track.duration).toBe('string')
    }
  })
})

describe.skipIf(!valueFixture)('Discogs contract: collection value', () => {
  // Mirrors the app's moneyString normalization so the assertion matches how
  // the figure is actually rendered (trimmed strings, locale-formatted numbers).
  function display(figure: unknown): string {
    if (typeof figure === 'number') return figure.toLocaleString()
    if (typeof figure === 'string') return figure.trim()
    return ''
  }

  it('normalizes the real value payload into display strings', async () => {
    const data = valueFixture as Record<string, unknown>
    mockFetch(() => json(data))

    const value = await fetchCollectionValue('alice', 'tok')

    expect(value).toEqual({
      minimum: display(data.minimum),
      median: display(data.median),
      maximum: display(data.maximum),
    })
    for (const figure of Object.values(value)) expect(typeof figure).toBe('string')
  })
})