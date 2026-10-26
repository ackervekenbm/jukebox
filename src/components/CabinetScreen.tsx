// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import type { DisplayRelease } from '../utils/collection'
import { useScrollLock } from '../hooks/useScrollLock'
import { useCabinet, type CabinetStatus } from '../hooks/useCabinet'
import { SIZE_CLASS_LABELS, conflictLabel, spaceUnitsOf } from '../utils/cabinet'
import { CloseIcon, TrashIcon } from './icons'
import { useState } from 'react'

const STATUS_TEXT: Record<CabinetStatus, string> = {
  local: 'Saved on this device',
  loading: 'Checking the server…',
  syncing: 'Saving…',
  synced: 'Synced',
  offline: 'Offline — will retry',
  error: 'Could not sync',
}

const SORTS = [
  { id: 'artist', label: 'Artist' },
  { id: 'title', label: 'Title' },
  { id: 'year', label: 'Year' },
] as const

interface CabinetScreenProps {
  username: string
  token: string | null
  releases: DisplayRelease[]
  onClose: () => void
}

export function CabinetScreen({ username, token, releases, onClose }: CabinetScreenProps) {
  useScrollLock(true)
  const {
    cabinet,
    options,
    plan,
    status,
    error,
    setName,
    addSlot,
    updateSlot,
    removeSlot,
    setSort,
    setSeparateSizeClasses,
    retry,
  } = useCabinet({ username, token, releases, enabled: true })

  const placed = Object.keys(plan.placements).length
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [adding, setAdding] = useState(false)
  const [newCapacity, setNewCapacity] = useState('75')

  const toggleExpanded = (slotId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(slotId)) next.delete(slotId)
      else next.add(slotId)
      return next
    })
  }

  const handleAdd = () => {
    const cap = Math.max(1, Math.round(Number(newCapacity) || 75))
    addSlot(cap)
    setNewCapacity(String(cap))
    setAdding(false)
  }

  const recordRow = (record: DisplayRelease) => (
    <li className="cabinet-record" key={record.key}>
      {record.thumb ? (
        <img className="cabinet-record-art" src={record.thumb} alt="" loading="lazy" />
      ) : (
        <span className="cabinet-record-art placeholder" aria-hidden="true" />
      )}
      <span className="cabinet-record-text">
        <span className="cabinet-record-title">{record.title}</span>
        <span className="cabinet-record-artist">{record.artistName}</span>
      </span>
      {record.year > 0 && <span className="cabinet-record-year">{record.year}</span>}
      {spaceUnitsOf(record) > 1 && (
        <span className="cabinet-record-space" title="Gatefold — takes two spaces">
          2 spaces
        </span>
      )}
    </li>
  )

  return (
    <div
      className="detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Record cabinet"
      onClick={onClose}
    >
      <div className="detail-card cabinet-card" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="card-close" onClick={onClose} aria-label="Close cabinet">
          <CloseIcon />
        </button>

        <div className="card-scroll">
          <header className="cabinet-head">
            <input
              className="cabinet-name"
              value={cabinet.name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Cabinet name"
            />
            <span className={`cabinet-sync ${status}`} aria-live="polite">
              {STATUS_TEXT[status]}
            </span>
          </header>

          <p className="cabinet-summary">
            {releases.length.toLocaleString()} releases · {placed.toLocaleString()} placed
            {plan.unplaced.length > 0 && ` · ${plan.unplaced.length.toLocaleString()} without a slot`}
          </p>

          <div className="cabinet-tools">
            <div className="global-sort">
              <span className="global-sort-label">Sort</span>
              <div className="sort-toggle" role="radiogroup" aria-label="Sort cabinet by">
                {SORTS.map((sort) => (
                  <button
                    key={sort.id}
                    type="button"
                    role="radio"
                    aria-checked={options.sort === sort.id}
                    className={options.sort === sort.id ? 'active' : ''}
                    onClick={() => setSort(sort.id)}
                  >
                    {sort.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="cabinet-toggle">
              <input
                type="checkbox"
                checked={options.separateSizeClasses}
                onChange={(event) => setSeparateSizeClasses(event.target.checked)}
              />
              Keep 12&quot; and 7&quot; apart
            </label>

            {adding ? (
              <div className="cabinet-add">
                <label className="cabinet-slot-capacity">
                  <span>Shelf size</span>
                  <input
                    type="number"
                    min={1}
                    value={newCapacity}
                    onChange={(event) => setNewCapacity(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleAdd()
                      if (event.key === 'Escape') setAdding(false)
                    }}
                    autoFocus
                  />
                </label>
                <button type="button" className="secondary-btn" onClick={handleAdd}>
                  Add
                </button>
                <button type="button" className="secondary-btn" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setNewCapacity('75')
                  setAdding(true)
                }}
              >
                Add shelf
              </button>
            )}
          </div>

          {error && (
            <div className="sync-banner error" role="alert">
              {error}
              <button type="button" onClick={retry}>
                Retry
              </button>
            </div>
          )}

          {plan.conflicts.length > 0 && (
            <ul className="cabinet-conflicts" aria-label="Cabinet warnings">
              {plan.conflicts.map((conflict, index) => (
                <li key={`${conflict.type}-${index}`} className={`cabinet-conflict ${conflict.type}`}>
                  {conflictLabel(conflict)}
                </li>
              ))}
            </ul>
          )}

          <div className="cabinet-slots">
            {plan.slots.map((slot) => {
              const isExpanded = expanded.has(slot.slot.id)
              return (
                <section key={slot.slot.id} className="cabinet-slot">
                  <button
                    type="button"
                    className="cabinet-slot-head cabinet-slot-toggle"
                    onClick={() => toggleExpanded(slot.slot.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`cabinet-slot-${slot.slot.id}`}
                  >
                    <span className="cabinet-slot-toggle-label">{slot.slot.label}</span>
                    <span className="cabinet-slot-count" title="Record spaces used">
                      {slot.used.toLocaleString()} / {slot.slot.capacity.toLocaleString()}
                    </span>
                    <span className="cabinet-slot-count" title="Records on shelf">
                      {slot.records.length.toLocaleString()} records
                    </span>
                    {slot.sizeClass !== 'mixed' && (
                      <span className="cabinet-tag">{SIZE_CLASS_LABELS[slot.sizeClass]}</span>
                    )}
                    {slot.sizeClass === 'mixed' && <span className="cabinet-tag warn">Mixed sizes</span>}
                    {slot.overCapacity > 0 && (
                      <span className="cabinet-tag danger">
                        {slot.overCapacity} over capacity
                      </span>
                    )}
                    <span className="cabinet-slot-chevron">{isExpanded ? '▾' : '▸'}</span>
                  </button>

                  {isExpanded && (
                    <div id={`cabinet-slot-${slot.slot.id}`} className="cabinet-slot-body">
                      <div className="cabinet-slot-tools">
                        <input
                          className="cabinet-slot-label"
                          value={slot.slot.label}
                          onChange={(event) => updateSlot(slot.slot.id, { label: event.target.value })}
                          aria-label="Shelf name"
                        />
                        <label className="cabinet-slot-capacity">
                          <span>Capacity</span>
                          <input
                            type="number"
                            min={1}
                            aria-label={`Capacity of ${slot.slot.label}`}
                            value={slot.slot.capacity}
                            onChange={(event) => {
                              const capacity = Math.max(1, Math.round(Number(event.target.value) || 1))
                              updateSlot(slot.slot.id, { capacity })
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => removeSlot(slot.slot.id)}
                          disabled={cabinet.slots.length <= 1}
                          title="Remove shelf"
                          aria-label={`Remove ${slot.slot.label}`}
                        >
                          <TrashIcon />
                        </button>
                      </div>

                      {slot.records.length === 0 ? (
                        <p className="cabinet-empty">Nothing on this shelf yet.</p>
                      ) : (
                        <ul className="cabinet-records">
                          {slot.records.map((record) => recordRow(record.display))}
                        </ul>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>

          {plan.unplaced.length > 0 && (
            <section className="cabinet-slot cabinet-unplaced">
              <h3>Without a shelf</h3>
              <p className="cabinet-hint">
                These do not fit anywhere yet — add a shelf or raise a capacity.
              </p>
              <ul className="cabinet-records">{plan.unplaced.map((record) => recordRow(record))}</ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
