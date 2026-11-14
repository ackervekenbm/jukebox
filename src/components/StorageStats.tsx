// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useCallback, useEffect, useRef, useState } from 'react'
import { clearReleaseDetails } from '../db/collection'
import { formatTime, plural } from '../utils/format'
import {
  formatBytes,
  gatherStorageStats,
  requestPersistence,
  clearAlbumArtCache,
  type CabinetStat,
  type StorageStats as StorageStatsData,
} from '../utils/storage'

/** "2 shelves", plus the user's own gatefold calls when there are any. */
function cabinetSummary(cabinet: CabinetStat): string {
  const shelves = plural(cabinet.slots, 'shelf', 'shelves')
  if (cabinet.sleeveCalls === 0) return shelves
  const calls = plural(cabinet.sleeveCalls, 'gatefold correction')
  return `${shelves} · ${calls}`
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
  const [confirmingClear, setConfirmingClear] = useState(false)
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
    <section className="storage-wrap" aria-label="Storage and diagnostics">
      {loading && <p className="storage-note">Loading…</p>}
      {error && <p className="storage-note error">{error}</p>}

      {!loading && !error && stats && (
        <>
          {/* -------------------------------------------------------------- */}
          {/*  Origin storage (HTTPS / secure context only)                   */}
          {/* -------------------------------------------------------------- */}
          {stats.origin && (
            <div className="storage-block">
              <h3>Storage quota</h3>
              <div className="storage-row">
                <span className="storage-label">Used</span>
                <span className="storage-value">
                  {formatBytes(stats.origin.usage)} / {formatBytes(stats.origin.quota)}
                </span>
              </div>
              <div className="storage-bar">
                <div
                  className={`storage-bar-fill${quotaPercent >= 80 ? ' warn' : ''}`}
                  style={{ width: `${quotaPercent}%` }}
                />
              </div>
              <div className="storage-row">
                <span className="storage-label">
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
                <span className="storage-value">{persisted ? 'Yes' : 'No'}</span>
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
                <p className="storage-note">Not supported in this browser context.</p>
              )}
            </div>
          )}

          {!stats.origin && !stats.caches && (
            <p className="storage-note">
              Served over plain HTTP: browser quota, persistence and image caching
              aren&apos;t measurable until the app is served over HTTPS.
            </p>
          )}

          {/* -------------------------------------------------------------- */}
          {/*  Breakdown                                                      */}
          {/* -------------------------------------------------------------- */}
          <div className="storage-block">
            <h3>What&apos;s stored here</h3>

            <div className="storage-row">
              <span className="storage-label">Collection</span>
              <span className="storage-value">
                {stats.indexedDb.collection
                  ? `${stats.indexedDb.collection.releaseCount.toLocaleString()} releases`
                  : 'empty'}
              </span>
            </div>
            {stats.indexedDb.collection?.fetchedAt && (
              <div className="storage-row storage-sub">
                <span className="storage-label">Last synced</span>
                <span className="storage-value">
                  {formatTime(stats.indexedDb.collection.fetchedAt)}
                </span>
              </div>
            )}

            <div className="storage-row">
              <span className="storage-label">Master releases</span>
              <span className="storage-value">
                {stats.indexedDb.masterYears.cachedIds.toLocaleString()} saved
              </span>
            </div>

            <div className="storage-row">
              <span className="storage-label">Album art</span>
              <span className="storage-value">
                {cacheReadable
                  ? artCache
                    ? `${artCache.entries} image${artCache.entries !== 1 ? 's' : ''}${
                        artCache.bytes !== null ? ` · ${formatBytes(artCache.bytes)}` : ''
                      }`
                    : 'none yet'
                  : 'streamed from Discogs — not saved by the app over HTTP'}
              </span>
            </div>

            <div className="storage-row">
              <span className="storage-label">Tracklists</span>
              <span className="storage-value">
                {stats.indexedDb.detailCount.toLocaleString()} saved
              </span>
            </div>

            <div className="storage-row">
              <span className="storage-label">Listen log</span>
              <span className="storage-value">
                {stats.indexedDb.listenCount.toLocaleString()}{' '}
                {stats.indexedDb.listenCount === 1 ? 'pick' : 'picks'}
              </span>
            </div>

            <div className="storage-row">
              <span className="storage-label">Record cabinet</span>
              <span className="storage-value">
                {stats.indexedDb.cabinet
                  ? cabinetSummary(stats.indexedDb.cabinet)
                  : 'not set up'}
              </span>
            </div>

            <div className="storage-row">
              <span className="storage-label">App shell</span>
              <span className="storage-value">
                {cacheReadable
                  ? shellCache
                    ? `${shellCache.entries} file${shellCache.entries !== 1 ? 's' : ''}`
                    : 'none yet'
                  : 'no offline copy over HTTP'}
              </span>
            </div>

            <div className="storage-row">
              <span className="storage-label">Settings</span>
              <span className="storage-value">
                {stats.localStorage.keys} key{stats.localStorage.keys !== 1 ? 's' : ''} ·{' '}
                {formatBytes(stats.localStorage.bytes)}
              </span>
            </div>
          </div>

          {/* -------------------------------------------------------------- */}
          {/*  Actions                                                        */}
          {/* -------------------------------------------------------------- */}
          {confirmingClear && onClearData ? (
            <div className="storage-block storage-confirm" role="group" aria-label="Clear everything?">
              <p className="storage-confirm-text">
                This removes everything Jukebox keeps in this browser and signs you out. Your
                cabinet on the server stays.
              </p>
              {stats.indexedDb.cabinet?.unsynced && (
                <p className="storage-confirm-text storage-confirm-warning">
                  Your latest cabinet changes haven't reached the server yet and will be lost.
                </p>
              )}
              <div className="advanced-actions">
                {/* Cancel first and focused: the safe choice is the default one. */}
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setConfirmingClear(false)}
                  autoFocus
                >
                  Cancel
                </button>
                <button type="button" className="secondary-btn danger" onClick={onClearData}>
                  Clear everything
                </button>
              </div>
            </div>
          ) : (
            <div className="storage-block advanced-actions">
              <button type="button" className="secondary-btn" onClick={handleClearTracklists}>
                Clear tracklists
              </button>
              {cacheReadable && (
                <button type="button" className="secondary-btn" onClick={handleClearArt}>
                  Clear album art
                </button>
              )}
              {onClearData && (
                <button
                  type="button"
                  className="secondary-btn danger"
                  onClick={() => setConfirmingClear(true)}
                >
                  Clear everything…
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
