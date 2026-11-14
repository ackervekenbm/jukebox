// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

/*
 * The cabinet as stored and synced: a starter cabinet, shelf ids, and turning
 * the editable state into the synced document (and a stored or older document
 * back into it). Pure apart from reading this device's layout options.
 */

import type { Cabinet, CabinetDoc, CabinetOptions, Slot, StoredCabinetDoc } from '../shared/cabinetDoc'
import { DEFAULT_CABINET_OPTIONS, loadCabinetOptions } from '../db/cabinetOptions'

/** Roughly what a real LP shelf holds. */
export const DEFAULT_SHELF_CAPACITY = 75

export function defaultCabinetSlot(index: number): Slot {
  return { id: `slot-${index}`, label: `Shelf ${index}`, capacity: DEFAULT_SHELF_CAPACITY }
}

/** A starter cabinet: two shelves, roughly the size of a real LP shelf. */
export function defaultCabinet(): Cabinet {
  return {
    id: 'main',
    name: 'Record Cabinet',
    slots: [defaultCabinetSlot(1), defaultCabinetSlot(2)],
  }
}

/**
 * An id for a new shelf that no existing shelf uses: one past the highest
 * `slot-<n>`. Counting the shelves instead would reuse an id after a shelf in
 * the middle was removed, and two shelves would then share placements.
 */
export function nextSlotId(slots: Slot[]): string {
  let highest = 0
  for (const slot of slots) {
    const match = /^slot-(\d+)$/.exec(slot.id)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `slot-${highest + 1}`
}

/**
 * Gives every shelf an id of its own. Older app versions numbered new shelves
 * by count, so a synced cabinet can hold two shelves with one id; removing one
 * would then remove both. Later duplicates get a fresh id; the first keeps it.
 */
export function withUniqueSlotIds(cabinets: Cabinet[]): Cabinet[] {
  return cabinets.map((entry) => {
    const seen = new Set<string>()
    let changed = false
    const slots: Slot[] = []
    for (const slot of entry.slots) {
      if (seen.has(slot.id)) {
        changed = true
        slots.push({ ...slot, id: nextSlotId([...entry.slots, ...slots]) })
      } else {
        slots.push(slot)
      }
      seen.add(slots[slots.length - 1].id)
    }
    return changed ? { ...entry, slots } : entry
  })
}

/** The cabinets to show for a stored or synced document. */
export function cabinetsOf(doc: StoredCabinetDoc): Cabinet[] {
  // No cabinet at all means a document from before cabinets existed; a cabinet
  // without shelves is a layout the user started over, and stays empty.
  return doc.cabinets.length > 0 ? withUniqueSlotIds(doc.cabinets) : [defaultCabinet()]
}

/**
 * The synced document: the shelves, the layout options, the user's own sleeve
 * calls and the copies on display, stamped with the current time. Where each
 * record goes isn't in it; every device plans that from its own collection.
 */
export function buildCabinetDoc(
  cabinets: Cabinet[],
  sleeves: Record<string, boolean> = {},
  options: CabinetOptions = DEFAULT_CABINET_OPTIONS,
  displayed: number[] = [],
): CabinetDoc {
  return {
    schemaVersion: 2,
    cabinets,
    sleeves,
    options,
    displayed,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Keeps the local copy after a 409: the device that is being edited wins. A
 * copy stored before version 2 comes out as version 2, and one stored before
 * options synced takes this device's own.
 */
export function rebaseCabinetDoc(local: StoredCabinetDoc): CabinetDoc {
  return buildCabinetDoc(
    local.cabinets,
    local.sleeves ?? {},
    optionsOf(local, loadCabinetOptions()),
    displayedOf(local),
  )
}

/** The copies on display, none for a document from before they synced. */
export function displayedOf(doc: StoredCabinetDoc): number[] {
  return ('displayed' in doc && doc.displayed) || []
}

/** The document's layout options, or `fallback` when it predates them. */
export function optionsOf(doc: StoredCabinetDoc, fallback: CabinetOptions): CabinetOptions {
  return ('options' in doc && doc.options) || fallback
}
