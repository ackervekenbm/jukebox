// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StorageStats } from './StorageStats'

describe('StorageStats', () => {
  it('styles itself with storage-* classes only, never the Stats screen’s stats-*', async () => {
    const { container } = render(<StorageStats username="alice" onClearData={() => {}} />)
    await screen.findByRole('button', { name: /clear everything/i })

    const classes = [...container.querySelectorAll('[class]')].flatMap((el) => [...el.classList])
    expect(classes.some((name) => name.startsWith('storage-'))).toBe(true)
    expect(classes.filter((name) => name.startsWith('stats-'))).toEqual([])
  })
})
