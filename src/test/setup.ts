// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// React act() support for @testing-library/react under Vitest.
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no layout engine, so `scrollIntoView` — how the app brings swapped
// content back into view — is missing. Stub it: no test asserts on scrolling,
// but a click handler that calls it must not throw. Server tests run in the
// node environment where there is no Element at all.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}

// @testing-library/react can't auto-register its cleanup without a global
// afterEach; Vitest runs with globals disabled here.
afterEach(() => {
  cleanup()
})