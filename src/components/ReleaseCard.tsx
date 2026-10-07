// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { KeyboardEvent } from 'react'
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

  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!onOpen) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(display)
    }
  }

  return (
    <article
      className="release-card"
      role="button"
      tabIndex={onOpen ? 0 : undefined}
      aria-label={`${display.artistName} — ${display.title}`}
      onClick={onOpen ? () => onOpen(display) : undefined}
      onKeyDown={handleKey}
    >
      <div className="release-cover">
        {display.coverImage ? (
          <img
            src={display.coverImage}
            alt={`${display.artistName} — ${display.title}`}
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
        {showArtist && <p className="release-artist">{display.artistName}</p>}
        <h3 className="release-title" title={display.title}>
          {display.title}
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