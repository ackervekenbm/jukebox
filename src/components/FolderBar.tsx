// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { DiscogsCollectionFolder } from '../types/discogs'

interface FolderBarProps {
  folders: DiscogsCollectionFolder[]
  /** Folder ids on screen; empty means every folder ("All"). */
  selection: number[]
  onToggle: (id: number) => void
}

/** Folder chips are toggles, so several folders can be browsed as one list. */
export function FolderBar({ folders, selection, onToggle }: FolderBarProps) {
  if (folders.length === 0) return null
  return (
    <div className="folder-bar" role="group" aria-label="Collection folders">
      {folders.map((folder) => {
        // "All" is the absence of a folder filter, so it is only active
        // while no specific folder is picked.
        const active = folder.id === 0 ? selection.length === 0 : selection.includes(folder.id)
        return (
          <button
            key={folder.id}
            type="button"
            aria-pressed={active}
            className={`folder-chip${active ? ' active' : ''}`}
            onClick={() => onToggle(folder.id)}
          >
            <span className="folder-name">{folder.name}</span>
            <span className="folder-count">{folder.count.toLocaleString()}</span>
          </button>
        )
      })}
    </div>
  )
}
