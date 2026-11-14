// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useDialog } from './useDialog'

function Sheet({ name, onClose, children }: { name: string; onClose?: () => void; children?: React.ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={name}>
      {children}
    </div>
  )
}

describe('useDialog', () => {
  it('moves focus into the sheet and back where it was on close', () => {
    const { rerender } = render(<button type="button">Open</button>)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()

    rerender(
      <>
        <button type="button">Open</button>
        <Sheet name="Stats" />
      </>,
    )
    expect(screen.getByRole('dialog', { name: 'Stats' })).toHaveFocus()

    rerender(<button type="button">Open</button>)
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
  })

  it('closes only the topmost sheet on Escape', () => {
    const closeCabinet = vi.fn()
    const closeDetail = vi.fn()
    render(
      <>
        <Sheet name="Cabinet" onClose={closeCabinet} />
        <Sheet name="Detail" onClose={closeDetail} />
      </>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeDetail).toHaveBeenCalledTimes(1)
    expect(closeCabinet).not.toHaveBeenCalled()
  })

  it('leaves the sheet open when a field inside handled Escape, or there is nothing to close to', () => {
    const onClose = vi.fn()
    render(
      <Sheet name="Cabinet" onClose={onClose}>
        <input aria-label="Shelf size" onKeyDown={(event) => event.key === 'Escape' && event.preventDefault()} />
      </Sheet>,
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Shelf size' }), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    render(<Sheet name="First run" />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps Tab and Shift+Tab inside the topmost sheet', () => {
    render(
      <>
        <button type="button">Behind</button>
        <Sheet name="Cabinet">
          <button type="button">Cabinet button</button>
        </Sheet>
        <Sheet name="Detail">
          <button type="button">First</button>
          <button type="button" disabled>
            Disabled
          </button>
          <button type="button">Last</button>
        </Sheet>
      </>,
    )
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    // Focus starts on the sheet itself: Tab goes to its first control.
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(last).toHaveFocus()
    // Past the end it wraps around instead of leaving for the page behind.
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('lets Tab reach a companion control floating over the sheet', () => {
    render(
      <>
        <button type="button">Behind</button>
        <Sheet name="Detail">
          <button type="button">Close</button>
        </Sheet>
        <button type="button" data-modal-companion>
          Shuffle
        </button>
      </>,
    )
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Shuffle' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })
})
