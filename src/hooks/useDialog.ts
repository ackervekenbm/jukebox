// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useEffect, useRef } from 'react'

/** Marks the elements this hook made inert, so it only ever undoes its own. */
const MARK = 'data-inert-behind-dialog'

/**
 * Makes everything outside the topmost open sheet inert: no focus, no clicks,
 * and gone for screen readers, which `aria-modal` alone doesn't guarantee.
 * Called whenever a sheet opens or closes, so a lower sheet comes back to
 * life when the one over it closes; `closing` is left out even while it is
 * still in the DOM (React StrictMode runs a cleanup before unmounting).
 */
function inertBehindTopmostSheet(closing?: HTMLElement) {
  for (const el of document.querySelectorAll<HTMLElement>(`[${MARK}]`)) {
    el.removeAttribute('inert')
    el.removeAttribute(MARK)
  }
  const modals = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter((m) => m !== closing)
  let el: HTMLElement | null = modals[modals.length - 1] ?? null
  while (el && el !== document.body && el.parentElement) {
    for (const sibling of el.parentElement.children) {
      if (sibling === el || sibling.hasAttribute('inert')) continue
      sibling.setAttribute('inert', '')
      sibling.setAttribute(MARK, '')
    }
    el = el.parentElement
  }
}

/**
 * Modal-sheet basics: focus moves into the sheet when it opens and back to
 * whatever had it when it closes, the page behind it is inert, and Escape
 * closes it, all only while it is the topmost modal (a release detail opened
 * over the cabinet closes first). A control that acts on the sheet, like the
 * shuffle button over a random pick, belongs inside it.
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
    inertBehindTopmostSheet()
    const dialog = ref.current
    if (dialog && !dialog.contains(document.activeElement)) {
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1')
      dialog.focus({ preventScroll: true })
    }

    const onKey = (event: KeyboardEvent) => {
      const sheet = ref.current
      // A field inside that handles Escape itself (preventDefault) keeps the sheet open.
      if (event.key !== 'Escape' || event.defaultPrevented || !sheet || !closeRef.current) return
      const modals = document.querySelectorAll('[aria-modal="true"]')
      if (modals[modals.length - 1] === sheet) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // Wakes up whatever was under this sheet, so focus can go back there.
      inertBehindTopmostSheet(dialog ?? undefined)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open])

  return ref
}
