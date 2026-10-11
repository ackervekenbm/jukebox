// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { FormEvent, ReactNode } from 'react'
import type { Settings as SettingsType } from '../db/settings'
import type { ThemeId } from '../theme'
import { THEMES } from '../theme'
import { VinylIcon, CloseIcon } from './icons'

interface SettingsProps {
  initial: SettingsType
  theme: ThemeId
  onThemeChange: (theme: ThemeId) => void
  onSave: (settings: SettingsType) => void
  /** How many recent picks the random picker should avoid. */
  pickerSkip: number
  /** Fires on every edit; the caller clamps and persists immediately. */
  onPickerSkipChange: (skip: number) => void
  onClose?: () => void
  children?: ReactNode
}

export function SettingsForm({
  initial,
  theme,
  onThemeChange,
  onSave,
  pickerSkip,
  onPickerSkipChange,
  onClose,
  children,
}: SettingsProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const username = String(formData.get('username') ?? '').trim()
    const token = String(formData.get('token') ?? '').trim()
    if (!username || !token) return
    onSave({ username, token, theme })
  }

  return (
    <div className="settings-wrap">
      <div className="settings-card">
        {onClose && (
          <button
            type="button"
            className="card-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            <CloseIcon />
          </button>
        )}

        <div className="card-scroll">
          <div className="settings-logo">
            <VinylIcon size={50} />
          </div>
          <h1>Vinyl Vault</h1>
          <p className="settings-sub">Your Discogs collection, beautifully browsable.</p>

          <form onSubmit={handleSubmit} className="settings-form">
            <label htmlFor="username">
              Discogs username
              <input
                type="text"
                id="username"
                name="username"
                defaultValue={initial.username}
                required
                autoComplete="username"
                spellCheck={false}
                placeholder="e.g. your-discogs-user"
              />
            </label>

            <label htmlFor="token">
              Personal access token
              <input
                type="password"
                id="token"
                name="token"
                defaultValue={initial.token}
                required
                autoComplete="current-password"
                placeholder="Create at discogs.com/settings/developers"
              />
              <span className="settings-help">
                <a
                  href="https://www.discogs.com/settings/developers"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Generate a token
                </a>{' '}
                &middot; It stays in your browser, never sent anywhere else.
              </span>
            </label>

            <button type="submit">Load collection</button>
          </form>

          <div className="theme-section">
            <span className="theme-heading">UI style</span>
            <div className="theme-picker" role="radiogroup" aria-label="UI style">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.id}
                  className={`theme-chip${theme === t.id ? ' active' : ''}`}
                  onClick={() => onThemeChange(t.id)}
                >
                  <span className="theme-swatch" style={{ background: t.bg }}>
                    <span className="theme-swatch-dot" style={{ background: t.accent }} />
                  </span>
                  <span className="theme-label">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="theme-section">
            <span className="theme-heading">Random picker</span>
            <label className="picker-skip" htmlFor="picker-skip">
              Skip the last
              <input
                id="picker-skip"
                type="number"
                min={0}
                max={100}
                step={1}
                value={pickerSkip}
                onChange={(event) =>
                  onPickerSkipChange(event.target.value === '' ? 0 : Number(event.target.value))
                }
              />
              recently played picks
            </label>
            <span className="settings-help">
              The picker avoids the last N picks while the collection still has something else to
              offer. Set it to 0 to allow instant repeats.
            </span>
          </div>

          {children}

          <p className="settings-build">
            {__BUILD_SHA__ === 'dev' ? (
              'development build'
            ) : (
              <>
                <a
                  href={`https://github.com/${__REPO__}/commit/${__BUILD_SHA__}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {__BUILD_SHA__.slice(0, 7)}
                </a>
                {__BUILD_TIME__ && (
                  <>
                    {' · '}
                    {new Date(__BUILD_TIME__).toLocaleDateString([], {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </>
                )}
                {' · '}
                <a
                  href={`https://github.com/${__REPO__}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Report an issue
                </a>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
