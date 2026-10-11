// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { DateSection, DisplayRelease } from '../utils/collection'
import { ReleaseCard } from './ReleaseCard'

interface RecentListProps {
  sections: DateSection[]
  onSelectRelease: (display: DisplayRelease) => void
}

/**
 * The Recently added view: one heading per month of additions, newest month
 * first, and a flat grid of cards underneath — there are no artist shelves to
 * hang them from, so each card carries its own artist credit.
 */
export function RecentList({ sections, onSelectRelease }: RecentListProps) {
  return (
    <div className="recent-list">
      {sections.map((section) => (
        <section className="recent-month" key={section.key}>
          <header className="recent-month-header">
            <h2 className="recent-month-title">{section.label}</h2>
            <span className="recent-month-count">
              {section.releases.length} {section.releases.length === 1 ? 'release' : 'releases'}
            </span>
          </header>
          <div className="recent-releases">
            {section.releases.map((display) => (
              <ReleaseCard key={display.key} display={display} showArtist onOpen={onSelectRelease} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
