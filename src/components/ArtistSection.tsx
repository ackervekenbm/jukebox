// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useMemo, useState } from 'react'
import type {
  DisplayRelease,
  GroupedArtist,
  ArtistSortMode,
  ViewMode,
} from '../utils/collection'
import { countUniqueAlbums, groupPressings, sortPressingGroups } from '../utils/collection'
import { compareSortKeys } from '../utils/sortName'
import { ReleaseCard } from './ReleaseCard'
import { AlbumCard } from './AlbumCard'
import { ChevronIcon } from './icons'

interface ArtistSectionProps {
  artist: GroupedArtist
  sortMode: ArtistSortMode
  /** The Recent view has no shelves, so it never reaches this component. */
  viewMode: Exclude<ViewMode, 'recent'>
  onSelectRelease: (display: DisplayRelease) => void
}

export function ArtistSection({
  artist,
  sortMode,
  viewMode,
  onSelectRelease,
}: ArtistSectionProps) {
  const [collapsed, setCollapsed] = useState(false)

  const sorted = useMemo(() => {
    const list = [...artist.releases]
    const yearOf = (display: (typeof list)[number]) => display.originalYear || display.year || 0
    if (sortMode === 'chronological') {
      list.sort(
        (a, b) =>
          yearOf(a) - yearOf(b) || compareSortKeys(a.titleKey, b.titleKey),
      )
    } else {
      list.sort(
        (a, b) => compareSortKeys(a.titleKey, b.titleKey) || yearOf(a) - yearOf(b),
      )
    }
    return list
  }, [artist.releases, sortMode])

  const albumGroups = useMemo(
    () =>
      viewMode === 'albums'
        ? sortPressingGroups(groupPressings(sorted), sortMode)
        : [],
    [sorted, sortMode, viewMode],
  )

  const thumbnail = sorted[0]?.coverImage

  const uniqueAlbums = useMemo(
    () => countUniqueAlbums(sorted.map((display) => display.release)),
    [sorted],
  )

  return (
    <section className="artist-section">
      <header
        className="artist-header"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-controls={`artist-${artist.id}`}
        onClick={() => setCollapsed((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setCollapsed((value) => !value)
          }
        }}
      >
        <span className="artist-avatar" aria-hidden="true">
          {thumbnail ? (
            <img src={thumbnail} alt="" loading="lazy" />
          ) : (
            artist.letter
          )}
        </span>

        <div className="artist-heading">
          <h2 className="artist-name">{artist.name}</h2>
          <span className="artist-count">
            {viewMode === 'albums'
              ? `${albumGroups.length} ${albumGroups.length === 1 ? 'album' : 'albums'} · ${sorted.length} ${sorted.length === 1 ? 'release' : 'releases'}`
              : `${sorted.length} ${sorted.length === 1 ? 'release' : 'releases'} · ${uniqueAlbums} unique ${uniqueAlbums === 1 ? 'album' : 'albums'}`}
          </span>
        </div>

        <span className="collapse-indicator" aria-hidden="true">
          <ChevronIcon direction={collapsed ? 'up' : 'down'} />
        </span>
      </header>

      {!collapsed && (
        <div className="artist-releases" id={`artist-${artist.id}`} role="region">
          {viewMode === 'albums'
            ? albumGroups.map((group) => (
                <AlbumCard key={group.key} group={group} onOpen={onSelectRelease} />
              ))
            : sorted.map((display) => (
                <ReleaseCard
                  key={display.key}
                  display={display}
                  onOpen={onSelectRelease}
                />
              ))}
        </div>
      )}
    </section>
  )
}