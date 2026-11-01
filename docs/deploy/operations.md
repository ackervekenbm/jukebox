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
| `CLIENT_DIST` | `./dist` | `/app/dist` (default `./dist` under `WORKDIR=/app`; not set explicitly) | Where the built client lives |
| `NODE_ENV` | unset | `production` | Express/runtime mode |

Rarely needed:

| Variable | Default | Used for |
| --- | --- | --- |
| `DISCOGS_TIMEOUT_MS` | `30000` | Upstream timeout for `/discogs`; also the longest a proxied request can sit behind a reverse proxy. The cached Discogs identity check has its own fixed 15 s timeout, not this one |
| `DISCOGS_API_BASE` | `https://api.discogs.com` | Point the proxy at a mirror (the tests do this) |
| `DISCOGS_USER_AGENT` | `Jukebox/1.0 (https://github.com/ackervekenbm/jukebox)` | Sent upstream; Discogs asks for a descriptive user agent |

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
- **In the app:** Settings shows a build line with the commit and its date — the
  date is the commit date the build was stamped with, not a wall-clock build
  time. A local build without those stamps reads `development build` and shows
  no date. It is the quickest "did my deploy actually land?" check, and the
  fastest way to separate a server problem from a stale service worker.

A local `docker compose build` needs the same args the CI build passes, otherwise
that line reads `development build`:

```bash
docker compose build \
  --build-arg COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg BUILD_TIME=$(git log -1 --format=%cI)
docker compose up -d
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

`/api/health` runs `SELECT 1` on the open SQLite handle — a constant expression
that reads no table and no file. It answers exactly one question: *does this
process still hold a usable database connection?*

- `200 {"ok":true,"db":true}` — the handle prepared and executed the statement.
- `500 {"ok":false,"db":false}` — the handle itself is unusable (already closed,
  or SQLite refused the statement). That is rare while serving; you see it around
  shutdown or after a fatal driver error.

Because `SELECT 1` never reads a page, health does **not** catch a full disk, a
deleted or replaced database file, or a corrupt page. Those surface on the next
write — `PUT /api/sync/cabinet` returns a 500 and the app says "Could not save
the cabinet" — while `/api/health` keeps answering 200. Treat it as a *liveness*
check, not a data-integrity one, and watch free space separately.

A bad `DATA_DIR` never shows up here either. The database is opened, switched to
WAL and migrated during start-up, so a data directory the process cannot create
or write to (read-only mount, wrong ownership, unwritable parent) kills the
process **before it starts listening** — `/api/health` never answers. In that
case look for a container stuck in `Restarting` (`docker ps -a`) or
`systemctl status jukebox`, then read the log for the SQLite error (`unable to
open database file`, `attempt to write a readonly database`).

The image bakes the endpoint into a `HEALTHCHECK` (`--interval=30s`,
`--timeout=3s`, 3 retries by default), so `docker ps` reports
`healthy`/`unhealthy`. A Docker **restart policy does not act on health status** —
for restarts on a hung process, point an external monitor (Uptime Kuma, etc.) at
`/api/health`.

## Backups

The database is small and SQLite-specific: copying the file while the app is
running can miss the `-wal` contents, so use SQLite's own backup for a hot copy.
Set the volume name once — compose prefixes it with the project directory:

```bash
docker volume ls | grep -i jukebox     # usually <dir-name>_jukebox-data
VOL=jukebox-data                       # the name you just saw
```

If you mounted a **bind directory** instead (the
[OMV route](openmediavault.md) does), there is no volume to name: the DB is a
plain host file at `<Data shared folder>/jukebox-data/jukebox.db`. Stop the
container and copy the folder — `sudo cp -a …/jukebox-data /var/backups/jukebox-$(date +%F)`
— and skip the `VOL` plumbing below.

**Docker (hot):**

```bash
docker run --rm \
  -v "$VOL":/data \
  -v "$PWD":/backup \
  alpine sh -c 'apk add --no-cache sqlite >/dev/null && \
                sqlite3 /data/jukebox.db ".backup /backup/jukebox-$(date +%F).db"'
```

The command needs network access for `apk add`; if the box is offline, use the
cold copy below. The same command works on the OMV box over SSH.

**Docker (cold, no sqlite CLI):**

```bash
docker stop jukebox
docker run --rm -v "$VOL":/data -v "$PWD":/backup alpine \
  sh -c 'cp /data/jukebox.db* /backup/'
