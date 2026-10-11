// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

/** Compact "3m ago" style stamp for event history. */
export function formatRelativeTime(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })
}
