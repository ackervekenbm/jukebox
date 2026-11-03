// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { useSyncExternalStore } from 'react'
import { getDatabaseState, subscribeDatabaseState, type DatabaseState } from '../db/database'

/** Whether another tab is holding up (or has replaced) this tab's database. */
export function useDatabaseState(): DatabaseState {
  return useSyncExternalStore(subscribeDatabaseState, getDatabaseState)
}
