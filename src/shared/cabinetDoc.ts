// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { z } from 'zod'

/**
 * A shelf. The screens say "shelf"; the code and the stored documents say
 * "slot" (the earlier name), and renaming the stored field would break sync
 * with older apps.
 */
export const slotSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  capacity: z.number().int().positive(),
})

export const cabinetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // Empty is valid: removing every shelf is how you start the layout over.
  // Ids must be unique: removing a shelf removes every shelf with its id.
  slots: z
    .array(slotSchema)
    .refine((slots) => new Set(slots.map((slot) => slot.id)).size === slots.length, {
      message: 'Shelf ids must be unique',
    }),
})

/** The user's own sleeve calls, release id → gatefold or not. */
const sleevesSchema = z.record(z.string().regex(/^\d+$/), z.boolean())

/** How the shelves are laid out: it decides where records physically go. */
const optionsSchema = z.object({
  /** Order inside each artist; artists themselves are always in filing order. */
  sort: z.enum(['chronological', 'byName']),
  /** Keep each record size on its own shelves where the space allows. */
  separateSizeClasses: z.boolean(),
})

/** Copies (collection instance ids) on display elsewhere, so they need no shelf. */
const displayedSchema = z.array(z.number().int().positive())

/**
 * What devices sync: the shelves, the layout options, the user's own sleeve
 * calls and the records on display. Where each record goes is computed on
 * every device from its own collection, so it isn't synced (it grew with the
 * collection, see #134).
 *
 * `sleeves`, `options` and `displayed` are optional because an app that
 * predates them leaves them out; the server then keeps the stored ones.
 */
export const cabinetDocSchema = z.object({
  schemaVersion: z.literal(2),
  cabinets: z.array(cabinetSchema),
  sleeves: sleevesSchema.optional(),
  options: optionsSchema.optional(),
  displayed: displayedSchema.optional(),
  updatedAt: z.iso.datetime(),
})

/**
 * Version 1, still sent by app copies cached before version 2: the same plus
 * the derived `placements`, `overrides` and `unplaced`, which nothing reads.
 */
export const legacyCabinetDocSchema = z.object({
  schemaVersion: z.literal(1),
  cabinets: z.array(cabinetSchema),
  placements: z.record(z.string(), z.string()).optional(),
  overrides: z.record(z.string(), z.string()).optional(),
  unplaced: z.array(z.string()).optional(),
  sleeves: sleevesSchema.optional(),
  updatedAt: z.iso.datetime(),
})

/** Either version, read as version 2: the derived version-1 fields are dropped. */
export const anyCabinetDocSchema = z
  .discriminatedUnion('schemaVersion', [cabinetDocSchema, legacyCabinetDocSchema])
  .transform(
    (doc): CabinetDoc => ({
      schemaVersion: 2,
      cabinets: doc.cabinets,
      ...(doc.sleeves === undefined ? {} : { sleeves: doc.sleeves }),
      ...('options' in doc && doc.options ? { options: doc.options } : {}),
      ...('displayed' in doc && doc.displayed ? { displayed: doc.displayed } : {}),
      updatedAt: doc.updatedAt,
    }),
  )

export type Slot = z.infer<typeof slotSchema>
export type Cabinet = z.infer<typeof cabinetSchema>
export type CabinetDoc = z.infer<typeof cabinetDocSchema>
/** The layout options, synced and fed to the planner (`planCabinet`). */
export type CabinetOptions = z.infer<typeof optionsSchema>
export type LegacyCabinetDoc = z.infer<typeof legacyCabinetDocSchema>
/** A document as a browser may still hold it: written before version 2, or since. */
export type StoredCabinetDoc = CabinetDoc | LegacyCabinetDoc
