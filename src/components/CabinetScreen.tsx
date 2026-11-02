// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { sortYear, type DisplayRelease } from '../utils/collection'
import { useScrollLock } from '../hooks/useScrollLock'
import { useCabinet, type CabinetStatus } from '../hooks/useCabinet'
import {
  SIZE_CLASS_LABELS,
  conflictLabel,
  detectedGatefold,
  discCountOf,
  isGatefold,
  sizeClassOf,
  spaceUnitsOf,
} from '../utils/cabinet'
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

/** Expansion key for the "Without a shelf" section; shelf ids look like `slot-1`. */
const UNPLACED_ID = 'unplaced'

// The main view's in-artist order, with its labels; artists always come first.
const SORTS = [
  { id: 'chronological', label: 'Year', title: 'Oldest to newest within each artist' },
  { id: 'byName', label: 'A–Z', title: 'By album name within each artist' },
] as const

interface CabinetScreenProps {
  username: string
  token: string | null
  releases: DisplayRelease[]
  /** The collection is still loading or enriching; the gatefold scan waits for it. */
  collectionBusy?: boolean
  onClose: () => void
}

export function CabinetScreen({
  username,
  token,
  releases,
  collectionBusy = false,
  onClose,
}: CabinetScreenProps) {
  useScrollLock(true)
  const {
    options,
    plan,
    sleeves,
    gatefoldScan,
    status,
    error,
    addSlot,
    updateSlot,
    removeSlot,
    setSort,
    setSeparateSizeClasses,
    toggleGatefold,
    retry,
  } = useCabinet({ username, token, releases, enabled: true, collectionBusy })

  const placed = Object.keys(plan.placements).length
  const totalCapacity = plan.slots.reduce((total, slot) => total + slot.slot.capacity, 0)
  const gatefoldCount = releases.filter((record) => isGatefold(record, sleeves)).length
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const unplacedExpanded = expanded.has(UNPLACED_ID)
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

  const spaceReason = (record: DisplayRelease) => {
    const discs = discCountOf(record)
    const parts = []
    if (isGatefold(record, sleeves)) parts.push('Gatefold sleeve')
    if (discs > 1) parts.push(`${discs} discs`)
    return `${parts.join(', ')}: takes ${spaceUnitsOf(record, sleeves)} spaces`
  }

  // Says where the current call comes from, so a wrong one can be traced.
  const sleeveTitle = (record: DisplayRelease) => {
    const overridden = sleeves.overrides?.[String(record.id)] !== undefined
    if (overridden) {
      return isGatefold(record, sleeves)
        ? 'Gatefold — marked by you. Click to undo.'
        : 'Standard sleeve — marked by you. Click to undo.'
    }
    if (detectedGatefold(record, sleeves)) {
      return 'Gatefold — found on Discogs. Click if it is a standard sleeve.'
    }
    return 'Standard sleeve. Click to mark it as a gatefold.'
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
      {sortYear(record) > 0 && <span className="cabinet-record-year">{sortYear(record)}</span>}
      {spaceUnitsOf(record, sleeves) > 1 && (
        <span className="cabinet-record-space" title={spaceReason(record)}>
          {spaceUnitsOf(record, sleeves)} spaces
        </span>
      )}
      {sizeClassOf(record) !== 'other' && (
        <button
          type="button"
          className={`cabinet-sleeve-btn${isGatefold(record, sleeves) ? ' active' : ''}`}
          aria-pressed={isGatefold(record, sleeves)}
          aria-label={`Gatefold: ${record.title}`}
          title={sleeveTitle(record)}
          onClick={() => toggleGatefold(record)}
        >
          Gatefold
        </button>
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
            <h2 className="cabinet-name">Record Cabinet</h2>
            <span className={`cabinet-sync ${status}`} aria-live="polite">
              {STATUS_TEXT[status]}
            </span>
          </header>

          <p className="cabinet-summary">
            {releases.length.toLocaleString()} releases · {placed.toLocaleString()} placed
            {plan.unplaced.length > 0 && ` · ${plan.unplaced.length.toLocaleString()} without a slot`}
          </p>

          <section className="cabinet-settings" aria-label="Cabinet settings">
            <div className="cabinet-setting">
              <div className="cabinet-setting-text">
                <span className="cabinet-setting-title" id="cabinet-order-title">
                  Order within each artist
                </span>
                <span className="cabinet-setting-hint">
                  Artists are always filed by name, like the main view.
                </span>
              </div>
              <div
                className="sort-toggle cabinet-segmented"
                role="radiogroup"
                aria-label="Sort within each artist"
              >
                {SORTS.map((sort) => (
                  <button
                    key={sort.id}
                    type="button"
                    role="radio"
                    aria-checked={options.sort === sort.id}
                    className={options.sort === sort.id ? 'active' : ''}
                    onClick={() => setSort(sort.id)}
                    title={sort.title}
                  >
                    {sort.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="cabinet-setting">
              <div className="cabinet-setting-text">
                <span className="cabinet-setting-title" id="cabinet-sizes-title">
                  Separate record sizes
                </span>
                <span className="cabinet-setting-hint" id="cabinet-sizes-hint">
                  Keep 12&quot; records on their own shelves, apart from 7&quot; and 10&quot;.
                </span>
              </div>
              <label className="cabinet-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={options.separateSizeClasses}
                  onChange={(event) => setSeparateSizeClasses(event.target.checked)}
                  aria-labelledby="cabinet-sizes-title"
                  aria-describedby="cabinet-sizes-hint"
                />
                <span className="cabinet-switch-track" aria-hidden="true" />
              </label>
            </div>

            <div className="cabinet-setting">
              <div className="cabinet-setting-text">
                <span className="cabinet-setting-title">Gatefolds</span>
                <span className="cabinet-setting-hint" aria-live="polite">
                  {gatefoldScan
                    ? `Checking release notes: ${gatefoldScan.done.toLocaleString()} of ${gatefoldScan.total.toLocaleString()} records`
                    : collectionBusy
                      ? 'Release notes are checked once your collection has finished loading.'
                      : 'Read from each record\'s format and release notes. Correct one with its Gatefold button.'}
                </span>
                {gatefoldScan && (
                  <progress
                    className="cabinet-progress"
                    value={gatefoldScan.done}
                    max={gatefoldScan.total}
                    aria-label="Release notes checked"
                  />
                )}
              </div>
              <span className="cabinet-setting-value">
                {gatefoldCount.toLocaleString()} found
              </span>
            </div>

            <div className="cabinet-setting">
              <div className="cabinet-setting-text">
                <span className="cabinet-setting-title">Shelves</span>
                <span className="cabinet-setting-hint">
                  {plan.slots.length === 0
                    ? '0 shelves'
                    : `${plan.slots.length.toLocaleString()} ${plan.slots.length === 1 ? 'shelf' : 'shelves'} · ${totalCapacity.toLocaleString()} record spaces`}
                </span>
              </div>
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
                  <button type="button" className="cabinet-primary-btn" onClick={handleAdd}>
                    Add
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="cabinet-primary-btn"
                  onClick={() => {
                    setNewCapacity('75')
                    setAdding(true)
                  }}
                >
                  Add shelf
                </button>
              )}
            </div>
          </section>

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
            {plan.slots.length === 0 && (
              <p className="cabinet-empty cabinet-no-shelves">
                No shelves yet. Add a shelf to start laying out your records.
              </p>
            )}

            {plan.slots.map((slot, index) => {
              const isExpanded = expanded.has(slot.slot.id)
              // Shelves are numbered by position, so the numbers stay 1…n after
              // a shelf is removed.
              const shelfName = `Shelf ${index + 1}`
              return (
                <section key={slot.slot.id} className="cabinet-slot">
                  <button
                    type="button"
                    className="cabinet-slot-head cabinet-slot-toggle"
                    onClick={() => toggleExpanded(slot.slot.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`cabinet-slot-${slot.slot.id}`}
                  >
                    <span className="cabinet-slot-toggle-label">{shelfName}</span>
                    {/* One fill count: spaces used of capacity. It only differs from
                        the record count by gatefolds, which say "2 spaces" inside. */}
                    <span
                      className="cabinet-slot-count"
                      title={`${slot.used.toLocaleString()} of ${slot.slot.capacity.toLocaleString()} spaces used`}
                    >
                      {slot.used.toLocaleString()} / {slot.slot.capacity.toLocaleString()}
                    </span>
                    {slot.sizeClass !== null && slot.sizeClass !== 'mixed' && (
                      <span className="cabinet-tag">{SIZE_CLASS_LABELS[slot.sizeClass]}</span>
                    )}
                    {slot.sizeClass === 'mixed' && options.separateSizeClasses && (
                      <span className="cabinet-tag warn">Mixed sizes</span>
                    )}
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
                        <label className="cabinet-slot-capacity">
                          <span>Capacity</span>
                          <input
                            type="number"
                            min={1}
                            aria-label={`Capacity of ${shelfName}`}
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
                          title="Remove shelf"
                          aria-label={`Remove ${shelfName}`}
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

            {plan.unplaced.length > 0 && (
              <section className="cabinet-slot cabinet-unplaced">
                <button
                  type="button"
                  className="cabinet-slot-head cabinet-slot-toggle"
                  onClick={() => toggleExpanded(UNPLACED_ID)}
                  aria-expanded={unplacedExpanded}
                  aria-controls="cabinet-unplaced"
                >
                  <span className="cabinet-slot-toggle-label">Without a shelf</span>
                  <span className="cabinet-slot-count" title="Records without a shelf">
                    {plan.unplaced.length.toLocaleString()}{' '}
                    {plan.unplaced.length === 1 ? 'record' : 'records'}
                  </span>
                  <span className="cabinet-slot-chevron">{unplacedExpanded ? '▾' : '▸'}</span>
                </button>

                {unplacedExpanded && (
                  <div id="cabinet-unplaced" className="cabinet-slot-body">
                    <p className="cabinet-hint">
                      These do not fit anywhere yet — add a shelf or raise a capacity.
                    </p>
                    <ul className="cabinet-records">
                      {plan.unplaced.map((record) => recordRow(record))}
                    </ul>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
