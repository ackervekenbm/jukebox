// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { ComponentProps } from 'react'
import { useDialog } from '../hooks/useDialog'
import { useScrollLock } from '../hooks/useScrollLock'
import { ChevronIcon } from './icons'
import { SettingsForm } from './Settings'
import { StorageStats } from './StorageStats'

type SettingsOverlayProps = Omit<ComponentProps<typeof SettingsForm>, 'children' | 'onClose'> & {
  /** Signed in: the account the Advanced section's storage figures belong to. */
  username: string | null
  /** Closes the overlay; missing on first run, when there is no account to go back to. */
  onClose?: () => void
  advancedOpen: boolean
  onToggleAdvanced: () => void
  onClearData: () => void
}

/** Settings over the app: full screen on first run, a closable sheet once signed in. */
export function SettingsOverlay({
  username,
  onClose,
  advancedOpen,
  onToggleAdvanced,
  onClearData,
  ...form
}: SettingsOverlayProps) {
  // Escape closes settings only once there is an account to go back to.
  const dialogRef = useDialog<HTMLDivElement>(onClose)
  useScrollLock(true)

  return (
    <div
      ref={dialogRef}
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={onClose}
    >
      <div className="settings-overlay-content" onClick={(e) => e.stopPropagation()}>
        <SettingsForm {...form} onClose={onClose}>
          {username && (
            <section className="advanced-section">
              <button
                type="button"
                className="advanced-toggle"
                onClick={onToggleAdvanced}
                aria-expanded={advancedOpen}
                aria-controls={advancedOpen ? 'advanced-panel' : undefined}
              >
                <span>Advanced</span>
                <span className="collapse-indicator" aria-hidden="true">
                  <ChevronIcon direction={advancedOpen ? 'up' : 'down'} />
                </span>
              </button>
              {advancedOpen && (
                <div id="advanced-panel" className="advanced-body">
                  <StorageStats username={username} onClearData={onClearData} />
                </div>
              )}
            </section>
          )}
        </SettingsForm>
      </div>
    </div>
  )
}
