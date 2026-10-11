// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useState } from 'react'
import type { DisplayRelease, PressingGroup } from '../utils/collection'
import { effectiveYears } from '../utils/collection'
import { VinylIcon } from './icons'

/** Long masters (classical reissues run past 30 pressings) start collapsed. */
const VISIBLE_ROWS = 6

interface AlbumCardProps {
  group: PressingGroup
  onOpen: (display: DisplayRelease) => void
}

function badgeFor(group: PressingGroup): string {
  const pressings = group.rows.length
  const copies = group.pressings.length
  if (pressings > 1) return `${pressings} pressings`
  if (copies > 1) return `${copies} copies`
  return ''
}

function rowLabel(release: DisplayRelease): string {
  const bits = [
    release.year > 0 ? String(release.year) : '',
    release.country,
    release.formatNames.join(' / '),
    release.labels[0] ?? '',
  ].filter(Boolean)
  return `Open ${release.title}${bits.length > 0 ? ` — ${bits.join(' · ')}` : ''}`
}

/**
 * One album, every pressing listed.
 *
 * The card body is a single stretched button (see `.album-open` in
 * styles.css) so the cover and title open the primary pressing, while the
 * pressing rows sit above it as real sibling buttons — nesting them inside
 * the card button would make them unreachable for keyboard and screen-reader
 * users.
 */
export function AlbumCard({ group, onOpen }: AlbumCardProps) {
  const [expanded, setExpanded] = useState(false)
  const primary = group.primary
  const lines = effectiveYears(primary)
  const badge = badgeFor(group)
  const showRows = group.rows.length > 1
  const visibleRows = expanded ? group.rows : group.rows.slice(0, VISIBLE_ROWS)
  const hiddenRows = group.rows.length - visibleRows.length

  return (
    <article className="release-card album-card">
      <button
        type="button"
        className="album-open"
        aria-label={`${primary.artistName} — ${primary.title}`}
        onClick={() => onOpen(primary)}
      />
      {badge && <span className="album-badge">{badge}</span>}
      <div className="release-cover">
        {primary.coverImage ? (
          <img
            src={primary.coverImage}
            alt={`${primary.artistName} — ${primary.title}`}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="release-cover missing" aria-label="No cover art">
            <VinylIcon size={22} />
          </div>
        )}
      </div>
      <div className="release-meta">
        <span className="release-title" title={primary.title}>
          {primary.title}
        </span>
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

      {showRows && (
        <div className="album-pressings">
          {visibleRows.map((row) => (
            <button
              key={`${row.release.id}-${row.release.instanceId}`}
              type="button"
              className="pressing-row"
              onClick={() => onOpen(row.release)}
              aria-label={rowLabel(row.release)}
            >
              <span className="pressing-year">
                {row.release.year > 0 ? row.release.year : '—'}
              </span>
              <span className="pressing-place">{row.release.country || '—'}</span>
              <span className="pressing-format">
                {row.release.formatNames.join(' / ') || '—'}
              </span>
              <span className="pressing-label">{row.release.labels[0] || '—'}</span>
              {row.copies > 1 && <span className="pressing-copies">×{row.copies} copies</span>}
            </button>
          ))}
          {group.rows.length > VISIBLE_ROWS && (
            <button
              type="button"
              className="pressing-more"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? 'Show fewer pressings' : `+${hiddenRows} more`}
            </button>
          )}
        </div>
      )}
    </article>
  )
}
