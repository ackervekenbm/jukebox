// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useEffect, useState } from 'react'

/**
 * Debounces the search box while typing, but also hands back a setter that
 * applies a value immediately — a saved view should switch the listing at once
 * rather than wait out the typing delay.
 */
export function useDebounced<T>(value: T, delay: number): [T, (next: T) => void] {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return [debounced, setDebounced]
}
