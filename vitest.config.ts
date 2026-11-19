// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { license?: string }

export default defineConfig({
  plugins: [react()],
  // Matches the build-time defines so components that render the build footer
  // (__BUILD_SHA__, __REPO__, __BUILD_TIME__) can be tested without a build.
  define: {
    __BUILD_SHA__: JSON.stringify('dev'),
    __BUILD_TIME__: JSON.stringify(''),
    __REPO__: JSON.stringify('ackervekenbm/jukebox'),
    // package.json's `license`, shown in Settings → About.
    __LICENSE__: JSON.stringify(pkg.license ?? ''),
  },
  test: {
    // `npm run test:coverage` writes a text summary and an HTML report to coverage/.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts', 'src/main.tsx'],
      reporter: ['text-summary', 'html'],
    },
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})