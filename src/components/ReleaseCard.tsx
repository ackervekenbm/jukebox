// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { DisplayRelease } from '../utils/collection'
import { effectiveYears } from '../utils/collection'
import { VinylIcon } from './icons'

interface ReleaseCardProps {
  display: DisplayRelease
  onOpen?: (display: DisplayRelease) => void
  /** Credit line above the title — used where there is no artist shelf. */
  showArtist?: boolean
}

export function ReleaseCard({ display, onOpen, showArtist }: ReleaseCardProps) {
  const lines = effectiveYears(display)

  return (
    <article className="release-card">
      <div className="release-cover">
        {display.coverImage ? (
          <img
            src={display.coverImage}
            alt={`${display.artistName} — ${display.title}`}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="release-cover missing" role="img" aria-label="No cover art">
            <VinylIcon size={22} />
          </div>
        )}
      </div>
      <div className="release-meta">
        {showArtist && <p className="release-artist">{display.artistName}</p>}
        <h3 className="release-title" title={display.title}>
          {onOpen ? (
            // A real button, stretched over the whole card (CSS), so the card's
            // year and format stay readable text for screen readers.
            <button
              type="button"
              className="release-open"
              aria-label={`${display.artistName} — ${display.title}`}
              onClick={() => onOpen(display)}
            >
              {display.title}
            </button>
          ) : (
            display.title
          )}
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
        {display.formatText && <p className="release-format">{display.formatText}</p>}
      </div>
    </article>
  )
}