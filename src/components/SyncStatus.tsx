// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { DatabaseState } from '../db/database'
import type { SyncProgress } from '../hooks/useCollection'
import { RecordPlayer } from './icons'

function progressText(progress: SyncProgress): string {
  if (progress.phase === 'years') {
    return `Retrieving original release years… ${progress.loaded.toLocaleString()} / ${progress.total.toLocaleString()}`
  }
  return `Fetching releases… ${progress.loaded.toLocaleString()} / ${progress.total.toLocaleString()}`
}

interface ProgressProps {
  progress: SyncProgress | null
  /** Why the sync isn't moving (a rate-limit pause, a slow answer), if it isn't. */
  wait: string | null
}

/** Full screen while the first sync runs and there's nothing cached to show. */
export function FirstLoad({ progress, wait }: ProgressProps) {
  return (
    <div className="full-state">
      <RecordPlayer size={150} />
      <p>Loading your collection…</p>
      {progress && (
        <p className="progress-text">
          {progressText(progress)}
          {wait && ` — ${wait}`}
        </p>
      )}
    </div>
  )
}

/** Full screen when the first sync failed and there's nothing cached to show. */
export function LoadFailed({ error, onRetry, onOpenSettings }: { error: string | null; onRetry: () => void; onOpenSettings: () => void }) {
  return (
    <div className="full-state error">
      <div className="error-icon" role="img" aria-label="Error">
        !
      </div>
      <h2>Could not load your collection</h2>
      <p className="error-message">{error}</p>
      <div className="error-actions">
        <button type="button" onClick={onRetry}>
          Try again
        </button>
        <button type="button" onClick={onOpenSettings}>
          Change settings
        </button>
      </div>
    </div>
  )
}

/** The banner over a cached collection while it re-syncs. */
export function SyncBanner({ progress, wait }: ProgressProps) {
  return (
    <div className="sync-banner">
      {/* Announced: that it syncs, and why it waits. The count is not:
          it moves about once a second while years come in. */}
      <span role="status">
        Syncing…
        {wait && ` — ${wait}`}
      </span>
      {progress && <span> {progressText(progress)}</span>}
    </div>
  )
}

export function SyncFailedBanner({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="sync-banner error" role="alert">
      Failed to refresh: {error}. Showing cached data.
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

/** Another tab holds an older or newer version of the browser database. */
export function DatabaseBanner({ state }: { state: Exclude<DatabaseState, 'ok'> }) {
  return (
    <div className="sync-banner error database-banner" role="alert">
      {state === 'blocked'
        ? 'Jukebox is updating its storage. Close Jukebox in your other tabs or windows to continue.'
        : 'Jukebox was updated in another tab. Reload to continue.'}
      {state === 'outdated' && (
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      )}
    </div>
  )
}
