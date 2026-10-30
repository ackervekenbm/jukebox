// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { Settings as SettingsType } from './db/settings'
import type { DiscogsCollectionRelease } from './types/discogs'
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
  groupByDateAdded,
  toDisplayRelease,
  DEFAULT_FILTERS,
  selectFolderReleases,
  toggleFolder,
  type DisplayRelease,
  type Filters,
  type PressingGroup,
  type ArtistSortMode,
  type ViewMode,
} from './utils/collection'
import { SettingsForm } from './components/Settings'
import { StorageStats } from './components/StorageStats'
import { CabinetScreen } from './components/CabinetScreen'
import { useScrollLock } from './hooks/useScrollLock'
import { SearchBar } from './components/SearchBar'
import { FiltersButton, FilterPanel } from './components/FilterMenu'
import { ViewsButton, ViewsPanel } from './components/ViewsMenu'
import { ArtistSection } from './components/ArtistSection'
import { RecentList } from './components/RecentList'
import { ReleaseDetail, type RecentPick } from './components/ReleaseDetail'
import { StatsPanel } from './components/StatsPanel'
import { SettingsIcon, RefreshIcon, ShuffleIcon, ChevronIcon, RecordPlayer, StatsIcon, CabinetIcon } from './components/icons'
import { clearCabinet } from './db/cabinet'
import { loadViews, saveViews, clearViews } from './db/views'
import {
  clampSkip,
  clearPickerConfig,
  DEFAULT_SKIP,
  loadPickerConfig,
  savePickerConfig,
} from './db/picker'
import { clearListenLog, getListenLog, getRecentListenIds, logListen } from './db/listenLog'
import type { ListenEntry } from './db/listenLog'
import {
  DEFAULT_PREFERENCES,
  clearPreferences,
  loadPreferences,
  savePreferences,
  type Preferences,
} from './db/preferences'
import { pickAvoiding } from './utils/picker'
import { creditedArtists } from './utils/collection'
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

