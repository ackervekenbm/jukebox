// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { clearCabinet, putCabinet } from '../db/cabinet'
import { buildCabinetDoc, defaultCabinet } from '../utils/cabinetModel'
import { StorageStats } from './StorageStats'

afterEach(() => clearCabinet())

describe('StorageStats', () => {
  it('styles itself with storage-* classes only, never the Stats screen’s stats-*', async () => {
    const { container } = render(<StorageStats username="alice" onClearData={() => {}} />)
    await screen.findByRole('button', { name: /clear everything/i })

    const classes = [...container.querySelectorAll('[class]')].flatMap((el) => [...el.classList])
    expect(classes.some((name) => name.startsWith('storage-'))).toBe(true)
    expect(classes.filter((name) => name.startsWith('stats-'))).toEqual([])
  })

  it('asks before clearing everything, with Cancel as the default', async () => {
    const user = userEvent.setup()
    const onClearData = vi.fn()
    render(<StorageStats username="alice" onClearData={onClearData} />)

    await user.click(await screen.findByRole('button', { name: 'Clear everything…' }))
    expect(onClearData).not.toHaveBeenCalled()
    const confirm = screen.getByRole('group', { name: 'Clear everything?' })
    expect(confirm).toHaveTextContent('Your cabinet on the server stays.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClearData).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Clear everything?' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Clear everything…' }))
    await user.click(screen.getByRole('button', { name: 'Clear everything' }))
    expect(onClearData).toHaveBeenCalledTimes(1)
  })

  it('warns when cabinet changes have not reached the server yet', async () => {
    const doc = buildCabinetDoc([defaultCabinet()])
    const user = userEvent.setup()

    await putCabinet({ username: 'alice', doc, revision: 1, dirty: false })
    const { unmount } = render(<StorageStats username="alice" onClearData={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Clear everything…' }))
    expect(screen.queryByText(/haven't reached the server/)).toBeNull()
    unmount()

    await putCabinet({ username: 'alice', doc, revision: 1, dirty: true })
    render(<StorageStats username="alice" onClearData={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Clear everything…' }))
    expect(screen.getByText(/haven't reached the server yet and will be lost/)).toBeInTheDocument()
  })
})
