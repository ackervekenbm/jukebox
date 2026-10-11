// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { Settings as SettingsType } from './db/settings'
import { loadSettings, saveSettings, clearSettings } from './db/settings'
import type { ThemeId } from './theme'
import { applyTheme } from './theme'
import { useCollection, type SyncProgress } from './hooks/useCollection'
import { useCollectionValue } from './hooks/useCollectionValue'
import {
  filterReleases,
  groupReleases,
  distinctFormats,
  distinctGenres,
  distinctStyles,
  distinctLabels,
  yearBounds,
  countUniqueAlbums,
  toDisplayRelease,
  DEFAULT_FILTERS,
  type DisplayRelease,
  type Filters,
  type ArtistSortMode,
  type ViewMode,
} from './utils/collection'
import { SettingsForm } from './components/Settings'
import { StorageStats } from './components/StorageStats'
import { useScrollLock } from './hooks/useScrollLock'
import { SearchBar } from './components/SearchBar'
import { FiltersButton, FilterPanel } from './components/FilterMenu'
import { ViewsButton, ViewsPanel } from './components/ViewsMenu'
import { ArtistSection } from './components/ArtistSection'
import { ReleaseDetail } from './components/ReleaseDetail'
import { StatsPanel } from './components/StatsPanel'
import { SettingsIcon, RefreshIcon, ShuffleIcon, ChevronIcon, RecordPlayer, StatsIcon } from './components/icons'
import { loadViews, saveViews, clearViews } from './db/views'
import {
  createSavedView,
  hasCriteria,
  sameCriteria,
  type SavedView,
} from './utils/views'

/**
 * Debounces the search box while typing, but also hands back a setter that
 * applies a value immediately — a saved view should switch the listing at once
 * rather than wait out the typing delay.
 */