/** Shapes the stored log for the picker history in the detail overlay. */
function toRecentPicks(
  entries: ListenEntry[],
  currentId: number,
  releases: DiscogsCollectionRelease[],
): RecentPick[] {
  return entries
    .filter((entry) => entry.id !== currentId)
    .slice(0, 5)
    .map((entry) => {
      const basic = releases.find((release) => release.id === entry.id)?.basic_information
      if (!basic) return { id: entry.id, at: entry.at, label: `Release #${entry.id}` }
      const artist = basic.artists?.length ? creditedArtists(basic.artists) : ''
      return {
        id: entry.id,
        at: entry.at,
        label: artist ? `${artist} — ${basic.title}` : basic.title,
      }
    })
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
  // Collection folders on screen; empty means every folder ("All"). Folder
  // chips are toggles so several folders can be browsed as one list.
  const [folderSelection, setFolderSelection] = useState<number[]>([])
  const [artistSortMode, setArtistSortMode] = useState<ArtistSortMode>('chronological')
  const [viewMode, setViewMode] = useState<ViewMode>('artists')
  const [selected, setSelected] = useState<DisplayRelease | null>(null)
  const [showCabinet, setShowCabinet] = useState(false)
  // Recent-pick history shown in the detail overlay; non-null only while the
  // release on screen came from the random picker.
  const [recentPicks, setRecentPicks] = useState<RecentPick[] | null>(null)
  const [pickerSkip, setPickerSkip] = useState(() => loadPickerConfig().skip)
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences)
  // The master whose stack is open in the detail view, and which pressing of
  // it is showing; null for a release opened straight from the grid.
  const [stack, setStack] = useState<{ pressings: DisplayRelease[]; index: number } | null>(null)
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
    setFolderSelection([])
    setArtistSortMode('chronological')
    setViewMode('artists')
    setSelected(null)
    setRecentPicks(null)
    setStack(null)
    setActiveViewId(null)
    setShowCabinet(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [accountKey])

  const folderReleases = useMemo(
    () => selectFolderReleases(releases, folderSelection),
    [releases, folderSelection],
  )

  // Scope suffix for the "nothing matches this view" message.
  const folderScopeLabel =
    folderSelection.length > 1
      ? ' in these folders'
      : folderSelection.length === 1
        ? ' in this folder'
        : ''

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
  const recentSections = useMemo(
    () => groupByDateAdded(filtered.map((release) => toDisplayRelease(release, masterYears))),
    [filtered, masterYears],
  )
  // The cabinet plans the physical collection, so it ignores search/filters.
  const displayReleases = useMemo(
    () => releases.map((release) => toDisplayRelease(release, masterYears)),
    [releases, masterYears],
  )

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
    setFolderSelection((current) => toggleFolder(current, id))
    // Folder switching resets the filters, so a saved view is no longer what's
    // on screen: drop it rather than claim it is still applied.
    setFilters(DEFAULT_FILTERS)
    setActiveViewId(null)
  }

  const pickRandom = useCallback(async () => {
    if (filtered.length === 0 || !settings) return
    const recentIds = await getRecentListenIds(settings.username, pickerSkip)
    const picked = pickAvoiding(filtered, recentIds, pickerSkip)
    if (!picked) return
    // Every pick is logged — including re-rolls from an open detail view —
    // so the skip window always reflects what the picker actually served.
    await logListen(settings.username, picked.id)
    const entries = await getListenLog(settings.username)
    setRecentPicks(toRecentPicks(entries, picked.id, releases))
    setSelected(toDisplayRelease(picked, masterYears))
    setStack(null)
  }, [filtered, masterYears, releases, settings, pickerSkip])

  /** Opening a card is browsing, not a listen: no history, no stack. */
  const openRelease = useCallback((display: DisplayRelease) => {
    setRecentPicks(null)
    setStack(null)
    setSelected(display)
  }, [])

  /** Opening a stack starts at the primary pressing; the arrows step onward. */
  const openStack = useCallback((group: PressingGroup) => {
    const pressings = group.rows.map((row) => row.release)
    if (pressings.length === 0) return
    setRecentPicks(null)
    setStack({ pressings, index: 0 })
    setSelected(pressings[0])
  }, [])

  /** Steps through the open stack, wrapping around at either end. */
  const stepStack = useCallback((delta: number) => {
    if (!stack || stack.pressings.length === 0) return
    const total = stack.pressings.length
    const index = (stack.index + delta + total) % total
    setStack({ ...stack, index })
    setSelected(stack.pressings[index])
  }, [stack])

  /** History hops swap the release without logging another listen. */
  const openPick = useCallback(
    (id: number) => {
      const found = releases.find((release) => release.id === id)
      if (!found) return
      setStack(null)
      setSelected(toDisplayRelease(found, masterYears))
    },
    [releases, masterYears],
  )

  const changePickerSkip = useCallback((value: number) => {
    const skip = clampSkip(value)
    setPickerSkip(skip)
    savePickerConfig({ skip })
  }, [])

  const changeGroupPressings = useCallback((grouped: boolean) => {
    setPreferences((prev) => ({ ...prev, groupPressings: grouped }))
    savePreferences({ groupPressings: grouped })
  }, [])

  const onClearData = async () => {
    await wipeCache()
    // The listen log and the skip preference are user data too: "clear
    // everything" has to take them down, not just the caches.
    await clearListenLog()
    clearPickerConfig()
    clearPreferences()
    // The cabinet document is synced to the server but the local copy is user
    // data; wiping everything has to drop it too.
    await clearCabinet()
    setPickerSkip(DEFAULT_SKIP)
    setPreferences(DEFAULT_PREFERENCES)
    setRecentPicks(null)
    setStack(null)
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
              groupPressings={preferences.groupPressings}
              onGroupPressingsChange={changeGroupPressings}
              pickerSkip={pickerSkip}
              onPickerSkipChange={changePickerSkip}
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
              <h1 className="app-title">Jukebox</h1>
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
                  onClick={() => setShowCabinet(true)}
                  title="Record cabinet"
                  aria-label="Record cabinet"
                >
                  <CabinetIcon />
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
            <div className="folder-bar" role="group" aria-label="Collection folders">
              {folders.map((folder) => {
                // "All" is the absence of a folder filter, so it is only active
                // while no specific folder is picked.
                const active =
                  folder.id === 0
                    ? folderSelection.length === 0
                    : folderSelection.includes(folder.id)
                return (
                  <button
                    key={folder.id}
                    type="button"
                    aria-pressed={active}
                    className={`folder-chip${active ? ' active' : ''}`}
                    onClick={() => onFolderChange(folder.id)}
                  >
                    <span className="folder-name">{folder.name}</span>
                    <span className="folder-count">{folder.count.toLocaleString()}</span>
                  </button>
                )
              })}
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
                  aria-checked={viewMode === 'recent'}
                  className={viewMode === 'recent' ? 'active' : ''}
                  onClick={() => setViewMode('recent')}
                  title="A timeline of additions, newest month first"
                >
                  Recent
                </button>
              </div>
            </div>
            {viewMode !== 'recent' && (
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
            )}
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
                  ? `Nothing matches “${activeView.name}”${folderScopeLabel}.`
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
          ) : viewMode === 'recent' ? (
            <RecentList sections={recentSections} onSelectRelease={openRelease} />
          ) : (
            <div className="artist-list">
              {grouped.map((artist) => (
                <ArtistSection
                  key={artist.id}
                  artist={artist}
                  sortMode={artistSortMode}
                  grouped={preferences.groupPressings}
                  onSelectRelease={openRelease}
                  onOpenStack={openStack}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {/* Record cabinet overlay */}
      {showCabinet && settings && (
        <CabinetScreen
          username={settings.username}
          token={settings.token}
          releases={displayReleases}
          onClose={() => setShowCabinet(false)}
        />
      )}

      {/* Release detail overlay */}
      {selected && (
        <ReleaseDetail
          display={selected}
          token={settings?.token ?? ''}
          recentPicks={recentPicks ?? undefined}
          onOpenPick={openPick}
          onPrev={stack ? () => stepStack(-1) : undefined}
          onNext={stack ? () => stepStack(1) : undefined}
          position={
            stack ? { index: stack.index + 1, total: stack.pressings.length } : undefined
          }
          onClose={() => {
            setRecentPicks(null)
            setStack(null)
            setSelected(null)
          }}
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