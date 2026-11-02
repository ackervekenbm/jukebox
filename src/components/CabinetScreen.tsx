// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { sortYear, type DisplayRelease } from '../utils/collection'
import { useScrollLock } from '../hooks/useScrollLock'
import { useCabinet, type CabinetStatus, type RemovedSlot } from '../hooks/useCabinet'
import {
  SIZE_CLASS_LABELS,
  conflictLabel,
  detectedGatefold,
  discCountOf,
  isGatefold,
  isUserCall,
  plural,
  sizeClassOf,
  spaceUnitsOf,
} from '../utils/cabinet'
import { CloseIcon, TrashIcon } from './icons'
import { useEffect, useRef, useState } from 'react'

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

/** A shelf's size, in record spaces: anything a real shelf could plausibly hold. */
const MIN_SHELF_SIZE = 1
const MAX_SHELF_SIZE = 500
const DEFAULT_SHELF_SIZE = '75'

/** A whole number of record spaces in range, or null with the reason shown. */
function parseShelfSize(value: string): number | null {
  const size = Number(value)
  if (value.trim() === '' || !Number.isInteger(size)) return null
  return size >= MIN_SHELF_SIZE && size <= MAX_SHELF_SIZE ? size : null
}

const SHELF_SIZE_ERROR = `Enter a whole number from ${MIN_SHELF_SIZE} to ${MAX_SHELF_SIZE}.`

/** How long "Shelf n removed · Undo" stays up. */
const UNDO_MS = 8000

// The main view's in-artist order, with its labels; artists always come first.
const SORTS = [
  { id: 'chronological', label: 'Year', title: 'Oldest to newest within each artist' },
  { id: 'byName', label: 'A–Z', title: 'By album name within each artist' },
] as const

/**
 * A shelf's capacity, edited as text so the field can be cleared while typing.
 * Only a valid size reaches the cabinet; anything else is shown as an error
 * until it's fixed, and the field goes back to the saved size when it loses
 * focus.
 */
function CapacityInput({
  shelfName,
  capacity,
  onChange,
}: {
  shelfName: string
  capacity: number
  onChange: (capacity: number) => void
}) {
  const [draft, setDraft] = useState(String(capacity))
  const [prevCapacity, setPrevCapacity] = useState(capacity)
  if (capacity !== prevCapacity) {
    setPrevCapacity(capacity)
    setDraft(String(capacity))
  }
  const invalid = parseShelfSize(draft) === null
  const errorId = `${shelfName.replace(/\s+/g, '-').toLowerCase()}-capacity-error`
  return (
    <div className="cabinet-capacity-field">
      <label className="cabinet-slot-capacity">
        <span>Capacity</span>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_SHELF_SIZE}
          max={MAX_SHELF_SIZE}
          aria-label={`Capacity of ${shelfName}`}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            const size = parseShelfSize(event.target.value)
            if (size !== null) onChange(size)
          }}
          onBlur={() => setDraft(String(capacity))}
        />
      </label>
      {invalid && (
        <p className="cabinet-field-error" id={errorId}>
          {SHELF_SIZE_ERROR}
        </p>
      )}
    </div>
  )
}

interface CabinetScreenProps {
  username: string
  token: string | null
  releases: DisplayRelease[]
  /** The collection has loaded (not enriching, no error); the gatefold scan waits for it. */
  collectionReady?: boolean
  onClose: () => void
}

