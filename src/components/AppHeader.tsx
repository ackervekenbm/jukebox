// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { formatTime } from '../utils/format'
import { CabinetIcon, SettingsIcon, StatsIcon } from './icons'

interface AppHeaderProps {
  releaseCount: number
  fetchedAt: number | null
  onOpenCabinet: () => void
  onOpenStats: () => void
  onOpenSettings: () => void
}

export function AppHeader({ releaseCount, fetchedAt, onOpenCabinet, onOpenStats, onOpenSettings }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="header-top">
        <h1 className="app-title">Jukebox</h1>
        <div className="header-actions">
          <button type="button" className="icon-btn" onClick={onOpenCabinet} title="Record cabinet" aria-label="Record cabinet">
            <CabinetIcon />
          </button>
          <button type="button" className="icon-btn" onClick={onOpenStats} title="Collection stats" aria-label="Collection stats">
            <StatsIcon />
          </button>
          <button type="button" className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
            <SettingsIcon />
          </button>
        </div>
      </div>
      <div className="header-meta">
        <span>{releaseCount.toLocaleString()} releases</span>
        {fetchedAt && <span className="meta-separator">·</span>}
        {fetchedAt && <span>Last synced {formatTime(fetchedAt)}</span>}
      </div>
    </header>
  )
}
