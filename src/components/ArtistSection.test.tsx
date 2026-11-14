// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeRecord } from '../test/factories'
import { ArtistSection } from './ArtistSection'

const artist = {
  id: 'Herbie Hancock',
  name: 'Herbie Hancock',
  sortKey: 'hancock herbie',
  letter: 'H',
  releases: [fakeRecord({ artist: 'Herbie Hancock', title: 'Head Hunters', year: 1973 })],
}

function renderSection() {
  render(
    <ArtistSection
      artist={artist}
      sortMode="chronological"
      grouped={false}
      onSelectRelease={vi.fn()}
      onOpenStack={vi.fn()}
    />,
  )
  return screen.getByRole('button', { name: 'Herbie Hancock' })
}

describe('ArtistSection header', () => {
  it('keeps the artist name a heading, with the toggle inside it', () => {
    const toggle = renderSection()
    const heading = screen.getByRole('heading', { level: 2, name: 'Herbie Hancock' })
    expect(heading).toContainElement(toggle)
  })

  it('points the toggle at the releases while they show, with an id that resolves', () => {
    const toggle = renderSection()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const controlled = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(controlled).toBe(screen.getByRole('region', { name: 'Releases by Herbie Hancock' }))
  })

  it('folds and unfolds, and drops aria-controls while nothing is shown', async () => {
    const user = userEvent.setup()
    const toggle = renderSection()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('region')).toBeNull()

    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Head Hunters')).toBeInTheDocument()
  })
})
