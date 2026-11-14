// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { Settings as SettingsType } from './db/settings'
import { loadSettings, saveSettings, clearSettings } from './db/settings'
import type { ThemeId } from './theme'
import { applyTheme } from './theme'
import { useCollection } from './hooks/useCollection'
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
  type Filters,
  type ArtistSortMode,
  type ViewMode,
} from './utils/collection'
import { CabinetScreen } from './components/CabinetScreen'
import { isGatefold, sizeClassOf, sleeveSource } from './utils/cabinet'
import { useCabinet } from './hooks/useCabinet'
import { useDebounced } from './hooks/useDebounced'
import { useReleaseDetail } from './hooks/useReleaseDetail'
import { useSavedViews } from './hooks/useSavedViews'
import { useScrollLock } from './hooks/useScrollLock'
import { useDatabaseState } from './hooks/useDatabaseState'
import { useDiscogsWaitNote } from './hooks/useDiscogsWait'
import { AppHeader } from './components/AppHeader'
import { FolderBar } from './components/FolderBar'
import { SettingsOverlay } from './components/SettingsOverlay'
import { DatabaseBanner, FirstLoad, LoadFailed, SyncBanner, SyncFailedBanner } from './components/SyncStatus'
import { Toolbar } from './components/Toolbar'
import { FilterPanel } from './components/FilterMenu'
import { ViewsPanel } from './components/ViewsMenu'
import { ArtistSection } from './components/ArtistSection'
import { RecentList } from './components/RecentList'
import { ReleaseDetail } from './components/ReleaseDetail'
import { StatsPanel } from './components/StatsPanel'
import { ShuffleIcon } from './components/icons'
import { clearCabinet } from './db/cabinet'
import {
  clampSkip,
  clearPickerConfig,
  DEFAULT_SKIP,
  loadPickerConfig,
  savePickerConfig,
} from './db/picker'
import { clearListenLog } from './db/listenLog'
import {
  DEFAULT_PREFERENCES,
  clearPreferences,
  loadPreferences,
  savePreferences,
  type Preferences,
} from './db/preferences'
import { formatTime } from './utils/format'

