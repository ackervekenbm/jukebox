// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReleaseDetail } from './ReleaseDetail'
import { toDisplayRelease } from '../utils/collection'
import { release } from '../test/factories'

vi.mock('../hooks/useReleaseTracklist', () => ({
  useReleaseTracklist: () => ({ tracks: [], loading: false, error: null }),
}))

afterEach(() => {
  document.body.style.overflow = ''
})

const display = toDisplayRelease(
  release({
    basic_information: {
      ...release().basic_information,
      title: 'Moving Pictures',
      artists: [{ ...release().basic_information.artists[0], name: 'Rush' }],
    },
  }),
)

describe('ReleaseDetail pick history', () => {
  it('shows no history when it was not opened by the picker', () => {
    render(<ReleaseDetail display={display} token="tok" onClose={vi.fn()} />)
    expect(screen.queryByText('Recent picks')).toBeNull()
  })

  it('shows no history section when the log only holds this release', () => {
    render(
      <ReleaseDetail display={display} token="tok" onClose={vi.fn()} recentPicks={[]} />,
    )
    expect(screen.queryByText('Recent picks')).toBeNull()
  })

  it('lists the previous picks with a relative stamp', async () => {
    const user = userEvent.setup()
    const onOpenPick = vi.fn()
    render(
      <ReleaseDetail
        display={display}
        token="tok"
        onClose={vi.fn()}
        onOpenPick={onOpenPick}
        recentPicks={[
          { id: 7, at: Date.now() - 60_000, label: 'Herbie Hancock — Headhunters' },
          { id: 8, at: Date.now() - 3 * 60 * 60_000, label: 'DJ Shadow — Lost tapes' },
        ]}
      />,
    )

    expect(screen.getByText('Recent picks')).toBeInTheDocument()
    expect(screen.getByText('1m ago')).toBeInTheDocument()
    expect(screen.getByText('3h ago')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Headhunters/ }))
    expect(onOpenPick).toHaveBeenCalledTimes(1)
    expect(onOpenPick).toHaveBeenCalledWith(7)
  })

  it('scopes the buttons to the history list', () => {
    render(
      <ReleaseDetail
        display={display}
        token="tok"
        onClose={vi.fn()}
        onOpenPick={vi.fn()}
        recentPicks={[{ id: 7, at: Date.now(), label: 'Herbie Hancock — Headhunters' }]}
      />,
    )

    const section = screen.getByText('Recent picks').closest('.detail-section')
    expect(section).not.toBeNull()
    const buttons = within(section as HTMLElement).getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Herbie Hancock — Headhunters')
  })
})
