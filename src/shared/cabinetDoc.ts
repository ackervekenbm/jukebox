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

export type Slot = z.infer<typeof slotSchema>
export type Cabinet = z.infer<typeof cabinetSchema>
export type CabinetDoc = z.infer<typeof cabinetDocSchema>
/** The layout options, synced and fed to the planner (`planCabinet`). */
export type CabinetOptions = z.infer<typeof optionsSchema>