export default function App() {
  const databaseState = useDatabaseState()
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
  // Why a sync isn't moving: pausing for Discogs' rate limit, or no answer for a while.
  // Keyed on phase and count, so moving from pages to years restarts the clock.
  const syncWait = useDiscogsWaitNote(
    status === 'loading',
    progress ? `${progress.phase}:${progress.loaded}` : null,
  )

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useDebounced(query, 150)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  // Collection folders on screen; empty means every folder ("All"). Folder
  // chips are toggles so several folders can be browsed as one list.
  const [folderSelection, setFolderSelection] = useState<number[]>([])
  const [artistSortMode, setArtistSortMode] = useState<ArtistSortMode>('chronological')
  const [viewMode, setViewMode] = useState<ViewMode>('artists')
  const [showCabinet, setShowCabinet] = useState(false)
  const [pickerSkip, setPickerSkip] = useState(() => loadPickerConfig().skip)
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences)
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

  useScrollLock(showStats)

  const accountKey = settings ? `${settings.username}\u0001${settings.token}` : ''

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

  const closeViews = useCallback(() => setViewsOpen(false), [])

  // Switching views swaps the whole listing, so bring the user back to the
  // controls that changed it instead of leaving them mid-grid.
  const revealToolbar = useCallback(() => {
    toolbarRef.current?.scrollIntoView({ block: 'start' })
  }, [])

  const showSelection = useCallback(
    (nextQuery: string, nextFilters: Filters) => {
      setQuery(nextQuery)
      setDebouncedQuery(nextQuery)
      setFilters(nextFilters)
      setViewsOpen(false)
      revealToolbar()
    },
    [revealToolbar, setDebouncedQuery],
  )

  const savedViews = useSavedViews({
    query,
    filters,
    scope: folderReleases,
    masterYears,
    onSelect: showSelection,
  })
  const { activeView, dirty: viewDirty } = savedViews

  const detail = useReleaseDetail({
    releases,
    masterYears,
    candidates: filtered,
    username: settings?.username ?? null,
    pickerSkip,
  })
  const { selected } = detail

  // Loaded while the cabinet or a release is open: both can put a record on display.
  const cabinet = useCabinet({
    username: settings?.username ?? '',
    token: settings?.token ?? null,
    releases: displayReleases,
    enabled: Boolean(settings) && (showCabinet || selected !== null),
    // The release-notes scan only runs while the cabinet itself shows.
    collectionReady: showCabinet && status === 'idle',
  })

  const { close: closeDetail } = detail
  const { deselect: deselectView } = savedViews
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
    closeDetail()
    deselectView()
    setShowCabinet(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [accountKey, closeDetail, deselectView])

  const artistCount = grouped.length
  const totalMatching = filtered.length
  const uniqueMatching = useMemo(() => countUniqueAlbums(filtered), [filtered])

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
    savedViews.deselect()
  }

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
    detail.close()
    clearSettings()
    // Saved views live in their own storage key, so "clear everything" has to
    // take them down explicitly to keep reclaiming everything it claims to.
    savedViews.wipe()
    setSettings(null)
    setShowSettings(true)
  }

  const isLoadingFirst = status === 'loading' && releases.length === 0
  const isLoadingFailed = status === 'error' && releases.length === 0

  return (
    <>
      {databaseState !== 'ok' && <DatabaseBanner state={databaseState} />}

      {/* Full-screen settings (no saved settings, or opened from menu) */}
      {showSettings && (
        <SettingsOverlay
          username={settings?.username ?? null}
          initial={settings ?? { username: '', token: '', theme }}
          theme={theme}
          onThemeChange={onThemeChange}
          onSave={onSaveSettings}
          groupPressings={preferences.groupPressings}
          onGroupPressingsChange={changeGroupPressings}
          pickerSkip={pickerSkip}
          onPickerSkipChange={changePickerSkip}
          onRefresh={
            settings
              ? () => {
                  // Close, so the sync banner shows what's happening.
                  setShowSettings(false)
                  refresh()
                }
              : undefined
          }
          refreshing={status === 'loading'}
          lastSynced={fetchedAt ? formatTime(fetchedAt) : undefined}
          onClose={settings ? () => setShowSettings(false) : undefined}
          advancedOpen={advancedOpen}
          onToggleAdvanced={() => setAdvancedOpen((open) => !open)}
          onClearData={onClearData}
        />
      )}

      {isLoadingFirst && <FirstLoad progress={progress} wait={syncWait} />}

      {/* First-load error (no cached data) */}
      {isLoadingFailed && (
        <LoadFailed error={error} onRetry={refresh} onOpenSettings={() => setShowSettings(true)} />
      )}

      {/* Main app (have data or background-refreshing) */}
      {!isLoadingFirst && !isLoadingFailed && settings && (
        <div className="app">
          <AppHeader
            releaseCount={releases.length}
            fetchedAt={fetchedAt}
            onOpenCabinet={() => setShowCabinet(true)}
            onOpenStats={() => setShowStats(true)}
            onOpenSettings={() => setShowSettings(true)}
          />

          {status === 'loading' && releases.length > 0 && <SyncBanner progress={progress} wait={syncWait} />}
          {status === 'error' && releases.length > 0 && <SyncFailedBanner error={error} onRetry={refresh} />}

          <FolderBar folders={folders} selection={folderSelection} onToggle={onFolderChange} />

          <Toolbar
            ref={toolbarRef}
            query={query}
            onQueryChange={setQuery}
            filters={filters}
            filtersOpen={filtersOpen}
            onToggleFilters={() => {
              setFiltersOpen((open) => !open)
              setViewsOpen(false)
            }}
            views={savedViews.views}
            activeView={activeView}
            viewDirty={viewDirty}
            viewsOpen={viewsOpen}
            onToggleViews={() => {
              setViewsOpen((open) => !open)
              setFiltersOpen(false)
            }}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            sortMode={artistSortMode}
            onSortModeChange={setArtistSortMode}
          />

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
              views={savedViews.views}
              counts={savedViews.counts}
              activeView={activeView}
              dirty={viewDirty}
              canSave={savedViews.canSave}
              onApply={savedViews.apply}
              onClear={savedViews.clear}
              onSave={savedViews.add}
              onRename={savedViews.rename}
              onDelete={savedViews.remove}
              onUpdate={savedViews.update}
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
              <div className="empty-actions">
                {!activeView ? (
                  <button type="button" onClick={savedViews.clear}>
                    Clear search &amp; filters
                  </button>
                ) : viewDirty ? (
                  <button type="button" onClick={() => savedViews.apply(activeView)}>
                    Revert to “{activeView.name}”
                  </button>
                ) : (
                  <button type="button" onClick={savedViews.clear}>
                    Show all releases
                  </button>
                )}
              </div>
            </div>
          ) : viewMode === 'recent' ? (
            <RecentList sections={recentSections} onSelectRelease={detail.openRelease} />
          ) : (
            <div className="artist-list">
              {grouped.map((artist) => (
                <ArtistSection
                  key={artist.id}
                  artist={artist}
                  sortMode={artistSortMode}
                  grouped={preferences.groupPressings}
                  onSelectRelease={detail.openRelease}
                  onOpenStack={detail.openStack}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {/* Record cabinet overlay */}
      {showCabinet && settings && (
        <CabinetScreen
          cabinet={cabinet}
          releases={displayReleases}
          collectionReady={status === 'idle'}
          onOpenRelease={detail.openRelease}
          onClose={() => setShowCabinet(false)}
        />
      )}

      {/* Release detail overlay */}
      {selected && (
        <ReleaseDetail
          display={selected}
          token={settings?.token ?? ''}
          recentPicks={detail.recentPicks ?? undefined}
          onOpenPick={detail.openPick}
          onPrev={detail.stack ? () => detail.stepStack(-1) : undefined}
          onNext={detail.stack ? () => detail.stepStack(1) : undefined}
          position={
            detail.stack ? { index: detail.stack.index + 1, total: detail.stack.pressings.length } : undefined
          }
          displayed={cabinet.displayed.some((record) => record.instanceId === selected.instanceId)}
          onToggleDisplayed={settings ? () => cabinet.toggleDisplayed(selected) : undefined}
          gatefold={isGatefold(selected, cabinet.sleeves)}
          gatefoldSource={sleeveSource(selected, cabinet.sleeves)}
          onToggleGatefold={
            settings && sizeClassOf(selected) !== 'other'
              ? () => cabinet.toggleGatefold(selected)
              : undefined
          }
          onClose={detail.close}
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
      {!showSettings && !showCabinet && !showStats && !isLoadingFirst && !isLoadingFailed && (
        <button
          type="button"
          className="random-fab"
          onClick={detail.pickRandom}
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
