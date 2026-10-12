// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { KeyboardEvent } from 'react'
import type { PressingGroup } from '../utils/collection'
import { effectiveYears, stackCountLabel } from '../utils/collection'
import { VinylIcon } from './icons'

interface StackCardProps {
  group: PressingGroup
  /** Opens the whole stack — the detail view then steps through the pressings. */
  onOpen: (group: PressingGroup) => void
}

/**
 * One album as a stack of records: the primary (earliest) pressing faces
 * front, with one or two offset tabs peeking out behind it (see `.stack-card`
 * in styles.css). The card keeps a plain card's footprint, so grouping
 * pressings never stretches the grid row, and the count badge says how deep
 * the pile is. The arrows in the detail view move through the pressings.
 */
export function StackCard({ group, onOpen }: StackCardProps) {
  const primary = group.primary
  const lines = effectiveYears(primary)
  const badge = stackCountLabel(group)
  const depth = Math.min(group.pressings.length, 3)

  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(group)
    }
  }

  return (
    <article
      className={`release-card stack-card stack-${depth}`}
      role="button"
      tabIndex={0}
      aria-label={`${primary.artistName} — ${primary.title}${badge ? `, ${badge}` : ''}`}
      onClick={() => onOpen(group)}
      onKeyDown={handleKey}
    >
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
        <h3 className="release-title" title={primary.title}>
          {primary.title}
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
      {badge && <span className="stack-badge">{badge}</span>}
    </article>
  )
}
