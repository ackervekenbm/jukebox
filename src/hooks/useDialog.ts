// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Where Tab may go while `dialog` is on top: its own controls, then any
 * control marked `data-modal-companion` that floats over it and acts on it
 * (the shuffle button over a release picked at random).
 */
function tabStops(dialog: HTMLElement): HTMLElement[] {
  const usable = (el: HTMLElement) => !el.closest('[hidden], [inert]')
  return [
    ...dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
    ...document.querySelectorAll<HTMLElement>(`[data-modal-companion]:is(${FOCUSABLE})`),
  ].filter(usable)
}

/**
 * Modal-sheet basics: focus moves into the sheet when it opens and back to
 * whatever had it when it closes, Tab and Shift+Tab cycle inside it, and
 * Escape closes it, all only while it is the topmost modal (a release detail
 * opened over the cabinet closes first).
 * Put the returned ref on the element with `aria-modal="true"`; pass `open` when
 * the sheet is rendered conditionally inside a longer-lived component.
 */
export function useDialog<T extends HTMLElement>(onClose?: () => void, open = true) {
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    if (dialog && !dialog.contains(document.activeElement)) {
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1')
      dialog.focus({ preventScroll: true })
    }

    const onKey = (event: KeyboardEvent) => {
      const sheet = ref.current
      // A field inside that handles Escape itself (preventDefault) keeps the sheet open.
      if (event.defaultPrevented || !sheet) return
      const modals = document.querySelectorAll('[aria-modal="true"]')
      if (modals[modals.length - 1] !== sheet) return

      if (event.key === 'Tab') {
        // Keep keyboard focus out of the page behind the sheet.
        event.preventDefault()
        const stops = tabStops(sheet)
        if (stops.length === 0) return sheet.focus()
        const index = stops.indexOf(document.activeElement as HTMLElement)
        const step = event.shiftKey ? -1 : 1
        const next = index === -1 ? (event.shiftKey ? stops.length - 1 : 0) : (index + step + stops.length) % stops.length
        stops[next].focus()
      } else if (event.key === 'Escape' && closeRef.current) {
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open])

  return ref
}
