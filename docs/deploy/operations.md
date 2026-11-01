# Operations

Running it is the easy part. This page is what to know afterwards: configuration,
what's actually stored where, health, version checks, backups, updates, rollback
and logs.

## Environment variables

| Variable | Default | In the image | Used for |
| --- | --- | --- | --- |
| `PORT` | `3000` | `3000`, treat as fixed | HTTP port the process listens on. The image's `HEALTHCHECK` probes `127.0.0.1:3000`, so changing it inside the container breaks the healthcheck — publish a different **host** port instead |
| `HOST` | `127.0.0.1` | `0.0.0.0` | Bind address. Bare Node behind a proxy: leave the default. Bare Node on the LAN: `0.0.0.0`. In the image it is already `0.0.0.0`, and overriding it to loopback makes the published port unreachable |
| `DATA_DIR` | `./data` | `/app/data` | SQLite database location; created if missing, must be writable |
| `CLIENT_DIST` | `./dist` | `/app/dist` | Where the built client lives |
| `NODE_ENV` | unset | `production` | Express/runtime mode |

Rarely needed:

| Variable | Default | Used for |
| --- | --- | --- |
| `DISCOGS_TIMEOUT_MS` | `30000` | Upstream timeout for `/discogs` and the identity check; also the longest a request can sit behind a proxy |
| `DISCOGS_API_BASE` | `https://api.discogs.com` | Point the proxy at a mirror (the tests do this) |
| `DISCOGS_USER_AGENT` | `Jukebox/1.0 (github.com/ackervekenbm/jukebox)` | Sent upstream; Discogs asks for a descriptive user agent |

Image build args only affect the "build" line in the settings screen:
`COMMIT_SHA`, `BUILD_TIME`, `GITHUB_REPOSITORY`.

There is no `.env` file and no config file — everything is process environment.
With compose, set them under `environment:`; with systemd, `Environment=` lines.

## Which build is running?

- **From a checkout:** `git -C /opt/jukebox log -1 --format='%h %ci'`.
- **Image:** compare the tag you run with `main`, or read the digest of what you
  pulled: `docker image inspect ghcr.io/ackervekenbm/jukebox:latest --format '{{index .RepoDigests 0}}'`
  (`RepoDigests` is populated for pulled images; a locally built image may have
  none).
- **In the app:** Settings shows a build line with the commit and build time of
  the client you are looking at (`dev` and no date for a local build). It is the
  quickest "did my deploy actually land?" check, and the fastest way to separate
  a server problem from a stale service worker.

A local `docker compose build` needs the same args the workflow passes, otherwise
that line reads `dev`:

```bash
docker compose build \
  --build-arg COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg BUILD_TIME=$(git log -1 --format=%cI)
```

## What lives where

| Data | Where | Survives redeploy |
| --- | --- | --- |
| Collection, tracklists, cached years, listen log, saved views, settings, token | **Browser** (IndexedDB + localStorage) | per device; cleared from Settings → *Clear everything* |
| Record-cabinet layout (cabinets, slots, placements) | **Server** SQLite, table `cabinet_docs` | yes, if the data dir/volume is kept |
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
curl -fsS http://127.0.0.1:3000/api/health     # from the host
```

`/api/health` runs `SELECT 1` on the open SQLite handle, so it answers exactly
one question: *is this process still able to use its database?*

- `200 {"ok":true,"db":true}` — process up, handle answering.
- `500 {"ok":false,"db":false}` — the handle stopped answering: the database file
  was deleted or replaced underneath the process, the disk filled up, or an I/O
  error occurred.

It is **not** a write test, and a bad `DATA_DIR` does not show up here. The
database is opened, switched to WAL and migrated during start-up, so a data
directory that is missing-writable (or read-only) kills the process **before it
starts listening** — `/api/health` never answers. In that case look for a
container stuck in `Restarting` (`docker ps -a`) or `systemctl status jukebox`,
then read the log for the SQLite error (`unable to open database file`,
`attempt to write a readonly database`).

The image bakes the endpoint into a `HEALTHCHECK` (`--interval=30s`,
`--timeout=3s`, 3 retries by default), so `docker ps` reports
`healthy`/`unhealthy`. A Docker **restart policy does not act on health status** —
for restarts on a hung process, point an external monitor (Uptime Kuma, etc.) at
`/api/health`.

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
usually prefixes it with the project name). The command needs network access for
`apk add`; if the box is offline, use the cold copy below. The same command works
on the OMV box over SSH.

**Docker (cold, no sqlite CLI):**

```bash
docker stop jukebox
docker run --rm -v jukebox-data:/data -v "$PWD":/backup alpine \
  sh -c 'cp /data/jukebox.db* /backup/'
docker start jukebox
```

`docker compose down` is fine here; **`down -v` is not** — it deletes the volume.

**Bare Node:**

```bash
sqlite3 "$DATA_DIR/jukebox.db" ".backup /backup/jukebox-$(date +%F).db"
# or, with no sqlite3 CLI: systemctl stop jukebox && cp "$DATA_DIR"/jukebox.db* /backup/
```

**Restore:** stop the app, remove `jukebox.db`, `jukebox.db-wal`, `jukebox.db-shm`
from the data dir/volume, put the backup in place as `jukebox.db`, start the app,
then confirm `/api/health`. Keep the compose file / systemd unit in your backups
too — they're the rest of the deployment.

## Moving between routes

The only server-side state is `jukebox.db` (plus its `-wal`/`-shm` siblings), so
switching from bare Node to the image, or to another machine, is:

1. stop the old deployment (`sudo systemctl stop jukebox`, `docker compose down`);
2. take a backup with the `.backup` command above (or copy `jukebox.db*` while it
   is stopped);
3. start the new deployment and let it create its data dir;
4. stop it, drop the backup in as `jukebox.db` (removing `-wal`/`-shm` first),
   start it again;
5. check `/api/health` and open the app.

Browser data does not move with it — that is per device and per browser profile.
Only the cabinet layout comes across, via the database.

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
precache until it activates. Settings → build line tells you which build the
browser is actually running.

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

### Log rotation

Docker's default `json-file` driver grows without bound. On a small box that
eventually fills the disk — and a full disk is how SQLite starts failing, which
is when `/api/health` turns into a 500. Cap it in compose:

```yaml
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

With `docker run`, pass `--log-opt max-size=10m --log-opt max-file=3`. Bare Node
under systemd writes to the journal, which has its own caps
(`journalctl --disk-usage`; `SystemMaxUse=` in `journald.conf`).

## Disk and housekeeping

- The SQLite DB stays in the low megabytes; WAL files come and go with activity.
- If the disk does fill: writes fail, `/api/health` flips to `500` and cabinet
  sync stops. Free space, then restart the container/process so SQLite can
  reopen cleanly.
- Old images accumulate on the host. `docker image prune` (or
  `docker image prune -a` after confirming nothing needs rolling back) reclaims
  space.
- Browser-side growth (tracklist cache) is the app's own concern — Settings shows
  storage usage and offers *Clear everything* per device.