export function CabinetScreen({
  username,
  token,
  releases,
  collectionReady = true,
  onClose,
}: CabinetScreenProps) {
  useScrollLock(true)
  const {
    options,
    plan,
    sleeves,
    gatefoldScan,
    gatefoldScanError,
    status,
    error,
    addSlot,
    updateSlot,
    removeSlot,
    restoreSlot,
    setSort,
    setSeparateSizeClasses,
    toggleGatefold,
    retry,
  } = useCabinet({ username, token, releases, enabled: true, collectionReady })

  const placed = Object.keys(plan.placements).length
  const totalCapacity = plan.slots.reduce((total, slot) => total + slot.slot.capacity, 0)
  // Screen readers hear the scan start and end, not every step of it.
  const [scanAnnouncement, setScanAnnouncement] = useState('')
  const [scanWasRunning, setScanWasRunning] = useState(false)
  if ((gatefoldScan !== null) !== scanWasRunning) {
    setScanWasRunning(gatefoldScan !== null)
    setScanAnnouncement(
      gatefoldScan !== null ? 'Checking release notes for gatefold sleeves.' : 'Release notes checked.',
    )
  }

  // Releases, not copies: two copies of one pressing share a sleeve.
  const gatefoldCount = new Set(
    releases.filter((record) => isGatefold(record, sleeves)).map((record) => record.id),
  ).size
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const unplacedExpanded = expanded.has(UNPLACED_ID)
  const [adding, setAdding] = useState(false)
  const [newCapacity, setNewCapacity] = useState(DEFAULT_SHELF_SIZE)
  const [newCapacityError, setNewCapacityError] = useState(false)
  const [removed, setRemoved] = useState<(RemovedSlot & { name: string }) | null>(null)

  // Focus targets for after a shelf is removed or restored, or the add form
  // closes, so keyboard and screen-reader users aren't dropped on <body>.
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const headerRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<string | 'add' | null>(null)
  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    if (target === 'add') addButtonRef.current?.focus()
    else headerRefs.current.get(target)?.focus()
  })

  useEffect(() => {
    if (!removed) return
    const timer = setTimeout(() => setRemoved(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [removed])

  const toggleExpanded = (slotId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(slotId)) next.delete(slotId)
      else next.add(slotId)
      return next
    })
  }

  const closeAdd = () => {
    setAdding(false)
    setNewCapacityError(false)
    pendingFocus.current = 'add'
  }

  const handleAdd = () => {
    const size = parseShelfSize(newCapacity)
    if (size === null) {
      setNewCapacityError(true)
      return
    }
    addSlot(size)
    closeAdd()
  }

  const handleRemove = (slotId: string, name: string) => {
    const index = plan.slots.findIndex((entry) => entry.slot.id === slotId)
    const result = removeSlot(slotId)
    if (!result) return
    setRemoved({ ...result, name })
    // A new shelf can reuse the id later; it shouldn't open already expanded.
    setExpanded((current) => {
      const next = new Set(current)
      next.delete(slotId)
      return next
    })
    // Focus the shelf that takes its place, else the one before, else "Add shelf".
    const neighbour = plan.slots[index + 1] ?? plan.slots[index - 1]
    pendingFocus.current = neighbour ? neighbour.slot.id : 'add'
  }

  const handleUndo = () => {
    if (!removed) return
    restoreSlot(removed)
    pendingFocus.current = removed.slot.id
    setRemoved(null)
  }

  // Says where the sleeve call comes from, so a wrong one can be traced.
  const sleeveSource = (record: DisplayRelease) => {
    if (isUserCall(record, sleeves)) {
      return isGatefold(record, sleeves)
        ? 'Gatefold, marked by you. Press again to go back to what Discogs says.'
        : 'Standard sleeve, marked by you. Press again to go back to what Discogs says.'
    }
    return detectedGatefold(record, sleeves)
      ? 'Gatefold, according to Discogs. Press if it is a standard sleeve.'
      : 'Standard sleeve. Press to mark it as a gatefold.'
  }

  const recordRow = (record: DisplayRelease) => {
    const units = spaceUnitsOf(record, sleeves)
    const discs = discCountOf(record)
    const gatefold = isGatefold(record, sleeves)
    const vinyl = sizeClassOf(record) !== 'other'
    const yours = isUserCall(record, sleeves)
    return (
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
      {/* Sleeve chips sit right-aligned on the artist's line, under the year, so
          the years line up whatever chips a record has; the Gatefold button
          comes last so it lines up too. */}
      {(vinyl || units > 1) && (
        <span className="cabinet-record-tags">
          {/* Says why it takes more than one space: its discs, or (with the
              Gatefold button pressed next to it) its sleeve. */}
          {units > 1 && (
            <span className="cabinet-record-space">
              {discs > 1 ? `${discs} discs` : `${units} spaces`}
            </span>
          )}
          {vinyl && (
            <button
              type="button"
              className={`cabinet-sleeve-btn${gatefold ? ' active' : ''}`}
              aria-pressed={gatefold}
              aria-label={`Gatefold: ${record.title}`}
              aria-description={sleeveSource(record)}
              title={sleeveSource(record)}
              onClick={() => toggleGatefold(record)}
            >
              Gatefold
              {/* Shown, not only told: a tooltip never appears on a touch screen. */}
              {yours && <span className="cabinet-sleeve-yours">you</span>}
            </button>
          )}
        </span>
      )}
    </li>
    )
  }

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
            {plural(releases.length, 'release')} · {placed.toLocaleString()} placed
            {plan.unplaced.length > 0 && ` · ${plan.unplaced.length.toLocaleString()} without a shelf`}
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
                role="group"
                aria-labelledby="cabinet-order-title"
              >
                {SORTS.map((sort) => (
                  <button
                    key={sort.id}
                    type="button"
                    aria-pressed={options.sort === sort.id}
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
                {/* Not a live region: it counts up about once a second while the
                    scan runs. The status below announces only start and end. */}
                <span className="cabinet-setting-hint">
                  {gatefoldScan
                    ? `Checking release notes: ${gatefoldScan.done.toLocaleString()} of ${gatefoldScan.total.toLocaleString()} records`
                    : gatefoldScanError
                      ? gatefoldScanError
                      : !collectionReady
                        ? 'Release notes are checked once your collection has loaded.'
                        : 'Read from each record\'s format and release notes. Correct one with its Gatefold button.'}
                </span>
                <span className="cabinet-visually-hidden" role="status" aria-label="Release notes check">
                  {scanAnnouncement}
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
                {plural(gatefoldCount, 'gatefold')}
              </span>
            </div>

            <div className="cabinet-setting">
              <div className="cabinet-setting-text">
                <span className="cabinet-setting-title">Shelves</span>
                <span className="cabinet-setting-hint">
                  {plan.slots.length === 0
                    ? '0 shelves'
                    : `${plural(plan.slots.length, 'shelf', 'shelves')} · ${plural(totalCapacity, 'record space')}`}
                </span>
              </div>
              {adding ? (
                <div className="cabinet-add-form">
                  <div className="cabinet-add">
                    <label className="cabinet-slot-capacity">
                      <span>Shelf size</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_SHELF_SIZE}
                        max={MAX_SHELF_SIZE}
                        // The visible label is hidden on phones; this name isn't.
                        aria-label="Shelf size"
                        aria-invalid={newCapacityError}
                        aria-describedby={newCapacityError ? 'cabinet-new-size-error' : undefined}
                        value={newCapacity}
                        onChange={(event) => {
                          setNewCapacity(event.target.value)
                          setNewCapacityError(false)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') handleAdd()
                          if (event.key === 'Escape') closeAdd()
                        }}
                        autoFocus
                      />
                    </label>
                    <button type="button" className="cabinet-primary-btn" onClick={handleAdd}>
                      Add
                    </button>
                    <button type="button" className="secondary-btn" onClick={closeAdd}>
                      Cancel
                    </button>
                  </div>
                  {newCapacityError && (
                    <p className="cabinet-field-error" id="cabinet-new-size-error" role="alert">
                      {SHELF_SIZE_ERROR}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="cabinet-primary-btn"
                  ref={addButtonRef}
                  onClick={() => {
                    setNewCapacity(DEFAULT_SHELF_SIZE)
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
              const fill = `${slot.used.toLocaleString()} of ${slot.slot.capacity.toLocaleString()} spaces used`
              const sizeTag =
                slot.sizeClass !== null && slot.sizeClass !== 'mixed'
                  ? SIZE_CLASS_LABELS[slot.sizeClass]
                  : null
              const mixedTag = slot.sizeClass === 'mixed' && options.separateSizeClasses
              const overTag = slot.overCapacity > 0 ? `${plural(slot.overCapacity, 'space')} over` : null
              // Spoken as one phrase with pauses; the visible parts would otherwise
              // run together ("Shelf 12 of 75…" reads as shelf 12).
              const headerLabel = [shelfName, fill, sizeTag, mixedTag && 'Mixed sizes', overTag]
                .filter(Boolean)
                .join(', ')
              return (
                <section key={slot.slot.id} className="cabinet-slot">
                  <button
                    type="button"
                    className="cabinet-slot-toggle"
                    ref={(element) => {
                      if (element) headerRefs.current.set(slot.slot.id, element)
                      else headerRefs.current.delete(slot.slot.id)
                    }}
                    onClick={() => toggleExpanded(slot.slot.id)}
                    aria-label={headerLabel}
                    aria-expanded={isExpanded}
                    aria-controls={isExpanded ? `cabinet-slot-${slot.slot.id}` : undefined}
                  >
                    <span className="cabinet-slot-toggle-label">{shelfName}</span>
                    {/* One fill count: spaces used of capacity. It only differs from
                        the record count by gatefolds, which say "2 spaces" inside. */}
                    <span className="cabinet-slot-count">
                      {slot.used.toLocaleString()} / {slot.slot.capacity.toLocaleString()} spaces
                    </span>
                    {sizeTag && <span className="cabinet-tag">{sizeTag}</span>}
                    {mixedTag && <span className="cabinet-tag warn">Mixed sizes</span>}
                    {overTag && <span className="cabinet-tag danger">{overTag}</span>}
                    <span className="cabinet-slot-chevron">{isExpanded ? '▾' : '▸'}</span>
                  </button>

                  {isExpanded && (
                    <div id={`cabinet-slot-${slot.slot.id}`} className="cabinet-slot-body">
                      <div className="cabinet-slot-tools">
                        <CapacityInput
                          shelfName={shelfName}
                          capacity={slot.slot.capacity}
                          onChange={(capacity) => updateSlot(slot.slot.id, { capacity })}
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => handleRemove(slot.slot.id, shelfName)}
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
                  className="cabinet-slot-toggle"
                  onClick={() => toggleExpanded(UNPLACED_ID)}
                  aria-label={`Without a shelf, ${plural(plan.unplaced.length, 'record')}`}
                  aria-expanded={unplacedExpanded}
                  aria-controls={unplacedExpanded ? 'cabinet-unplaced' : undefined}
                >
                  <span className="cabinet-slot-toggle-label">Without a shelf</span>
                  <span className="cabinet-slot-count">{plural(plan.unplaced.length, 'record')}</span>
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

          {/* Always rendered, so screen readers announce the message when it appears. */}
          <div className="cabinet-undo-region" role="status" aria-label="Removed shelf">
            {removed && (
              <div className="cabinet-undo">
                <span>{removed.name} removed</span>
                <button type="button" onClick={handleUndo}>
                  Undo
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
