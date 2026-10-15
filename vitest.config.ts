import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Matches the build-time defines so components that render the build footer
  // (__BUILD_SHA__, __REPO__, __BUILD_TIME__) can be tested without a build.
  define: {
    __BUILD_SHA__: JSON.stringify('dev'),
    __BUILD_TIME__: JSON.stringify(''),
    __REPO__: JSON.stringify('ackervekenbm/jukebox'),
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
  },
})