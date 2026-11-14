// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

/*
 * The sync ETag contract ("r3" = stored revision 3), shared by server and
 * client. Kept out of cabinetDoc.ts so the client can import it without
 * pulling zod into the browser bundle.
 */

export const etagForRevision = (revision: number): string => `"r${revision}"`

/** The revision in an ETag or If-Match header; 'force' for `*`, null when unusable. */
export const parseEtag = (header: string): number | 'force' | null => {
  const value = header.trim()
  if (value === '*') return 'force'
  const unquoted = value.replace(/^"(.*)"$/, '$1')
  const match = /^r(\d+)$/.exec(unquoted)
  return match ? Number(match[1]) : null
}