docker start jukebox
```

`docker compose down` is fine here; **`down -v` is not** — it deletes the volume.

**Bare Node** (`/var/lib/jukebox` is the unit's `DATA_DIR`):

```bash
sudo sqlite3 /var/lib/jukebox/jukebox.db ".backup /var/backups/jukebox-$(date +%F).db"
# or, with the app stopped and no sqlite3 CLI:
sudo systemctl stop jukebox
sudo cp /var/lib/jukebox/jukebox.db* /var/backups/
sudo systemctl start jukebox
```

**Restore:** stop the app, remove the current `jukebox.db`, `-wal` and `-shm`,
then put the backup in place *with the right owner* — a plain root copy leaves
the file root-owned and bare Node then crash-loops. Docker runs as root, the
systemd unit runs as `jukebox`. Run this from the directory that holds the
backup, with `jukebox-2026-11-01.db` replaced by your file:

```bash
# Docker: into the named volume (VOL still set from above)
docker stop jukebox
docker run --rm -v "$VOL":/data -v "$PWD":/backup alpine \
  sh -c 'rm -f /data/jukebox.db* && cp /backup/jukebox-2026-11-01.db /data/jukebox.db && chown 0:0 /data/jukebox.db'
docker start jukebox

# Docker with a bind directory (OMV route): a host path, container jukebox-jukebox-1
docker stop jukebox-jukebox-1
sudo rm -f <data folder>/jukebox-data/jukebox.db*
sudo cp jukebox-2026-11-01.db <data folder>/jukebox-data/jukebox.db
docker start jukebox-jukebox-1

# Bare Node: into DATA_DIR
sudo systemctl stop jukebox
sudo rm -f /var/lib/jukebox/jukebox.db*
sudo install -o jukebox -g jukebox -m 640 /var/backups/jukebox-2026-11-01.db /var/lib/jukebox/jukebox.db
sudo systemctl start jukebox
```

Then confirm `/api/health` and open the app. Keep the compose file / systemd unit
in your backups too — they're the rest of the deployment.

## Moving between routes

The only server-side state is `jukebox.db` (plus its `-wal`/`-shm` siblings), so
switching from bare Node to the image, or to another machine, is:

1. stop the old deployment (`sudo systemctl stop jukebox`, `docker compose down`);
2. take a backup with the commands above (or copy `jukebox.db*` while stopped);
3. start the new deployment once, so it creates its data dir/volume;
4. stop it and load the backup with the **Restore** command for the new route —
   re-set `VOL` first if the new route is the image. That step clears a stale
   `-wal`, and its `chown`/`install -o` is what keeps the image (root) and bare
   Node (`jukebox`) from crash-looping on ownership;
5. start it again, check `/api/health` and open the app.

Browser data does not move with it — that is per device and per browser profile.
Only the cabinet layout comes across, via the database.

## Updating

**Image** (compose file with `image:`): `docker compose pull && docker compose up -d`,
or OMV: **Pull** → **Up** (see [openmediavault.md](openmediavault.md#updating)). The
volume is kept. Only app-path changes on `main` produce a new image, so a docs-only
merge is a no-op pull.

**Built from a checkout** (compose file with `build:`): there is no registry to
pull from, so update the source and rebuild:

```bash
git pull --ff-only && docker compose up -d --build
```

**Bare Node** — run it as the service user, then restart:

```bash
sudo -u jukebox -H bash -c 'cd /opt/jukebox && git pull --ff-only && npm ci && npm run build'
sudo systemctl restart jukebox
```

**Clients:** a normal reload picks up the new build — `index.html`, `sw.js` and
the manifest are served `no-cache`, hashed assets are `immutable`. If a device
still shows the old shell, force-refresh once; the service worker keeps the old
precache until it activates. Settings → build line tells you which build the
browser is actually running.

## Rollback

- Image: pin an older commit tag, e.g.
  `ghcr.io/ackervekenbm/jukebox:<sha7>`, and recreate
  ([docker-image.md](docker-image.md#pin-a-version-roll-back)).
- Checkout (bare Node): do it as the service user, or the tree ends up root-owned
  and the next update fails on permissions:

  ```bash
  sudo -u jukebox -H bash -c 'cd /opt/jukebox && git checkout <sha> && npm ci && npm run build'
  sudo systemctl restart jukebox
  ```

  `git checkout main` (or `git switch main`) returns you to the tip afterwards.
  For a `build:`-based compose file, `git checkout <sha> && docker compose up -d --build`.

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
eventually fills the disk — and a full disk is how SQLite starts failing (writes
return 500 while `/api/health` may still say 200). Cap it in compose:

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
- If the disk does fill: writes fail (cabinet sync returns 500, while
  `/api/health` may still say 200). Free space, then restart the
  container/process so SQLite can reopen cleanly.
- Old images accumulate on the host. `docker image prune` (or
  `docker image prune -a` after confirming nothing needs rolling back) reclaims
  space.
- Browser-side growth (tracklist cache) is the app's own concern — Settings shows
  storage usage and offers *Clear everything* per device.
