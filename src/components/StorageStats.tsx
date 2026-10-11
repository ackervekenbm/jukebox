// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useCallback, useEffect, useRef, useState } from 'react'
import { clearReleaseDetails } from '../db/collection'
import {
  formatBytes,
  gatherStorageStats,
  requestPersistence,
  clearAlbumArtCache,
  type StorageStats as StorageStatsData,
} from '../utils/storage'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface StorageStatsProps {
  username: string
  onClearData?: () => void
}

export function StorageStats({ username, onClearData }: StorageStatsProps) {
  const [stats, setStats] = useState<StorageStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [persistInfoOpen, setPersistInfoOpen] = useState(false)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await gatherStorageStats(username)
      if (!mountedRef.current) return
      setStats(data)
      setPersisted(data.persisted)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Could not read storage.')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [username])

  useEffect(() => {
    mountedRef.current = true
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    void load()
    return () => {
      mountedRef.current = false
    }
  }, [load])

  const handlePersist = async () => {
    const granted = await requestPersistence()
    if (granted !== null) setPersisted(granted)
  }

  const handleClearTracklists = async () => {
    await clearReleaseDetails()
    setLoading(true)
    await load()
  }

  const handleClearArt = async () => {
    await clearAlbumArtCache()
    setLoading(true)
    await load()
  }

  const quotaPercent =
    stats?.origin && stats.origin.quota > 0
      ? Math.min(100, Math.round((stats.origin.usage / stats.origin.quota) * 100))
      : 0

  const cacheReadable = Array.isArray(stats?.caches)
  const shellCache = stats?.caches?.find((c) => c.name !== 'album-art') ?? null
  const artCache = stats?.caches?.find((c) => c.name === 'album-art') ?? null

  return (
    <section className="stats-wrap" aria-label="Storage and diagnostics">
      {loading && <p className="stats-note">Loading…</p>}
      {error && <p className="stats-note error">{error}</p>}

      {!loading && !error && stats && (
        <>
          {/* -------------------------------------------------------------- */}
          {/*  Origin storage (HTTPS / secure context only)                   */}
          {/* -------------------------------------------------------------- */}
          {stats.origin && (
            <div className="stats-block">
              <h3>Storage quota</h3>
              <div className="stats-row">
                <span className="stats-label">Used</span>
                <span className="stats-value">
                  {formatBytes(stats.origin.usage)} / {formatBytes(stats.origin.quota)}
                </span>
              </div>
              <div className="stats-bar">
                <div
                  className={`stats-bar-fill${quotaPercent >= 80 ? ' warn' : ''}`}
                  style={{ width: `${quotaPercent}%` }}
                />
              </div>
              <div className="stats-row">
                <span className="stats-label">
                  Persistent storage
                  <span
                    className="info-holder"
                    onMouseEnter={() => setPersistInfoOpen(true)}
                    onMouseLeave={() => setPersistInfoOpen(false)}
                  >
                    <button
                      type="button"
                      className="info-trigger"
                      onClick={() => setPersistInfoOpen((open) => !open)}
                      aria-expanded={persistInfoOpen}
                      aria-label="About persistent storage"
                    >
                      i
                    </button>
                    {persistInfoOpen && (
                      <span className="info-bubble" role="tooltip">
                        A promise from the browser not to wipe this app&apos;s data when
                        storage gets tight or during routine browsing cleanup. Safari
                        usually grants it automatically to apps on the home screen.
                      </span>
                    )}
                  </span>
                </span>
                <span className="stats-value">{persisted ? 'Yes' : 'No'}</span>
              </div>
              {!persisted && persisted !== null && (
                <button
                  type="button"
                  className="secondary-btn storage-action-btn"
                  onClick={handlePersist}
                >
                  Request persistent storage
                </button>
              )}
              {persisted === null && (
                <p className="stats-note">Not supported in this browser context.</p>
              )}
            </div>
          )}

          {!stats.origin && !stats.caches && (
            <p className="stats-note">
              Served over plain HTTP: browser quota, persistence and image caching
              aren&apos;t measurable until the app is served over HTTPS.
            </p>
          )}

          {/* -------------------------------------------------------------- */}
          {/*  Breakdown                                                      */}
          {/* -------------------------------------------------------------- */}
          <div className="stats-block">
            <h3>What&apos;s stored here</h3>

            <div className="stats-row">
              <span className="stats-label">Collection</span>
              <span className="stats-value">
                {stats.indexedDb.collection
                  ? `${stats.indexedDb.collection.releaseCount.toLocaleString()} releases`
                  : 'empty'}
              </span>
            </div>
            {stats.indexedDb.collection?.fetchedAt && (
              <div className="stats-row stats-sub">
                <span className="stats-label">Last synced</span>
                <span className="stats-value">
                  {formatTime(stats.indexedDb.collection.fetchedAt)}
                </span>
              </div>
            )}

            <div className="stats-row">
              <span className="stats-label">Master releases</span>
              <span className="stats-value">
                {stats.indexedDb.masterYears.cachedIds.toLocaleString()} saved
              </span>
            </div>

            <div className="stats-row">
              <span className="stats-label">Album art</span>
              <span className="stats-value">
                {cacheReadable
                  ? artCache
                    ? `${artCache.entries} image${artCache.entries !== 1 ? 's' : ''}${
                        artCache.bytes !== null ? ` · ${formatBytes(artCache.bytes)}` : ''
                      }`
                    : 'none yet'
                  : 'streamed from Discogs — not saved by the app over HTTP'}
              </span>
            </div>

            <div className="stats-row">
              <span className="stats-label">Tracklists</span>
              <span className="stats-value">
                {stats.indexedDb.detailCount.toLocaleString()} saved
              </span>
            </div>

            <div className="stats-row">
              <span className="stats-label">Listen log</span>
              <span className="stats-value">
                {stats.indexedDb.listenCount.toLocaleString()}{' '}
                {stats.indexedDb.listenCount === 1 ? 'pick' : 'picks'}
              </span>
            </div>

            <div className="stats-row">
              <span className="stats-label">App shell</span>
              <span className="stats-value">
                {cacheReadable
                  ? shellCache
                    ? `${shellCache.entries} file${shellCache.entries !== 1 ? 's' : ''}`
                    : 'none yet'
                  : 'no offline copy over HTTP'}
              </span>
            </div>

            <div className="stats-row">
              <span className="stats-label">Settings</span>
              <span className="stats-value">
                {stats.localStorage.keys} key{stats.localStorage.keys !== 1 ? 's' : ''} ·{' '}
                {formatBytes(stats.localStorage.bytes)}
              </span>
            </div>
          </div>

          {/* -------------------------------------------------------------- */}
          {/*  Actions                                                        */}
          {/* -------------------------------------------------------------- */}
          <div className="stats-block advanced-actions">
            <button type="button" className="secondary-btn" onClick={handleClearTracklists}>
              Clear tracklists
            </button>
            {cacheReadable && (
              <button type="button" className="secondary-btn" onClick={handleClearArt}>
                Clear album art
              </button>
            )}
            {onClearData && (
              <button type="button" className="secondary-btn danger" onClick={onClearData}>
                Clear everything
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
