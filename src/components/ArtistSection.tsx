// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useId, useMemo, useState } from 'react'
import type {
  DisplayRelease,
  GroupedArtist,
  ArtistSortMode,
  PressingGroup,
} from '../utils/collection'
import {
  compareReleases,
  countUniqueAlbums,
  groupPressings,
  sortPressingGroups,
} from '../utils/collection'
import { ReleaseCard } from './ReleaseCard'
import { StackCard } from './StackCard'
import { ChevronIcon } from './icons'

interface ArtistSectionProps {
  artist: GroupedArtist
  sortMode: ArtistSortMode
  /** Collapse each master's pressings into one stacked card. */
  grouped: boolean
  onSelectRelease: (display: DisplayRelease) => void
  onOpenStack: (group: PressingGroup) => void
}

export function ArtistSection({
  artist,
  sortMode,
  grouped,
  onSelectRelease,
  onOpenStack,
}: ArtistSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  // Artist ids are names ("Herbie Hancock"), which can't be an id reference.
  const releasesId = useId()

  const sorted = useMemo(
    () => [...artist.releases].sort((a, b) => compareReleases(a, b, sortMode)),
    [artist.releases, sortMode],
  )

  const albumGroups = useMemo(
    () => (grouped ? sortPressingGroups(groupPressings(sorted), sortMode) : []),
    [sorted, sortMode, grouped],
  )

  const thumbnail = sorted[0]?.coverImage

  const uniqueAlbums = useMemo(
    () => countUniqueAlbums(sorted.map((display) => display.release)),
    [sorted],
  )

  return (
    <section className="artist-section">
      {/* The heading stays a heading; the toggle inside it covers the whole
          header (.artist-toggle::after), so a tap anywhere still folds it. */}
      <header className="artist-header">
        <span className="artist-avatar" aria-hidden="true">
          {thumbnail ? (
            <img src={thumbnail} alt="" loading="lazy" />
          ) : (
            artist.letter
          )}
        </span>

        <div className="artist-heading">
          <h2 className="artist-name">
            <button
              type="button"
              className="artist-toggle"
              aria-expanded={!collapsed}
              aria-controls={collapsed ? undefined : releasesId}
              onClick={() => setCollapsed((value) => !value)}
            >
              {artist.name}
            </button>
          </h2>
          <span className="artist-count">
            {sorted.length} {sorted.length === 1 ? 'release' : 'releases'} ·{' '}
            {uniqueAlbums} unique {uniqueAlbums === 1 ? 'album' : 'albums'}
          </span>
        </div>

        <span className="collapse-indicator" aria-hidden="true">
          <ChevronIcon direction={collapsed ? 'up' : 'down'} />
        </span>
      </header>

      {!collapsed && (
        <div className="artist-releases" id={releasesId}>
          {grouped
            ? albumGroups.map((group) =>
                group.pressings.length > 1 ? (
                  <StackCard key={group.key} group={group} onOpen={onOpenStack} />
                ) : (
                  <ReleaseCard
                    key={group.key}
                    display={group.primary}
                    onOpen={onSelectRelease}
                  />
                ),
              )
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
