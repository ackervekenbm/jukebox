// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReleaseCard } from './ReleaseCard'
import { toDisplayRelease } from '../utils/collection'
import { release } from '../test/factories'
import type { DisplayRelease } from '../utils/collection'

const display: DisplayRelease = toDisplayRelease(
  release({ basic_information: { ...release().basic_information, title: 'Closer', year: 1980 } }),
)

describe('ReleaseCard', () => {
  it('names its button after the artist and title, and keeps the details as plain text', () => {
    render(<ReleaseCard display={display} onOpen={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Test Artist — Closer' })
    expect(button).toHaveTextContent('Closer')
    // The card itself is no button, so its year stays readable on its own.
    expect(screen.getByRole('article')).not.toHaveAttribute('role')
    expect(button).not.toContainElement(screen.getByText('1980'))
  })

  it('opens the release on click, Enter and Space', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<ReleaseCard display={display} onOpen={onOpen} />)
    const button = screen.getByRole('button')

    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onOpen).toHaveBeenCalledTimes(3)
    expect(onOpen).toHaveBeenCalledWith(display)
  })

  it('has no button when nothing opens it', () => {
    render(<ReleaseCard display={display} />)
    expect(screen.getByText('Closer')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the artist credit only when asked to', () => {
    const { rerender } = render(<ReleaseCard display={display} onOpen={vi.fn()} />)
    expect(screen.queryByText('Test Artist')).toBeNull()

    rerender(<ReleaseCard display={display} onOpen={vi.fn()} showArtist />)
    expect(screen.getByText('Test Artist')).toBeInTheDocument()
    // The accessible name carries the credit either way.
    expect(screen.getByRole('button')).toHaveAccessibleName('Test Artist — Closer')
  })

  it('labels a missing cover as an image', () => {
    const bare = { ...display, coverImage: '' }
    render(<ReleaseCard display={bare} onOpen={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'No cover art' })).toBeInTheDocument()
  })
})
