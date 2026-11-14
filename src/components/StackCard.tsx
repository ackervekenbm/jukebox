// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { PressingGroup } from '../utils/collection'
import { effectiveYears, stackCountLabel } from '../utils/collection'
import { VinylIcon } from './icons'

interface StackCardProps {
  group: PressingGroup
  /** Opens the whole stack — the detail view then steps through the pressings. */
  onOpen: (group: PressingGroup) => void
}

/**
 * One album held as several pressings, shown as a single plain card whose
 * count chip says how deep the stack is. Keeping a plain card's footprint and
 * clipping means grouping never stretches or roughens the grid, and the chip
 * is the only hint that the detail view will let you step through pressings.
 */
export function StackCard({ group, onOpen }: StackCardProps) {
  const primary = group.primary
  const lines = effectiveYears(primary)
  const badge = stackCountLabel(group)

  return (
    <article className="release-card stack-card">
      <div className="release-cover">
        {primary.coverImage ? (
          <img
            src={primary.coverImage}
            alt={`${primary.artistName} — ${primary.title}`}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="release-cover missing" role="img" aria-label="No cover art">
            <VinylIcon size={22} />
          </div>
        )}
      </div>
      {badge && (
        // The button's name already says how many pressings.
        <span className="stack-badge" aria-hidden="true">
          <VinylIcon size={12} />
          {badge}
        </span>
      )}
      <div className="release-meta">
        <h3 className="release-title" title={primary.title}>
          {/* Stretched over the whole card (CSS), like a release card. */}
          <button
            type="button"
            className="release-open"
            aria-label={`${primary.artistName} — ${primary.title}${badge ? `, ${badge}` : ''}`}
            onClick={() => onOpen(group)}
          >
            {primary.title}
          </button>
        </h3>
        {lines.length > 0 && (
          <div className="release-years">
            {lines.map((line, index) => (
              <p className="release-year" key={index}>
                {line.label && <span className="release-year-label">{line.label}</span>}
                {line.value}
              </p>
            ))}
          </div>
        )}
        {primary.formatText && <p className="release-format">{primary.formatText}</p>}
      </div>
    </article>
  )
}
