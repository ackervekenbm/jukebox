// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

export interface DiscogsArtistRef {
  id: number
  name: string
  resource_url: string
  anv: string
  join: string
  role: string
  tracks: string
}

export interface DiscogsLabelRef {
  name: string
  catno: string
  id: number
  resource_url: string
}

export interface DiscogsFormat {
  name: string
  qty: string
  /** Free text next to the format, e.g. "180 g", "Red Marbled", sometimes "Gatefold". */
  text?: string
  descriptions?: string[]
}

export interface DiscogsBasicInformation {
  id: number
  master_id: number | null
  master_url: string | null
  resource_url: string
  thumb: string
  cover_image: string
  title: string
  year: number
  country?: string
  genres: string[]
  styles: string[]
  artists: DiscogsArtistRef[]
  labels: DiscogsLabelRef[]
  formats: DiscogsFormat[]
}

export interface DiscogsCollectionRelease {
  id: number
  instance_id: number
  folder_id?: number
  date_added: string
  rating: number
  basic_information: DiscogsBasicInformation
}

export interface DiscogsCollectionFolder {
  id: number
  name: string
  count: number
}

export interface DiscogsFoldersResponse {
  folders: DiscogsCollectionFolder[]
}

export interface DiscogsPagination {
  page: number
  pages: number
  per_page: number
  items: number
}

export interface DiscogsCollectionFolderResponse {
  pagination: DiscogsPagination
  releases: DiscogsCollectionRelease[]
}

export interface DiscogsMaster {
  id: number
  year: number
}

export interface DiscogsTrack {
  position: string
  type?: string
  title: string
  duration: string
  artists?: DiscogsArtistRef[]
  extraartists?: DiscogsArtistRef[]
}

export interface DiscogsRelease {
  id: number
  title: string
  year: number
  tracklist: DiscogsTrack[]
  /** Free-form release notes; often the only place a gatefold sleeve is mentioned. */
  notes?: string
}

/**
 * Discogs' own valuation of a whole collection, normalized for display.
 *
 * The wire response has no separate currency field: Discogs sends each figure
 * pre-formatted with the account's currency symbol baked in ("$1,737.04").
 * fetchCollectionValue trims those to strings and coerces the occasional
 * plain-number payload, and missing figures become an empty string.
 */
export interface CollectionValue {
  minimum: string
  median: string
  maximum: string
}