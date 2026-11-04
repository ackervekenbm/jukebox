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
| `CLIENT_DIST` | `./dist` | `/app/dist` (the default `./dist`, relative to `/app`) | Where the built web app lives |
| `NODE_ENV` | unset | `production` | Run in production mode; set it for bare Node too |

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

- **Bare-Node checkout:** `sudo -u jukebox bash -c 'cd /opt/jukebox && git log -1 --format="%h %ci"'`.
  Run git as the user that owns the checkout; as anyone else it refuses with
  "detected dubious ownership". In a Docker checkout of your own, plain
  `git log -1` works.
- **Image:** compare the tag you run with `main`, or read the *digest* (the
  image's unique content hash) of what you pulled: `docker image inspect ghcr.io/ackervekenbm/jukebox:latest --format '{{index .RepoDigests 0}}'`
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
| Record cabinet (shelves and your gatefold corrections; each device lays the records out itself) | **Server** SQLite, table `cabinet_docs` | yes, if the data dir/volume is kept |
| App build | image / `dist/` + `dist-server/` | rebuilt each deploy |

Two consequences worth remembering:

- The volume is **not** a backup of your collection. Your collection only exists
  in your browsers. ("Clear everything" on every device means re-fetching from
  Discogs.)
- Each browser keeps its own copy of the cabinet and syncs it to the server.
  When two devices edit at once, the one saving its edits wins (*local wins*).
  A device with cabinet edits it hasn't synced yet pushes them when it next
  opens the cabinet, even over a [restored](#restore) server copy.

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

The database is one small SQLite file, `jukebox.db`. While the app runs, SQLite
keeps the newest writes in a side file, `jukebox.db-wal` (its *write-ahead log*),
next to an index file, `jukebox.db-shm`. Copying `jukebox.db` alone while the app
runs can miss those writes, so a backup either uses SQLite's own `.backup`
command (hot, app running) or copies the files with the app stopped (cold).

The commands on this page are for **bash** (the default shell on Debian and its
derivatives).

### Find your data first

Where the database lives depends on the route. **Get this right before running
anything below:** Docker silently creates an empty volume for a name that
doesn't exist, so a wrong name gives you an empty backup or a restore the app
never sees. The commands below check the name before they use it, and
[`jukebox_peek`](#load-the-helpers) shows what a database holds.

| Route | Data location | Container |
| --- | --- | --- |
| `docker run` / the compose file in [docker-image.md](docker-image.md) | volume `jukebox-data` (pinned with `name:`) | `jukebox` |
| The repo's `docker-compose.yml` ([from-source-docker.md](from-source-docker.md)) | volume `<folder>_jukebox-data`, e.g. `jukebox_jukebox-data` for a checkout in `jukebox/` | `jukebox` |
| [OpenMediaVault](openmediavault.md) | host folder `jukebox-data` inside the *Data* shared folder (bind mount, no volume), e.g. `/srv/dev-disk-by-uuid-XXXX/data/jukebox-data` | `jukebox-jukebox-1` |
| Bare Node ([from-source-node.md](from-source-node.md)) | `DATA_DIR`, `/var/lib/jukebox` in the example unit | systemd unit `jukebox` |

### Set the names

Paste **only the block for your route** into the shell you will run the commands
in. A new shell (for a restore days later) needs it again.

Docker volume routes (`docker run`, either compose file):

```bash
docker volume ls | grep -i jukebox    # pick the name from this list
VOL=jukebox-data                      # or jukebox_jukebox-data
CT=jukebox
DOCKER=docker                         # DOCKER="sudo docker" if you run docker with sudo
```

OpenMediaVault (`DATA` is the absolute path of the *Data* shared folder, from
**Storage → Shared Folders**, plus `/jukebox-data`):

```bash
DATA=/srv/dev-disk-by-uuid-XXXX/data/jukebox-data
CT=jukebox-jukebox-1
DOCKER="sudo docker"
```

Bare Node:

```bash
DATA=/var/lib/jukebox
```

### Load the helpers

Paste this once per shell too. It defines three helpers the rest of the page
uses:

```bash
# jukebox_peek: what a database holds, via Docker. $1 is a volume name or an
# absolute folder. Prints one line per Discogs account, nothing if it is empty.
jukebox_peek() {
  case $1 in
    /*) [ -d "$1" ] || { echo "no such folder: $1" >&2; return 1; } ;;
    *) ${DOCKER:-docker} volume inspect "$1" >/dev/null || return 1 ;;  # never create a volume
  esac
  ${DOCKER:-docker} run --rm -v "$1":/d:ro alpine:3.24 sh -c \
    'apk add -q --no-cache sqlite && cp /d/jukebox.db* /tmp/ && \
     sqlite3 /tmp/jukebox.db "select username, revision, saved_at from cabinet_docs"'
}

# jukebox_peek_local: the same without Docker (needs: sudo apt install sqlite3).
# $1 is a folder. It reads a copy, so it never writes into a backup.
jukebox_peek_local() {
  sudo sh -c 'set -e; test -s "$1/jukebox.db"; t=$(mktemp -d); trap "rm -rf $t" EXIT
    cp "$1"/jukebox.db* "$t"/
    sqlite3 "$t/jukebox.db" "select username, revision, saved_at from cabinet_docs"' _ "$1"
}

# DBCOPY: copies the database set from folder $1 to folder $2. It checks both
# first, so a wrong or empty name stops it before anything is deleted, and it
# replaces jukebox.db and jukebox.db-wal in $2 together. A -shm is never copied.
DBCOPY='set -e; s=$1; t=$2; test -s "$s/jukebox.db"; test -d "$t"
  rm -f "$t/jukebox.db" "$t/jukebox.db-wal" "$t/jukebox.db-shm"
  cp "$s/jukebox.db" "$t/"; [ ! -e "$s/jukebox.db-wal" ] || cp "$s/jukebox.db-wal" "$t/"'
```

Then look at your live data. It should list your Discogs username:

```bash
jukebox_peek "${VOL:-$DATA}"          # bare Node without Docker: jukebox_peek_local "$DATA"
```

**Stop if it errors or prints nothing.** You are looking at the wrong volume or
folder, or one with no cabinet saved yet.

### Where backups go

Every backup is its own **timestamped folder**, so two backups never mix:

```bash
sudo install -d -m 755 /var/backups/jukebox
BK=/var/backups/jukebox/$(date +%F-%H%M%S)
sudo install -d -m 700 "$BK"
```

It holds `jukebox.db` and, for a cold copy taken after an unclean stop, possibly
`jukebox.db-wal`; restore puts both back together. Backups hold your Discogs
username and your cabinet layout, which includes the release ids in your
collection, so the folder is readable by root only.

### Hot backup (app running)

Docker volume:

```bash
$DOCKER volume inspect "$VOL" >/dev/null && \
$DOCKER run --rm -v "$VOL":/data -v "$BK":/backup alpine:3.24 sh -c \
  'test -s /data/jukebox.db && apk add -q --no-cache sqlite && sqlite3 /data/jukebox.db ".backup /backup/jukebox.db"'
```

OpenMediaVault:

```bash
$DOCKER run --rm -v "$DATA":/data -v "$BK":/backup alpine:3.24 sh -c \
  'test -s /data/jukebox.db && apk add -q --no-cache sqlite && sqlite3 /data/jukebox.db ".backup /backup/jukebox.db"'
```

Bare Node (needs `sudo apt install sqlite3`). It runs as the service user, so it
can't leave root-owned `-wal`/`-shm` files in the live data:

```bash
sudo chown jukebox "$BK"
sudo -u jukebox sqlite3 "$DATA/jukebox.db" ".backup '$BK/jukebox.db'"
sudo chown root "$BK"
```

The Docker variants need network access for `apk add`; if the box is offline,
take a cold backup. Check the result with `jukebox_peek "$BK"` (or
`jukebox_peek_local "$BK"`).

### Cold backup (app stopped, no sqlite CLI)

Docker volume:

```bash
$DOCKER volume inspect "$VOL" >/dev/null && $DOCKER stop "$CT" && \
$DOCKER run --rm -v "$VOL":/data:ro -v "$BK":/backup alpine:3.24 sh -c "$DBCOPY" _ /data /backup
$DOCKER start "$CT"
```

OpenMediaVault:

```bash
$DOCKER stop "$CT" && sudo sh -c "$DBCOPY" _ "$DATA" "$BK"
$DOCKER start "$CT"
```

Bare Node:

```bash
sudo systemctl stop jukebox && sudo sh -c "$DBCOPY" _ "$DATA" "$BK"
sudo systemctl start jukebox
```

The last line starts the app again even if the copy failed. If you prefer
`docker compose down` to `docker stop`, bring it back with `docker compose up -d`,
since `down` removes the container. **Never `down -v`:** it deletes the volume.

### Restore

1. In the shell you restore from, [set the names](#set-the-names) for the route
   you restore **into** and [load the helpers](#load-the-helpers). Then pick the
   backup and look inside it:

   ```bash
   sudo ls /var/backups/jukebox
   BK=/var/backups/jukebox/2026-11-01-031500    # the one to restore
   jukebox_peek "$BK"                            # or: jukebox_peek_local "$BK"
   ```

   It must list your Discogs username.

2. Stop the app and copy the backup in. `DBCOPY` checks the backup and the
   target before it deletes anything:

   Docker volume (the container runs as root, so no ownership change is needed):

   ```bash
   $DOCKER volume inspect "$VOL" >/dev/null && $DOCKER stop "$CT" && \
   $DOCKER run --rm -v "$VOL":/data -v "$BK":/backup:ro alpine:3.24 sh -c "$DBCOPY" _ /backup /data
   $DOCKER start "$CT"
   ```

   OpenMediaVault:

   ```bash
   $DOCKER stop "$CT" && sudo sh -c "$DBCOPY" _ "$BK" "$DATA"
   $DOCKER start "$CT"
   ```

   Bare Node (the files must belong to the service user, or the unit crash-loops):

   ```bash
   sudo systemctl stop jukebox && \
   sudo sh -c "$DBCOPY"' && chown jukebox:jukebox "$2"/jukebox.db*' _ "$BK" "$DATA"
   sudo systemctl start jukebox
   ```

3. Check the live data again with `jukebox_peek "${VOL:-$DATA}"` (or
   `jukebox_peek_local "$DATA"`) and `/api/health`.

4. Open the cabinet on each device. A device takes the restored layout from the
   server when it next opens the cabinet, **unless** it has cabinet edits it never
   managed to sync: those win and are pushed over the restored copy. To make a
   restore stick everywhere, open the cabinet on such a device only after the
   restore, and undo the edits there if you don't want them.

Keep the compose file or systemd unit in your backups too: they're the rest of the
deployment.

## Moving between routes

The only server-side state is `jukebox.db`, so moving to another route or machine
means carrying that file across:

1. [Set the names](#set-the-names) and [load the helpers](#load-the-helpers) for
   the **old** route, and take a [cold backup](#cold-backup-app-stopped-no-sqlite-cli)
   (note its `BK`). Leave the old deployment stopped, and keep it from starting
   again: `sudo systemctl disable --now jukebox` for bare Node, or
   `docker rm -f <container>` for Docker (the data volume stays).
2. Install the new route, following its guide (for Docker:
   [install Docker](https://docs.docker.com/engine/install/) first). Start it
   once, so it creates its data folder or volume.
3. Set the names for the **new** route and run its [restore](#restore) with that
   `BK`. Restore clears a stale `-wal` and sets the ownership each route needs
   (root for Docker, `jukebox` for bare Node).
4. Check it with `jukebox_peek`, `/api/health` and the app.
5. Update whatever points at the app. The port usually changes (bare Node
   listens on `3000`, the Docker examples on `8080`): fix the reverse-proxy
   upstream ([table](https-and-offline.md#reverse-proxy)) or rerun
   `tailscale serve --bg <port>`, or you get a 502.

The three Docker routes keep data in three different places (the table above),
so this applies when moving between them too: from the `docker run` quickstart to
the repo's compose file, or from either to the OMV folder.

Browser data doesn't move: it is per device and per address. If the address the
devices use changes (a new host name, or `:3000` → `:8080`), every device starts
fresh there: enter the token again and re-add the home-screen icon. The cabinet
comes back from the server.

## Updating

Take a [backup](#backups) first. Each route's guide owns its exact steps:

- **Image:** [docker-image.md](docker-image.md#update) (compose or `docker run`),
  or **Pull** → **Up** on OMV ([openmediavault.md](openmediavault.md#updating)).
  Only app-path changes on `main` produce a new image, so a docs-only merge is a
  no-op pull.
- **Built from a checkout** (compose file with `build:`):
  [from-source-docker.md](from-source-docker.md#updating).
- **Bare Node:** [from-source-node.md](from-source-node.md#updating). Stop the
  service before rebuilding, because the build empties `dist/` and `dist-server/`.

### Devices after an update

The server sends `index.html`, `sw.js` and the manifest with `no-cache`, so
devices pick up a new build by themselves:

- **Browser tab:** reload. If it still shows the old version, reload once more
  (the new service worker takes over on the next load) or force-refresh.
- **Home-screen app:** close it completely (swipe it away in the app switcher)
  and open it again; if it still shows the old version, do that once more. It
  can't force-refresh.

Settings shows a build line with the commit each device is running, which is the
quickest way to tell a client that hasn't updated from a deploy that didn't land
([troubleshooting](troubleshooting.md#a-stale-deployment-survives-every-reload)).

## Rollback

- **Image:** pin an older commit tag and recreate the container
  ([docker-image.md](docker-image.md#pin-a-version-roll-back)).
- **Bare Node:** [from-source-node.md](from-source-node.md#rolling-back).
- **`build:`-based compose file:**
  [from-source-docker.md](from-source-docker.md#updating).

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
