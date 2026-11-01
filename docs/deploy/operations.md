# Operations

Part of the [deployment guides](README.md).

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

- **From a checkout:** `sudo -u jukebox git -C /opt/jukebox log -1 --format='%h %ci'`.
  Run it as the user that owns the checkout; as anyone else, git refuses with
  "detected dubious ownership".
- **Image:** compare the tag you run with `main`, or read the digest of what you
  pulled: `docker image inspect ghcr.io/ackervekenbm/jukebox:latest --format '{{index .RepoDigests 0}}'`
  (`RepoDigests` is populated for pulled images; a locally built image may have
  none).
- **In the app:** Settings shows a build line with the commit and its date — the
  date is the commit date the build was stamped with, not a wall-clock build
  time. A local build without those stamps reads `development build` and shows
  no date. It is the quickest "did my deploy actually land?" check, and the
  fastest way to separate a server problem from a stale service worker. To stamp
  a local Docker build, see
  [from-source-docker.md](from-source-docker.md#variations) ("A real version
  line").

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
curl -fsS http://127.0.0.1:8080/api/health     # Docker: the published host port
curl -fsS http://127.0.0.1:3000/api/health     # bare Node
```

`/api/health` runs `SELECT 1` on the open database handle. It is a **liveness**
check, not a data-integrity one:

- `200 {"ok":true,"db":true}`: the process holds a usable database connection.
- `500 {"ok":false,"db":false}`: the handle is unusable. This is rare while
  serving; you see it around shutdown or after a fatal driver error.
- It does **not** catch a full disk or a deleted or corrupt database file. Those
  show up on the next write as a 500 from `PUT /api/sync/cabinet` ("Could not
  save the cabinet") while health still says 200, so watch free space
  separately.
- An unwritable `DATA_DIR` stops the process **before it listens**, so health
  never answers. Look for a container stuck in `Restarting` (`docker ps -a`) or
  a failed `systemctl status jukebox`, and read the log for the SQLite error.

The image's `HEALTHCHECK` polls the endpoint every 30 s, so `docker ps` shows
`healthy`/`unhealthy`. A Docker **restart policy does not act on health
status**: to restart a hung process, point an external monitor (Uptime Kuma,
etc.) at `/api/health`.

## Backups

The database is small and SQLite-specific: copying the file while the app is
running can miss the `-wal` contents, so use SQLite's own backup for a hot copy.

### Find your data first

Where the database lives depends on the route. **Get this right before running
anything below:** Docker silently creates an empty volume for a name that
doesn't exist, so a wrong name gives you an empty backup or a restore the app
never sees. Check the name with [`jukebox_peek`](#check-what-a-database-holds)
before you rely on it.

| Route | Data location | Container |
| --- | --- | --- |
| `docker run` / the compose file in [docker-image.md](docker-image.md) | volume `jukebox-data` (pinned with `name:`) | `jukebox` |
| The repo's `docker-compose.yml` ([from-source-docker.md](from-source-docker.md)) | volume `<dir>_jukebox-data`, e.g. `jukebox_jukebox-data` for a checkout in `jukebox/` | `jukebox` |
| [OpenMediaVault](openmediavault.md) | host folder `jukebox-data` inside the *Data* shared folder (bind mount, no volume), e.g. `/srv/dev-disk-by-uuid-XXXX/data/jukebox-data` | `jukebox-jukebox-1` |
| Bare Node ([from-source-node.md](from-source-node.md)) | `DATA_DIR`, `/var/lib/jukebox` in the example unit | systemd unit `jukebox` |

### Set the names

Paste the lines for your route into the shell you will run the commands in. Every
block below uses these variables, and a new shell (for a restore days later)
needs them again.

```bash
# Docker volume routes
docker volume ls | grep -i jukebox    # pick the name from this list
VOL=jukebox-data                      # or jukebox_jukebox-data
CT=jukebox

# OMV: the absolute path of the Data shared folder (Storage → Shared Folders)
DATA=/srv/dev-disk-by-uuid-XXXX/data/jukebox-data
CT=jukebox-jukebox-1
DOCKER="sudo docker"

# Bare Node
DATA=/var/lib/jukebox
```

### Check what a database holds

The app creates `jukebox.db` the moment it starts, so "the file exists" proves
nothing: a volume the app started on by mistake has one too. Look inside instead.
This helper prints one line per Discogs account (`username|revision|saved_at`),
and prints **nothing** for an empty database:

```bash
jukebox_peek() {   # $1: a volume name, or an absolute folder
  case $1 in
    /*) ;;
    *) ${DOCKER:-docker} volume inspect "$1" >/dev/null || return 1 ;;  # never create a volume
  esac
  ${DOCKER:-docker} run --rm -v "$1":/d:ro alpine:3.20 sh -c \
    'apk add -q --no-cache sqlite && cp /d/jukebox.db* /tmp/ && \
     sqlite3 /tmp/jukebox.db "select username, revision, saved_at from cabinet_docs"'
}

jukebox_peek "$VOL"       # or: jukebox_peek "$DATA"
```

It needs network access for `apk add`. On bare Node, with the `sqlite3` CLI
(`sudo apt install sqlite3`):
`sudo -u jukebox sqlite3 "$DATA/jukebox.db" 'select username, revision, saved_at from cabinet_docs'`.

**Stop if it errors or prints nothing.** You are looking at the wrong volume or
folder, or one with no cabinet saved yet.

### Where backups go

Every backup is its own **timestamped directory**, so two backups never mix:

```bash
sudo install -d -m 755 /var/backups/jukebox
BK=/var/backups/jukebox/$(date +%F-%H%M%S)
sudo install -d -m 700 "$BK"
```

It holds `jukebox.db` and, for a cold copy taken after an unclean stop, possibly
`jukebox.db-wal`. Restore copies the directory's `jukebox.db*` back as a set, so
committed data in a leftover `-wal` isn't lost. A `-shm` file is never backed up
or restored; SQLite rebuilds it. Backups hold your Discogs username and your
cabinet layout, which includes the release ids in your collection, so the
directory is readable by root only.

### Hot backup (app running)

```bash
# Docker volume or OMV folder (use "$DATA" in place of "$VOL" on OMV)
${DOCKER:-docker} run --rm -v "$VOL":/data -v "$BK":/backup alpine:3.20 sh -c \
  'apk add -q --no-cache sqlite && sqlite3 /data/jukebox.db ".backup /backup/jukebox.db"'

# Bare Node: as the service user, so it can't leave root-owned -wal/-shm files
sudo chown jukebox "$BK"
sudo -u jukebox sqlite3 "$DATA/jukebox.db" ".backup '$BK/jukebox.db'"
sudo chown root "$BK"
```

The Docker variant needs network access for `apk add`; if the box is offline,
take a cold backup. Check the result with `jukebox_peek "$BK"`. Without Docker,
use `sudo sqlite3 "file:$BK/jukebox.db?immutable=1" 'select username, revision, saved_at from cabinet_docs'`;
`immutable=1` opens it without writing anything into the backup.

### Cold backup (app stopped, no sqlite CLI)

```bash
# Docker volume
docker stop "$CT"
docker run --rm -v "$VOL":/data:ro -v "$BK":/backup alpine:3.20 sh -c \
  'cp /data/jukebox.db /backup/ && { [ ! -e /data/jukebox.db-wal ] || cp /data/jukebox.db-wal /backup/; }'
docker start "$CT"

# OMV folder or bare Node (a root shell expands the glob, so it works on any folder mode)
sudo docker stop "$CT"            # bare Node: sudo systemctl stop jukebox
sudo sh -c 'cp "$1"/jukebox.db "$2"/ && { [ ! -e "$1"/jukebox.db-wal ] || cp "$1"/jukebox.db-wal "$2"/; }' _ "$DATA" "$BK"
sudo docker start "$CT"           # bare Node: sudo systemctl start jukebox
```

Use `docker stop`/`docker start` (or `systemctl stop`/`start`). If you prefer
`docker compose down`, bring it back with `docker compose up -d`, since `down`
removes the container. **Never `down -v`:** it deletes the volume.

### Restore

1. Set the names for the route you restore **into**
   ([above](#set-the-names)), then pick the backup:

   ```bash
   sudo ls /var/backups/jukebox
   BK=/var/backups/jukebox/2026-11-01-031500    # the one to restore
   jukebox_peek "$BK"                            # must list your account
   # without Docker: sudo sqlite3 "file:$BK/jukebox.db?immutable=1" 'select username, revision, saved_at from cabinet_docs'
   ```

2. Stop the app and replace the database. Each command checks the backup first and
   only then deletes the current files, in one root shell, so a wrong `BK` stops
   it before anything is removed:

   ```bash
   The same script does the work on every route. It copies `jukebox.db` and, if
   present, `jukebox.db-wal`, never a `-shm`:

   ```bash
   RESTORE='set -e; b=$1; d=$2; test -s "$b/jukebox.db"
     rm -f "$d/jukebox.db" "$d/jukebox.db-wal" "$d/jukebox.db-shm"
     cp "$b/jukebox.db" "$d/"; [ ! -e "$b/jukebox.db-wal" ] || cp "$b/jukebox.db-wal" "$d/"'

   # Docker volume (the container runs as root)
   docker stop "$CT"
   docker run --rm -v "$VOL":/data -v "$BK":/backup:ro alpine:3.20 sh -c "$RESTORE" _ /backup /data
   docker start "$CT"

   # OMV folder
   sudo docker stop "$CT"
   sudo sh -c "$RESTORE" _ "$BK" "$DATA"
   sudo docker start "$CT"

   # Bare Node: the files must belong to the service user, or the unit crash-loops
   sudo systemctl stop jukebox
   sudo sh -c "$RESTORE"' && chown jukebox:jukebox "$d"/jukebox.db*' _ "$BK" "$DATA"
   sudo systemctl start jukebox
   ```

3. Confirm with `jukebox_peek` on the live data, `/api/health`, and the app.

Keep the compose file or systemd unit in your backups too: they're the rest of the
deployment.

## Moving between routes

The only server-side state is `jukebox.db` (plus its `-wal`/`-shm` siblings), so
switching from bare Node to the image, or to another machine, is:

1. [set the names](#set-the-names) for the **old** route, and stop it;
2. take a cold backup of it with the commands above, and note its `BK`;
3. start the new deployment once, so it creates its data dir/volume;
4. [set the names](#set-the-names) for the **new** route, stop it and run its
   **Restore** command with that `BK`. Restore clears a stale `-wal`, and its
   `chown` is what keeps the image (root) and bare Node (`jukebox`) from
   crash-looping on ownership;
5. start it again, check it with `jukebox_peek`, `/api/health` and the app.

This applies to switching between Docker routes too. The three Docker routes
keep data in three different places (the table above), so moving from the
`docker run` quickstart to the repo's compose file, or from either to the OMV
bind folder, starts on an empty database unless you carry `jukebox.db` across.

Browser data does not move with it — that is per device and per browser profile.
Only the cabinet layout comes across, via the database.

## Updating

Take a [backup](#backups) first. Each route's guide owns its exact steps:

- **Image:** [docker-image.md](docker-image.md#update) (compose or `docker run`),
  or **Pull** → **Up** on OMV ([openmediavault.md](openmediavault.md#updating)).
  Only app-path changes on `main` produce a new image, so a docs-only merge is a
  no-op pull.
- **Built from a checkout** (compose file with `build:`):
  `git pull --ff-only && docker compose up -d --build`
  ([from-source-docker.md](from-source-docker.md)).
- **Bare Node:** [from-source-node.md](from-source-node.md#updating). Stop the
  service before rebuilding, because the build empties `dist/` and `dist-server/`.

**Clients:** a normal reload picks up the new build — `index.html`, `sw.js` and
the manifest are served `no-cache`, hashed assets are `immutable`. If a device
still shows the old shell, force-refresh once; the service worker keeps the old
precache until it activates. Settings → build line tells you which build the
browser is actually running.

## Rollback

- Image: pin an older commit tag, e.g.
  `ghcr.io/ackervekenbm/jukebox:<sha7>`, and recreate
  ([docker-image.md](docker-image.md#pin-a-version-roll-back)).
- Checkout (bare Node): the update procedure in
  [from-source-node.md](from-source-node.md#updating) with `git checkout <sha>`
  in place of `git pull --ff-only`. `git switch main` returns you to the tip
  afterwards.
- `build:`-based compose file: `git checkout <sha> && docker compose up -d --build`.

Data is unaffected either way: the schema is a single table created with
`CREATE TABLE IF NOT EXISTS` and nothing migrates destructively.

## Logs

```bash
docker compose logs -f jukebox          # image / compose
docker logs -f jukebox                  # docker run
journalctl -u jukebox -f                # systemd
```

The server is quiet: a startup line, Discogs identity-check errors (`[auth]`;
a rejected token is a plain 401 and is not logged), uncaught 5xx
(`[server]`) and shutdown. It does **not** log requests, tokens or collection
data. The `/discogs` proxy forwards each request's token to Discogs, and sync
requests resolve it to a Discogs username; the server keeps only a SHA-256 hash
of it, in memory, for ten minutes.

## Log rotation and disk space

Docker's default `json-file` log driver grows without bound. On a small box that
eventually fills the disk, and a full disk is how SQLite starts failing (writes
return 500 while `/api/health` still says 200). Cap it in compose:

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

The database itself stays in the low megabytes. If the disk does fill, free
space and then restart the container or process so SQLite reopens cleanly. Old
images also pile up: `docker image prune` reclaims them (add `-a` once nothing
needs rolling back). Browser-side storage is per device; Settings shows usage
and offers *Clear everything*.
