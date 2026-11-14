// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { ArtistSortMode } from '../utils/collection'
import type { SegmentOption } from './SegmentedControl'

/** The in-artist orders, shared by the main view and the cabinet so they read the same. */
export const ARTIST_SORT_OPTIONS: readonly SegmentOption<ArtistSortMode>[] = [
  { value: 'chronological', label: 'Year', title: 'Oldest to newest within each artist' },
  { value: 'byName', label: 'A–Z', title: 'By album name within each artist' },
]
