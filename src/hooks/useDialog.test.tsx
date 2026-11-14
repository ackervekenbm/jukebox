// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('makes the page behind the topmost sheet inert, and wakes it up again on close', () => {
    const Page = ({ detail }: { detail: boolean }) => (
      <>
        <button type="button">Behind</button>
        <Sheet name="Cabinet">
          <button type="button">Cabinet button</button>
        </Sheet>
        {detail && (
          <Sheet name="Detail">
            <button type="button">Detail button</button>
          </Sheet>
        )}
      </>
    )
    const { rerender, container } = render(<Page detail />)
    const behind = screen.getByRole('button', { name: 'Behind' })
    const cabinet = screen.getByRole('dialog', { name: 'Cabinet' })
    const detail = screen.getByRole('dialog', { name: 'Detail' })
    expect(behind).toHaveAttribute('inert')
    expect(cabinet).toHaveAttribute('inert')
    expect(detail).not.toHaveAttribute('inert')
    expect(container).not.toHaveAttribute('inert')

    rerender(<Page detail={false} />)
    expect(behind).toHaveAttribute('inert')
    expect(cabinet).not.toHaveAttribute('inert')

    rerender(<button type="button">Behind</button>)
    expect(document.querySelector('[inert]')).toBeNull()
  })

  it('hands focus back to an opener that the sheet made inert, under StrictMode too', () => {
    const Page = ({ open }: { open: boolean }) => (
      <StrictMode>
        <button type="button">Shuffle</button>
        {open && <Sheet name="Detail" />}
      </StrictMode>
    )
    const { rerender } = render(<Page open={false} />)
    screen.getByRole('button', { name: 'Shuffle' }).focus()

    rerender(<Page open />)
    expect(screen.getByRole('dialog', { name: 'Detail' })).toHaveFocus()
    expect(screen.getByText('Shuffle')).toHaveAttribute('inert')

    rerender(<Page open={false} />)
    expect(screen.getByRole('button', { name: 'Shuffle' })).toHaveFocus()
  })

  it('leaves alone what was inert before it opened', () => {
    render(
      <>
        <div inert>Already inert</div>
        <Sheet name="Stats" />
      </>,
    )
    const already = screen.getByText('Already inert')
    cleanup()
    expect(already).toHaveAttribute('inert')
  })
})