function useDebounced<T>(value: T, delay: number): [T, (next: T) => void] {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return [debounced, setDebounced]
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function progressText(progress: SyncProgress): string {
  if (progress.phase === 'years') {
    return `Retrieving original release years… ${progress.loaded.toLocaleString()} / ${progress.total.toLocaleString()}`
  }
  return `Fetching releases… ${progress.loaded.toLocaleString()} / ${progress.total.toLocaleString()}`
}

export default function App() {
  const [settings, setSettings] = useState<SettingsType | null>(loadSettings)
  const [theme, setTheme] = useState<ThemeId>(settings?.theme ?? 'midnight')
  const [showSettings, setShowSettings] = useState<boolean>(() => !loadSettings())
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const {
    releases,
    folders,
    masterYears,
    status,
    error,
    progress,
    fetchedAt,
    refresh,
    wipeCache,
  } = useCollection(settings)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useDebounced(query, 150)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [views, setViews] = useState<SavedView[]>(loadViews)
  const [viewsOpen, setViewsOpen] = useState(false)
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [folderId, setFolderId] = useState(0)
  const [artistSortMode, setArtistSortMode] = useState<ArtistSortMode>('chronological')
  const [viewMode, setViewMode] = useState<ViewMode>('artists')
  const [selected, setSelected] = useState<DisplayRelease | null>(null)
  const [showStats, setShowStats] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)

  // The valuation is a single cheap request, but it is still only asked for
  // once the user actually opens the stats panel.
  const valueAccount = useMemo(
    () => (settings ? { username: settings.username, token: settings.token } : null),
    // Intentionally only the account fields, for the same reason as `account`
    // in useCollection: a preference change (e.g. the theme) must not change
    // this identity and re-key the cached valuation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings?.username, settings?.token],
  )
  const collectionValue = useCollectionValue(valueAccount)
  const openValue = collectionValue.open

  useEffect(() => {
    if (showStats) openValue()
  }, [showStats, openValue])

  useScrollLock(showSettings)
  useScrollLock(showStats)

  const accountKey = settings ? `${settings.username}\u0001${settings.token}` : ''

  useEffect(() => {
    // Reset the browsing state for a new account only. Keying on the whole
    // settings object would also wipe search/filters/sort whenever a
    // preference (e.g. the UI theme) changes for the same account.
    /* eslint-disable react-hooks/set-state-in-effect */
    setQuery('')
    setFilters(DEFAULT_FILTERS)
    setFolderId(0)
    setArtistSortMode('chronological')
    setViewMode('artists')
    setSelected(null)
    setActiveViewId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [accountKey])

  const folderReleases = useMemo(() => {
    if (folderId === 0) return releases
    return releases.filter((release) => (release.folder_id ?? 1) === folderId)
  }, [releases, folderId])

  const formats = useMemo(() => distinctFormats(folderReleases), [folderReleases])
  const genres = useMemo(() => distinctGenres(folderReleases), [folderReleases])
  const styles = useMemo(() => distinctStyles(folderReleases), [folderReleases])
  const labels = useMemo(() => distinctLabels(folderReleases), [folderReleases])
  const bounds = useMemo(() => yearBounds(folderReleases, masterYears), [folderReleases, masterYears])

  const filtered = useMemo(
    () => filterReleases(folderReleases, { ...filters, query: debouncedQuery }, masterYears),
    [folderReleases, filters, debouncedQuery, masterYears],
  )
  const grouped = useMemo(() => groupReleases(filtered, masterYears), [filtered, masterYears])

  const artistCount = grouped.length
  const totalMatching = filtered.length
  const uniqueMatching = useMemo(() => countUniqueAlbums(filtered), [filtered])

  // A view is only "in use" while the live selection still matches it exactly;
  // any hand edit to the search box or filters marks it as changed.
  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? null,
    [views, activeViewId],
  )
  const viewDirty = activeView ? !sameCriteria(activeView, query, filters) : false
  const canSaveView = hasCriteria(query, filters)

  // Live match counts, so a stale view (a label the collection no longer has)
  // shows 0 instead of silently promising results.
  const viewCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const view of views) {
      counts[view.id] = filterReleases(
        folderReleases,
        { ...view.filters, query: view.query },
        masterYears,
      ).length
    }
    return counts
  }, [views, folderReleases, masterYears])

  const persistViews = useCallback((next: SavedView[]) => {
    setViews(next)
    saveViews(next)
  }, [])

  const closeViews = useCallback(() => setViewsOpen(false), [])

  // Switching views swaps the whole listing, so bring the user back to the
  // controls that changed it instead of leaving them mid-grid.
  const revealToolbar = useCallback(() => {
    toolbarRef.current?.scrollIntoView({ block: 'start' })
  }, [])

  const applyView = useCallback(
    (view: SavedView) => {
      setQuery(view.query)
      setDebouncedQuery(view.query)
      setFilters({ ...view.filters })
      setActiveViewId(view.id)
      setViewsOpen(false)
      revealToolbar()
    },
    [revealToolbar, setDebouncedQuery],
  )

  const clearView = useCallback(() => {
    setQuery('')
    setDebouncedQuery('')
    setFilters(DEFAULT_FILTERS)
    setActiveViewId(null)
    setViewsOpen(false)
    revealToolbar()
  }, [revealToolbar, setDebouncedQuery])

  const addView = useCallback(
    (name: string) => {
      persistViews([...views, createSavedView(name, query, filters)])
    },
    [persistViews, views, query, filters],
  )

  const renameView = useCallback(
    (id: string, name: string) => {
      persistViews(views.map((view) => (view.id === id ? { ...view, name: name.trim() } : view)))
    },
    [persistViews, views],
  )

  const deleteView = useCallback(
    (id: string) => {
      persistViews(views.filter((view) => view.id !== id))
      setActiveViewId((current) => (current === id ? null : current))
    },
    [persistViews, views],
  )

  const updateView = useCallback(
    (view: SavedView) => {
      persistViews(
        views.map((entry) =>
          entry.id === view.id
            ? { ...entry, query: query.trim(), filters: { ...filters } }
            : entry,
        ),
      )
    },
    [persistViews, views, query, filters],
  )

  const onSaveSettings = (newSettings: SettingsType) => {
    saveSettings({ ...newSettings, theme })
    setSettings({ ...newSettings, theme })
    setShowSettings(false)
  }

  const onThemeChange = (id: ThemeId) => {
    setTheme(id)
    const current = loadSettings()
    if (!current) {
      // No saved account yet: the choice lives in App state and persists on
      // the first settings save. Don't write empty credentials to storage.
      return
    }
    saveSettings({ ...current, theme: id })
    setSettings({ ...current, theme: id })
  }

  const onFolderChange = (id: number) => {
    setFolderId(id)
    // Folder switching resets the filters, so a saved view is no longer what's
    // on screen: drop it rather than claim it is still applied.
    setFilters(DEFAULT_FILTERS)
    setActiveViewId(null)
  }

  const pickRandom = useCallback(() => {
    if (filtered.length === 0) return
    const picked = filtered[Math.floor(Math.random() * filtered.length)]
    setSelected(toDisplayRelease(picked, masterYears))
  }, [filtered, masterYears])

  const onClearData = async () => {
    await wipeCache()
    clearSettings()
    // Saved views live in their own storage key, so "clear everything" has to
    // take them down explicitly to keep reclaiming everything it claims to.
    clearViews()
    setViews([])
    setActiveViewId(null)
    setSettings(null)
    setShowSettings(true)
  }

  const isLoadingFirst = status === 'loading' && releases.length === 0
  const isLoadingFailed = status === 'error' && releases.length === 0

  return (
    <>
      {/* Full-screen settings (no saved settings, or opened from menu) */}
      {showSettings && (
        <div
          className="settings-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          onClick={settings ? () => setShowSettings(false) : undefined}
        >
          <div className="settings-overlay-content" onClick={(e) => e.stopPropagation()}>
            <SettingsForm
              initial={settings ?? { username: '', token: '', theme }}
              theme={theme}
              onThemeChange={onThemeChange}
              onSave={onSaveSettings}
              onClose={settings ? () => setShowSettings(false) : undefined}
            >
              {settings && (
                <section className="advanced-section">
                  <button
                    type="button"
                    className="advanced-toggle"
                    onClick={() => setAdvancedOpen((open) => !open)}
                    aria-expanded={advancedOpen}
                    aria-controls="advanced-panel"
                  >
                    <span>Advanced</span>
                    <span className="collapse-indicator" aria-hidden="true">
                      <ChevronIcon direction={advancedOpen ? 'up' : 'down'} />
                    </span>
                  </button>
                  {advancedOpen && (
                    <div id="advanced-panel" className="advanced-body">
                      <StorageStats username={settings.username} onClearData={onClearData} />
                    </div>
                  )}
                </section>
              )}
            </SettingsForm>
          </div>
        </div>
      )}

      {/* First-load spinner */}
      {isLoadingFirst && (
        <div className="full-state">
          <RecordPlayer size={150} />
          <p>Loading your collection…</p>
          {progress && <p className="progress-text">{progressText(progress)}</p>}
        </div>
      )}

      {/* First-load error (no cached data) */}
      {isLoadingFailed && (
        <div className="full-state error">
          <div className="error-icon" role="img" aria-label="Error">
            !
          </div>
          <h2>Could not load your collection</h2>
          <p className="error-message">{error}</p>
          <div className="error-actions">
            <button type="button" onClick={refresh}>
              Try again
            </button>
            <button type="button" onClick={() => setShowSettings(true)}>
              Change settings
            </button>
          </div>
        </div>
      )}

      {/* Main app (have data or background-refreshing) */}
      {!isLoadingFirst && !isLoadingFailed && settings && (
        <div className="app">
          <header className="app-header">
            <div className="header-top">
              <h1 className="app-title">Vinyl Vault</h1>
              <div className="header-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={refresh}
                  disabled={status === 'loading'}
                  title="Refresh collection"
                  aria-label="Refresh collection"
                >
                  <RefreshIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowStats(true)}
                  title="Collection stats"
                  aria-label="Collection stats"
                >
                  <StatsIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowSettings(true)}
                  title="Settings"
                  aria-label="Settings"
                >
                  <SettingsIcon />
                </button>
              </div>
            </div>
            <div className="header-meta">
              <span>{releases.length.toLocaleString()} releases</span>
              {fetchedAt && <span className="meta-separator">·</span>}
              {fetchedAt && <span>Last synced {formatTime(fetchedAt)}</span>}
            </div>
          </header>

          {status === 'loading' && releases.length > 0 && (
            <div className="sync-banner" aria-live="polite">
              Syncing…
              {progress && <span> {progressText(progress)}</span>}
            </div>
          )}

          {status === 'error' && releases.length > 0 && (
            <div className="sync-banner error" role="alert">
              Failed to refresh: {error}. Showing cached data.
              <button type="button" onClick={refresh}>
                Retry
              </button>
            </div>
          )}

          {folders.length > 0 && (
            <div className="folder-bar" role="tablist" aria-label="Collection folders">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  role="tab"
                  aria-selected={folderId === folder.id}
                  className={`folder-chip${folderId === folder.id ? ' active' : ''}`}
                  onClick={() => onFolderChange(folder.id)}
                >
                  <span className="folder-name">{folder.name}</span>
                  <span className="folder-count">{folder.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}

          <div className="toolbar" ref={toolbarRef}>
            <SearchBar value={query} onChange={setQuery} />
            <FiltersButton
              filters={filters}
              open={filtersOpen}
              onToggle={() => {
                setFiltersOpen((open) => !open)
                setViewsOpen(false)
              }}
            />
            <ViewsButton
              views={views}
              activeView={activeView}
              dirty={viewDirty}
              open={viewsOpen}
              onToggle={() => {
                setViewsOpen((open) => !open)
                setFiltersOpen(false)
              }}
            />
            <div className="global-view">
              <span className="global-sort-label">View</span>
              <div className="sort-toggle" role="radiogroup" aria-label="Collection view">
                <button
                  type="button"
                  role="radio"
                  aria-checked={viewMode === 'artists'}
                  className={viewMode === 'artists' ? 'active' : ''}
                  onClick={() => setViewMode('artists')}
                  title="One card per release, on each artist's shelf"
                >
                  Artists
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={viewMode === 'albums'}
                  className={viewMode === 'albums' ? 'active' : ''}
                  onClick={() => setViewMode('albums')}
                  title="One card per album: every pressing of a master grouped together"
                >
                  Albums
                </button>
              </div>
            </div>
            <div className="global-sort">
              <span className="global-sort-label">Sort</span>
              <div className="sort-toggle" role="group" aria-label="Sort releases by">
                <button
                  className={artistSortMode === 'chronological' ? 'active' : ''}
                  onClick={() => setArtistSortMode('chronological')}
                  title="Oldest to newest within each artist"
                >
                  Year
                </button>
                <button
                  className={artistSortMode === 'byName' ? 'active' : ''}
                  onClick={() => setArtistSortMode('byName')}
                  title="By album name within each artist"
                >
                  A–Z
                </button>
              </div>
            </div>
          </div>

          {filtersOpen && (
            <FilterPanel
              filters={filters}
              formats={formats}
              genres={genres}
              styles={styles}
              labels={labels}
              bounds={bounds}
              onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
              onReset={() => setFilters(DEFAULT_FILTERS)}
            />
          )}

          {viewsOpen && (
            <ViewsPanel
              views={views}
              counts={viewCounts}
              activeView={activeView}
              dirty={viewDirty}
              canSave={canSaveView}
              onApply={applyView}
              onClear={clearView}
              onSave={addView}
              onRename={renameView}
              onDelete={deleteView}
              onUpdate={updateView}
              onClose={closeViews}
            />
          )}

          <div className="summary">
            <p>
              {artistCount.toLocaleString()}
              {artistCount === 1 ? ' artist' : ' artists'}
              {' · '}
              {totalMatching.toLocaleString()}
              {totalMatching === 1 ? ' release' : ' releases'}
              {' · '}
              {uniqueMatching.toLocaleString()}
              {uniqueMatching === 1 ? ' unique album' : ' unique albums'}
            </p>
          </div>

          {grouped.length === 0 ? (
            <div className="full-state empty">
              <p>
                {activeView
                  ? `Nothing matches “${activeView.name}”${folderId === 0 ? '' : ' in this folder'}.`
                  : 'No releases match your search or filters.'}
              </p>
              {activeView && (
                <div className="empty-actions">
                  {viewDirty ? (
                    <button type="button" onClick={() => applyView(activeView)}>
                      Revert to “{activeView.name}”
                    </button>
                  ) : (
                    <button type="button" onClick={clearView}>
                      Show all releases
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="artist-list">
              {grouped.map((artist) => (
                <ArtistSection
                  key={artist.id}
                  artist={artist}
                  sortMode={artistSortMode}
                  viewMode={viewMode}
                  onSelectRelease={setSelected}
                />
              ))}
            </div>
          )}
        </div>
      )}
    {/* Release detail overlay */}
      {selected && (
        <ReleaseDetail
          display={selected}
          token={settings?.token ?? ''}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Collection stats overlay */}
      {showStats && (
        <StatsPanel
          releases={releases}
          masterYears={masterYears}
          value={collectionValue}
          onClose={() => setShowStats(false)}
        />
      )}

      {/* Random picker (hidden while first-loading or when loading failed with no data) */}
      {!showSettings && !isLoadingFirst && !isLoadingFailed && (
        <button
          type="button"
          className="random-fab"
          onClick={pickRandom}
          disabled={filtered.length === 0}
          title="Pick a random release from what's shown"
          aria-label="Pick a random release from what's shown"
        >
          <ShuffleIcon size={20} />
        </button>
      )}
    </>
  )
}