// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsForm } from './Settings'

const renderSettings = (onSave = vi.fn(), onThemeChange = vi.fn(), onPickerSkipChange = vi.fn()) =>
  render(
    <SettingsForm
      initial={{ username: 'bob', token: 'tok-1', theme: 'midnight' }}
      theme="midnight"
      onThemeChange={onThemeChange}
      onSave={onSave}
      pickerSkip={10}
      onPickerSkipChange={onPickerSkipChange}
    >
      <p>advanced slot</p>
    </SettingsForm>,
  )

describe('SettingsForm', () => {
  it('does not save when credentials are missing', async () => {
    const onSave = vi.fn()
    renderSettings(onSave)
    fireEvent.change(screen.getByLabelText(/Discogs username/), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/Personal access token/), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: /Load collection/ }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves the trimmed credentials and current theme', async () => {
    const onSave = vi.fn()
    renderSettings(onSave)
    fireEvent.change(screen.getByLabelText(/Discogs username/), { target: { value: '  alice  ' } })
    fireEvent.change(screen.getByLabelText(/Personal access token/), {
      target: { value: ' tok-9 ' },
    })
    await userEvent.click(screen.getByRole('button', { name: /Load collection/ }))
    expect(onSave).toHaveBeenCalledWith({ username: 'alice', token: 'tok-9', theme: 'midnight' })
  })

  it('changes the theme via the picker', async () => {
    const onThemeChange = vi.fn()
    renderSettings(vi.fn(), onThemeChange)
    await userEvent.click(screen.getByRole('radio', { name: /Club/ }))
    expect(onThemeChange).toHaveBeenCalledWith('club')
  })

  it('shows the random picker skip window and forwards edits', () => {
    const onPickerSkipChange = vi.fn()
    renderSettings(vi.fn(), vi.fn(), onPickerSkipChange)

    const input = screen.getByLabelText(/Skip the last/)
    expect(input).toHaveValue(10)

    fireEvent.change(input, { target: { value: '25' } })
    expect(onPickerSkipChange).toHaveBeenCalledWith(25)
  })

  it('explains what the skip window does', () => {
    renderSettings()
    expect(screen.getByText(/avoids the last N picks/)).toBeInTheDocument()
  })

  it('renders additional children (advanced section)', () => {
    renderSettings()
    expect(screen.getByText('advanced slot')).toBeInTheDocument()
  })
})