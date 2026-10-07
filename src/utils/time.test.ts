// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './time'

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 5, 15, 12, 0, 0)

  it('describes recent stamps in minutes', () => {
    expect(formatRelativeTime(now, now)).toBe('just now')
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatRelativeTime(now - 59 * 60_000, now)).toBe('59m ago')
  })

  it('rolls up to hours and days', () => {
    expect(formatRelativeTime(now - 60 * 60_000, now)).toBe('1h ago')
    expect(formatRelativeTime(now - 26 * 60 * 60_000, now)).toBe('1d ago')
    expect(formatRelativeTime(now - 29 * 24 * 60 * 60_000, now)).toBe('29d ago')
  })

  it('falls back to a date for old stamps, matching the impl locale', () => {
    const at = now - 40 * 24 * 60 * 60_000
    expect(formatRelativeTime(at, now)).toBe(
      new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    )
  })

  it('treats a future clock skew as just now', () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe('just now')
  })
})
