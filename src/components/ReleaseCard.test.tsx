// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReleaseCard } from './ReleaseCard'
import { toDisplayRelease } from '../utils/collection'
import { release } from '../test/factories'
import type { DisplayRelease } from '../utils/collection'

const display: DisplayRelease = toDisplayRelease(
  release({ basic_information: { ...release().basic_information, title: 'Closer' } }),
)

describe('ReleaseCard', () => {
  it('renders the title and aria-label', () => {
    render(<ReleaseCard display={display} />)
    expect(screen.getByText('Closer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test Artist — Closer' })).toBeInTheDocument()
  })

  it('opens the release on click', () => {
    const onOpen = vi.fn()
    render(<ReleaseCard display={display} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith(display)
  })

  it('opens the release via Enter and Space', () => {
    const onOpen = vi.fn()
    render(<ReleaseCard display={display} onOpen={onOpen} />)
    const card = screen.getByRole('button')
    fireEvent.keyDown(card, { key: 'Enter' })
    fireEvent.keyDown(card, { key: ' ' })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('shows the artist credit only when asked to', () => {
    const { rerender } = render(<ReleaseCard display={display} />)
    expect(screen.queryByText('Test Artist')).toBeNull()

    rerender(<ReleaseCard display={display} showArtist />)
    expect(screen.getByText('Test Artist')).toBeInTheDocument()
    // The accessible name carries the credit either way.
    expect(screen.getByRole('button')).toHaveAccessibleName('Test Artist — Closer')
  })
})