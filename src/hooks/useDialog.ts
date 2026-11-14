// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useEffect, useRef } from 'react'

/**
 * Modal-sheet basics: focus moves into the sheet when it opens and back to
 * whatever had it when it closes, and Escape closes it, but only while it is
 * the topmost modal (a release detail opened over the cabinet closes first).
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
      // A field inside that handles Escape itself (preventDefault) keeps the sheet open.
      if (event.key !== 'Escape' || event.defaultPrevented || !closeRef.current || !ref.current) return
      const modals = document.querySelectorAll('[aria-modal="true"]')
      if (modals[modals.length - 1] !== ref.current) return
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open])

  return ref
}
