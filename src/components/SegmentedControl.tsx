// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

export interface SegmentOption<T extends string> {
  value: T
  label: string
  title?: string
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** 'radio' for a choice between views; 'toggle' for pressed buttons (sort orders). */
  kind: 'radio' | 'toggle'
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

/** A row of buttons where exactly one is on: the app's view and sort switches. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  kind,
  className = 'sort-toggle',
  ...labelling
}: SegmentedControlProps<T>) {
  return (
    <div className={className} role={kind === 'radio' ? 'radiogroup' : 'group'} {...labelling}>
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            {...(kind === 'radio' ? { role: 'radio', 'aria-checked': on } : { 'aria-pressed': on })}
            className={on ? 'active' : ''}
            onClick={() => onChange(option.value)}
            title={option.title}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
