// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type {
  DiscogsArtistRef,
  DiscogsCollectionRelease,
  DiscogsFormat,
} from '../types/discogs'
import type { DisplayRelease } from '../utils/collection'
import { makeSortKey } from '../utils/sortName'

export function artist(ref: Partial<DiscogsArtistRef> = {}): DiscogsArtistRef {
  return {
    id: 1,
    name: 'Test Artist',
    resource_url: '',
    anv: '',
    join: '',
    role: '',
    tracks: '',
    ...ref,
  }
}

export function release(
  override: Partial<DiscogsCollectionRelease> = {},
): DiscogsCollectionRelease {
  return {
    id: 100,
    instance_id: 1,
    date_added: '2020-01-01T00:00:00Z',
    rating: 4,
    basic_information: {
      id: 100,
      master_id: 900,
      master_url: 'https://api.discogs.com/masters/900',
      resource_url: 'https://api.discogs.com/releases/100',
      thumb: 'https://img.discogs.com/thumb.jpg',
      cover_image: 'https://img.discogs.com/cover.jpg',
      title: 'Test Album',
      year: 1985,
      genres: ['Rock'],
      styles: ['Indie Rock'],
      artists: [artist()],
      labels: [{ name: 'Test Label', catno: 'CAT-1', id: 1, resource_url: '' }],
      formats: [{ name: 'LP', qty: '1', descriptions: ['Album'] }],
    },
    ...override,
  }
}

interface FakeInput {
  artist: string
  title: string
  id?: number
  year?: number
  formatText?: string
  /** Raw formats; by default one format named like the start of formatText. */
  formats?: DiscogsFormat[]
}

let counter = 0

/** A collection record shaped for the shelf planner and the physical-facts checks. */
export function fakeRecord(input: FakeInput): DisplayRelease {
  const id = input.id ?? ++counter
  const year = input.year ?? 2020
  const formatText = input.formatText ?? 'Vinyl · 12" · LP'
  return {
    key: `${id}-${id}`,
    instanceId: id,
    id,
    title: input.title,
    titleKey: makeSortKey(input.title),
    year,
    originalYear: year,
    artistName: input.artist,
    genres: [],
    styles: [],
    labels: [],
    country: '',
    // Like real data: the format name is what the format text starts with.
    formatNames: [formatText.split(' · ')[0]],
    formatText,
    coverImage: '',
    thumb: '',
    release: {
      basic_information: {
        formats: input.formats ?? [{ name: formatText.split(' · ')[0], qty: '1' }],
      },
    } as unknown as DiscogsCollectionRelease,
    dateAdded: '2024-01-01T00:00:00-00:00',
  }
}
