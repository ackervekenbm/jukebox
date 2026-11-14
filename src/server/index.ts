// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import { createApp } from './app'
import { HOST as host, PORT as port } from './config'
import { closeDb } from './db'

const app = createApp()

const server = app.listen(port, host, () => {
  console.info(`[jukebox] http://${host}:${port} (client + API)`)
})

let shuttingDown = false

function shutdown(signal: string): void {
  if (shuttingDown) return
  shuttingDown = true
  console.info(`[jukebox] ${signal} received, shutting down`)
  server.close(() => {
    closeDb()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
