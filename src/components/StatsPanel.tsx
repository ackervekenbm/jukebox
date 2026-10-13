// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useMemo, useId } from 'react'
import type { MasterYears } from '../api/discogs'
import type { DiscogsCollectionRelease } from '../types/discogs'
import type { CollectionValueState } from '../hooks/useCollectionValue'
import { CloseIcon } from './icons'
import {
  computeCollectionStats,
  type CollectionStats,
  type CountItem,
  type YearBin,
  type TimelineBin,
} from '../utils/collection'

function CountBars({ items, emptyLabel }: { items: CountItem[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="stats-empty">{emptyLabel}</p>
  }
  const max = Math.max(...items.map((i) => i.count))
  return (
    <ul className="stats-bars">
      {items.map((item) => (
        <li key={item.name} className="stats-bar-row">
          <span className="stats-bar-label" title={item.name}>
            {item.name}
          </span>
          <span className="stats-bar-track">
            <span
              className="stats-bar-fill"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </span>
          <span className="stats-bar-count">{item.count.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  )
}

function ColumnChart({
  bins,
  getKey,
  getLabel,
  emptyLabel,
  title,
}: {
  bins: (YearBin | TimelineBin)[]
  getKey: (b: YearBin | TimelineBin) => string
  getLabel: (b: YearBin | TimelineBin) => string
  emptyLabel: string
  title: string
}) {
  const clipId = useId()
  if (bins.length === 0) {
    return <p className="stats-empty">{emptyLabel}</p>
  }
  const n = bins.length
  const max = Math.max(...bins.map((b) => b.count))
  const w = 100
  const h = 40
  const barW = w / n
  // Up to five evenly spaced tick labels (including both ends), so a long
  // timespan stays readable without crowding a narrow card.
  const labelCount = Math.min(5, n)
  const labelIdx = new Set<number>([0, n - 1])
  for (let k = 1; k < labelCount - 1; k++) {
    labelIdx.add(Math.round((k * (n - 1)) / (labelCount - 1)))
  }
  const labelIndices = [...labelIdx].sort((a, b) => a - b)
  return (
    <div className="stats-chart" role="img" aria-label={title}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="stats-chart-svg"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={w} height={h} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {bins.map((b, i) => {
            const bh = max > 0 ? (b.count / max) * h : 0
            return (
              <rect
                key={getKey(b)}
                x={i * barW}
                y={h - bh}
                width={Math.max(barW - 0.3, 0.3)}
                height={bh}
                className="stats-chart-bar"
              >
                <title>
                  {`${getLabel(b)} · ${b.count} ${b.count === 1 ? 'release' : 'releases'}`}
                </title>
              </rect>
            )
          })}
        </g>
      </svg>
      <div className="stats-chart-labels">
        {labelIndices.map((i) => (
          <span key={getKey(bins[i])}>{getLabel(bins[i])}</span>
        ))}
      </div>
    </div>
  )
}

function CollectionValue({
  state,
}: {
  state: CollectionValueState
}) {
  const { value, fetchedAt, status, error, refresh } = state

  return (
    <div className="stats-section">
      <div className="stats-section-head">
        <h3>Estimated value</h3>
        <button
          type="button"
          className="stats-link-btn"
          onClick={refresh}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {value ? (
        <>
          <div className="stats-value-grid">
            <div className="stat-tile">
              <span className="stat-tile-value">{value.minimum || '—'}</span>
              <span className="stat-tile-label">low</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">{value.median || '—'}</span>
              <span className="stat-tile-label">median</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">{value.maximum || '—'}</span>
              <span className="stat-tile-label">high</span>
            </div>
          </div>
          <p className="stats-note">
            Discogs' own estimate for your whole collection, based on recent
            marketplace sales.
          </p>
          {fetchedAt && (
            <p className="stats-updated">
              Updated {new Date(fetchedAt).toLocaleString()}.
            </p>
          )}
        </>
      ) : (
        <p className="stats-note">
          {status === 'loading' ? 'Loading…' : 'No valuation yet.'}
        </p>
      )}

      {error && (
        <p className="stats-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function StatsPanel({
  releases,
  masterYears,
  value: valueState,
  onClose,
}: {
  releases: DiscogsCollectionRelease[]
  masterYears: MasterYears
  value: CollectionValueState
  onClose?: () => void
}) {
  const stats: CollectionStats = useMemo(
    () => computeCollectionStats(releases, masterYears),
    [releases, masterYears],
  )

  if (stats.totalReleases === 0) {
    return (
      <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Collection stats">
        <div className="settings-overlay-content">
          <div className="settings-card">
            {onClose && (
              <button
                type="button"
                className="card-close"
                onClick={onClose}
                aria-label="Close stats"
              >
                <CloseIcon />
              </button>
            )}
            <h2 className="stats-title">Collection stats</h2>
            <div className="card-scroll">
              <CollectionValue state={valueState} />
              <p className="stats-empty">No releases to summarise yet.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Collection stats">
      <div className="settings-overlay-content">
        <div className="settings-card">
          {onClose && (
            <button
              type="button"
              className="card-close"
              onClick={onClose}
              aria-label="Close stats"
            >
              <CloseIcon />
            </button>
          )}
          <h2 className="stats-title">Collection stats</h2>
          <div className="card-scroll">

        <div className="stats-totals">
          <div className="stat-tile">
            <span className="stat-tile-value">{stats.totalReleases.toLocaleString()}</span>
            <span className="stat-tile-label">
              {stats.totalReleases === 1 ? 'release' : 'releases'}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile-value">{stats.uniqueAlbums.toLocaleString()}</span>
            <span className="stat-tile-label">
              {stats.uniqueAlbums === 1 ? 'unique album' : 'unique albums'}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile-value">{stats.artists.toLocaleString()}</span>
            <span className="stat-tile-label">
              {stats.artists === 1 ? 'artist' : 'artists'}
            </span>
          </div>
        </div>

        <CollectionValue state={valueState} />

        <div className="stats-section">
          <h3>Release years</h3>
          <ColumnChart
            bins={stats.yearDistribution}
            getKey={(b) => String((b as YearBin).year)}
            getLabel={(b) => String((b as YearBin).year)}
            emptyLabel="No year data available."
            title="Releases by year"
          />
        </div>

        <div className="stats-section">
          <h3>Acquired over time</h3>
          <ColumnChart
            bins={stats.acquisitionTimeline}
            getKey={(b) => (b as TimelineBin).period}
            getLabel={(b) => (b as TimelineBin).label}
            emptyLabel="No acquisition dates available."
            title="Releases added to collection over time"
          />
        </div>

        <div className="stats-section">
          <h3>Top genres</h3>
          <CountBars items={stats.topGenres} emptyLabel="No genre data available." />
        </div>
        <div className="stats-section">
          <h3>Top styles</h3>
          <CountBars items={stats.topStyles} emptyLabel="No style data available." />
        </div>

        <div className="stats-section">
          <h3>Top labels</h3>
          <CountBars items={stats.topLabels} emptyLabel="No label data available." />
        </div>

        <div className="stats-section">
          <h3>Top formats</h3>
          <CountBars items={stats.topFormats} emptyLabel="No format data available." />
        </div>
          </div>
        </div>
      </div>
    </div>
  )
}
