import { createApp } from './app'
import { closeDb } from './db'

const app = createApp()

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'

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
