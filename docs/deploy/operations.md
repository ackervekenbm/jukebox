# Operations

Running it is the easy part. This page is what to know afterwards: configuration,
what's actually stored where, backups, updates, rollback and health.

## Environment variables

| Variable | Default | Used for |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port the process listens on |
| `HOST` | `127.0.0.1` | Bind address. Behind a proxy leave it; for direct LAN access use `0.0.0.0` |
| `DATA_DIR` | `./data` (`/app/data` in the image) | SQLite database location; created if missing, must be writable |
| `CLIENT_DIST` | `./dist` | Where the built client lives |
| `NODE_ENV` | — (`production` in the image) | Express/runtime mode |

Image build args only affect the "build" line in the settings screen:
`COMMIT_SHA`, `BUILD_TIME`, `GITHUB_REPOSITORY`.

There is no `.env` file and no config file — everything is process environment.
With compose, set them under `environment:`; with systemd, `Environment=` lines.

## What lives where

| Data | Where | Survives redeploy |
| --- | --- | --- |
| Collection, tracklists, cached years, listen log, saved views, settings, token | **Browser** (IndexedDB + localStorage) | per device; cleared from Settings → *Clear everything* |
| Record-cabinet layout (shelf names + capacities) | **Server** SQLite, table `cabinet_docs` | yes, if the data dir/volume is kept |
| App build | image / `dist/` + `dist-server/` | rebuilt each deploy |

Two consequences worth remembering:

- The volume is **not** a backup of your collection. Your collection only exists
  in your browsers. ("Clear everything" on every device means re-fetching from
  Discogs.)
- Sync is **local-wins**: the browser is the source of truth and the server copy
  is the cross-device echo. A `PUT` that loses a race gets a `409` with the newer
  document and rebases onto its own local copy. So restoring an *older* server
  DB can be overwritten by any device that still has newer local data.

## Health and monitoring

```bash
curl -fsS http://127.0.0.1:3000/api/health
# {"ok":true,"db":true}
```

- `200 {"ok":true,"db":true}` — process up, database writable and initialised.
- `500 {"ok":false,"db":false}` — the DB couldn't be opened/written; check
  `DATA_DIR` permissions and the container's logs.

The image bakes this into a `HEALTHCHECK` (every 30s), so `docker ps` reports
`healthy`/`unhealthy`. Note that a Docker **restart policy does not act on health
status** — for restarts on a hung process, point an external monitor
(Uptime Kuma, etc.) at `/api/health`.

## Backups

The database is small and SQLite-specific: copying the file while the app is
running can miss the `-wal` contents, so use SQLite's own backup for a hot copy.

**Docker (hot):**

```bash
docker run --rm \
  -v jukebox-data:/data \
  -v "$PWD":/backup \
  alpine sh -c 'apk add --no-cache sqlite >/dev/null && \
                sqlite3 /data/jukebox.db ".backup /backup/jukebox-$(date +%F).db"'
```

Replace `jukebox-data` with the volume name from `docker volume ls` (compose
usually prefixes it with the project name). The same command works on the OMV box
over SSH.

**Docker (cold, no sqlite CLI):**

```bash
docker stop jukebox
docker run --rm -v jukebox-data:/data -v "$PWD":/backup alpine \
  sh -c 'cp /data/jukebox.db* /backup/'
docker start jukebox
```

**Bare Node:**

```bash
sqlite3 "$DATA_DIR/jukebox.db" ".backup /backup/jukebox-$(date +%F).db"
# or, with no sqlite3 CLI: systemctl stop jukebox && cp "$DATA_DIR"/jukebox.db* /backup/
```

**Restore:** stop the app, remove `jukebox.db`, `jukebox.db-wal`, `jukebox.db-shm`
from the data dir/volume, put the backup in place as `jukebox.db`, start the app,
then confirm `/api/health`. Keep the compose file / systemd unit in your backups
too — they're the rest of the deployment.

## Updating

**Image:** `docker compose pull && docker compose up -d` (or OMV: **Pull** →
**Up**, see [openmediavault.md](openmediavault.md#updating)). The volume is kept.
Only app-path changes on `main` produce a new image, so a docs-only merge is a
no-op pull.

**Checkout:** `git pull --ff-only && npm ci && npm run build`, then restart
(`sudo systemctl restart jukebox` or `docker compose up -d --build`).

**Clients:** a normal reload picks up the new build — `index.html`, `sw.js` and
the manifest are served `no-cache`, hashed assets are `immutable`. If a device
still shows the old shell, force-refresh once; the service worker keeps the old
precache until it activates.

## Rollback

- Image: pin an older commit tag, e.g.
  `ghcr.io/ackervekenbm/jukebox:<sha7>`, and recreate
  ([docker-image.md](docker-image.md#pin-a-version-roll-back)).
- Checkout: `git checkout <sha> && npm ci && npm run build` and restart.

Data is unaffected either way: the schema is a single table created with
`CREATE TABLE IF NOT EXISTS` and nothing migrates destructively.

## Logs

```bash
docker compose logs -f jukebox          # image / compose
docker logs -f jukebox                  # docker run
journalctl -u jukebox -f                # systemd
```

The server is quiet: a startup line, auth failures (`[auth]`), uncaught 5xx
(`[server]`) and shutdown. It does **not** log requests, tokens or collection
data — tokens are only used in-memory to resolve the Discogs username.

## Disk and housekeeping

- The SQLite DB stays in the low megabytes; WAL files come and go with activity.
- Old images accumulate on the host. `docker image prune` (or
  `docker image prune -a` after confirming nothing needs rolling back) reclaims
  space.
- Browser-side growth (tracklist cache) is the app's own concern — Settings shows
  storage usage and offers *Clear everything* per device.
