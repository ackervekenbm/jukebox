// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { Ref } from 'react'
import type { ArtistSortMode, Filters, ViewMode } from '../utils/collection'
import type { SavedView } from '../utils/views'
import { FiltersButton } from './FilterMenu'
import { SearchBar } from './SearchBar'
import { SegmentedControl, type SegmentOption } from './SegmentedControl'
import { ARTIST_SORT_OPTIONS } from './sortOptions'
import { ViewsButton } from './ViewsMenu'

const VIEW_OPTIONS: readonly SegmentOption<ViewMode>[] = [
  { value: 'artists', label: 'Artists', title: "One card per release, on each artist's shelf" },
  { value: 'recent', label: 'Recent', title: 'A timeline of additions, newest month first' },
]

interface ToolbarProps {
  ref?: Ref<HTMLDivElement>
  query: string
  onQueryChange: (query: string) => void
  filters: Filters
  filtersOpen: boolean
  onToggleFilters: () => void
  views: SavedView[]
  activeView: SavedView | null
  viewDirty: boolean
  viewsOpen: boolean
  onToggleViews: () => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  sortMode: ArtistSortMode
  onSortModeChange: (mode: ArtistSortMode) => void
}

/** Search, the filter and view menus, and the view and sort switches above the listing. */
export function Toolbar({
  ref,
  query,
  onQueryChange,
  filters,
  filtersOpen,
  onToggleFilters,
  views,
  activeView,
  viewDirty,
  viewsOpen,
  onToggleViews,
  viewMode,
  onViewModeChange,
  sortMode,
  onSortModeChange,
}: ToolbarProps) {
  return (
    <div className="toolbar" ref={ref}>
      <SearchBar value={query} onChange={onQueryChange} />
      <FiltersButton filters={filters} open={filtersOpen} onToggle={onToggleFilters} />
      <ViewsButton views={views} activeView={activeView} dirty={viewDirty} open={viewsOpen} onToggle={onToggleViews} />
      <div className="global-view">
        <span className="global-sort-label">View</span>
        <SegmentedControl
          kind="radio"
          aria-label="Collection view"
          options={VIEW_OPTIONS}
          value={viewMode}
          onChange={onViewModeChange}
        />
      </div>
      {viewMode !== 'recent' && (
        <div className="global-sort">
          <span className="global-sort-label">Sort</span>
          <SegmentedControl
            kind="toggle"
            aria-label="Sort releases by"
            options={ARTIST_SORT_OPTIONS}
            value={sortMode}
            onChange={onSortModeChange}
          />
        </div>
      )}
    </div>
  )
}
