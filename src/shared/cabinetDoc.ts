import { z } from 'zod'

export const slotSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  capacity: z.number().int().positive(),
})

export const cabinetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slots: z.array(slotSchema).min(1),
})

export const cabinetDocSchema = z.object({
  schemaVersion: z.literal(1),
  cabinets: z.array(cabinetSchema),
  placements: z.record(z.string(), z.string()),
  overrides: z.record(z.string(), z.string()),
  unplaced: z.array(z.string()),
  updatedAt: z.iso.datetime(),
})

export type Slot = z.infer<typeof slotSchema>
export type Cabinet = z.infer<typeof cabinetSchema>
export type CabinetDoc = z.infer<typeof cabinetDocSchema>

export const etagForRevision = (revision: number): string => `"r${revision}"`

export const parseEtag = (header: string): number | 'force' | null => {
  const value = header.trim()
  if (value === '*') return 'force'
  const unquoted = value.replace(/^"(.*)"$/, '$1')
  const match = /^r(\d+)$/.exec(unquoted)
  return match ? Number(match[1]) : null
}
