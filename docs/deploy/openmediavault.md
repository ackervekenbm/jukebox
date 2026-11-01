# OpenMediaVault (Compose plugin)

The reference deployment: a Raspberry Pi running **OpenMediaVault** with
omv-extras and the **Compose** plugin, on a 64-bit OS. One container, managed
entirely from the OMV web UI.

OMV's own web UI owns ports **80** and **443**, so the app is published on
**8080** below (any free port works). The container's own port, `3000`, is
fixed: only the host side is yours.

## Prerequisites

- **omv-extras** installed, and the docker repo enabled in **System →
  omv-extras**.
- **`openmediavault-compose`** installed (**System → Plugins**). It installs the
  Docker engine too. **Services → Compose** then has, among others, the
  *Settings*, *Files*, *Services* and *Schedule* tabs used below.
- **A 64-bit OS.** The image is published for `amd64`/`arm64` only, so 32-bit
  Raspberry Pi OS fails with `exec format error`; `better-sqlite3` has no `armv7`
  prebuild either. Use the 64-bit Raspberry Pi OS image.
- **Two shared folders**, set before the first compose file
  (**Services → Compose → Settings**):
  - **Compose Files** — where the plugin stores its compose files (it makes a
    subfolder per stack). Saving fails with *"Please set shared folder for file
    storage."* until this is set.
  - **Data** — the folder this deployment's real data lives in. The compose file
    below refers to it as `CHANGE_TO_COMPOSE_DATA_PATH`, so saving fails with
    *"Please set shared folder for data on the Settings tab."* until this is set.

## Create the stack

1. **Services → Compose → Files → Create** (the `+` button).
2. **Name**: `jukebox`. This is a label for the stack, not a filename — the
   plugin creates a folder of that name inside the *Compose Files* shared folder
   and writes `jukebox/jukebox.yml` into it. (Typing `jukebox.yml` in the Name
   field would give you `jukebox.yml/jukebox.yml.yml`.)
3. **Description**: optional, e.g. `Discogs jukebox`.
4. **File**: paste

   ```yaml
   services:
     jukebox:
       image: ghcr.io/ackervekenbm/jukebox:latest
       ports:
         - "8080:3000"
       volumes:
         - CHANGE_TO_COMPOSE_DATA_PATH/jukebox-data:/app/data
       restart: unless-stopped
   ```

5. Leave **Environment** empty — the image's defaults (`PORT=3000`,
   `DATA_DIR=/app/data`, `HOST=0.0.0.0`) are the ones you want.
6. **Save**.
7. Select the entry → **Check** if you want compose to validate the file, then
   **Up**. That pulls the image and starts the container.
8. Open `http://<pi-ip>:8080`.

Verify: **Services → Compose → Services** lists the container as running, and
`http://<pi-ip>:8080/api/health` returns `{"ok":true,"db":true}`.

### Upgrading from a named-volume stack

Earlier versions of this guide used a named volume (`jukebox-data:/app/data`,
with `container_name: jukebox`). That data is in the Docker volume
`jukebox_jukebox-data`, not in the *Data* shared folder. Pasting the file above
over the old one starts on an **empty** folder: health still says
`{"ok":true,"db":true}`, but the cabinet layout looks gone. Carry the database
across once:

```bash
sudo docker volume ls | grep -i jukebox                 # find the old volume
# Services → Compose → Files → jukebox → Down, then:
sudo mkdir -p "<data folder>/jukebox-data"
sudo docker run --rm -v jukebox_jukebox-data:/old:ro -v "<data folder>/jukebox-data":/new alpine \
  sh -c 'test -s /old/jukebox.db && cp /old/jukebox.db* /new/ && rm -f /new/jukebox.db-shm'
```

Then save the new file and press **Up**. Keep the old volume until the cabinet
shows up on a device, then remove it with `sudo docker volume rm jukebox_jukebox-data`.

## What that file does

- **`CHANGE_TO_COMPOSE_DATA_PATH/jukebox-data`** — the plugin substitutes the
  *Data* shared folder from Settings every time it renders the file, so
  `<data folder>/jukebox-data/jukebox.db` becomes the whole server-side state.
  That beats a named volume here: it is an ordinary folder you can see, browse
  and copy in OMV, and **Prune → Volume** cannot delete it.
- **No `container_name`** — compose derives it from the stack and service, so it
  is `jukebox-jukebox-1`; the plugin's **Logs** button doesn't care. Add
  `container_name: jukebox` if you want the short name in `docker logs`.
- **Port `8080`** — host side only. Change the left-hand number if that port is
  taken; never the right-hand one.
- **Pin instead of tracking `:latest`** — replace the image with
  `ghcr.io/ackervekenbm/jukebox:<sha7>` for a reproducible deploy. Use a SHA that
  has an image tag; docs-only commits don't get one. Editing that
  line in the UI and pressing **Up** is also the rollback procedure
  ([docker-image.md](docker-image.md#pin-a-version-roll-back)).

## Updating

**Services → Compose → Files** → select `jukebox` → **Pull**, then **Up**.

- **Pull** fetches `:latest`; if the image hasn't changed it's a no-op.
- **Up** recreates the container when the image did change. The data folder is
  untouched, so the cabinet sync data survives.
- Old images stay on disk; **Prune → Image** removes the ones nothing uses.

Phone/browser side: a plain reload picks up the new build (the server sends
`no-cache` for `index.html` and `sw.js`). Force-refresh once if a stale service
worker still serves the old shell.

## If a pull is denied

The image is public, so the plugin pulls it anonymously — there is no required
login. If **Pull** fails with an authentication error (stale credentials on the
host, or you switched to a private fork), log in once over SSH with a GitHub
**classic** personal access token that has `read:packages`
(<https://github.com/settings/tokens> → *Tokens (classic)*; fine-grained tokens
don't work with GitHub Packages):

```bash
sudo docker login ghcr.io -u <your-github-username>
```

Keep the token's expiry ≤ 1 year; when it lapses **Pull** fails again and the
login has to be redone. `sudo docker logout ghcr.io` returns to anonymous pulls.

## Where the data lives

The bind mount lands in the *Data* shared folder, so the SQLite file is
`<data folder>/jukebox-data/jukebox.db` (plus `-wal`/`-shm` while it runs). If
you forgot which shared folder you picked:

```bash
sudo docker inspect jukebox-jukebox-1 --format '{{range .Mounts}}{{.Source}}{{end}}'
```

That folder is the only server-side state, so treat it as user data:

- **The plugin's own backup** — **Services → Compose → Schedule** → create a job
  with *Backup* enabled. It stops the containers, copies to the shared folder set
  in *Settings → Backup* (bind-mount volumes included, unless marked
  `# SKIP_BACKUP` or over the size limit), restarts them, and keeps **one** copy
  that the next run overwrites. Versioned backups need a separate OMV rsync job
  or snapshot.
- **A manual copy** needs the container stopped first, otherwise you can catch a
  half-written WAL file. The commands and the restore steps are shared with the
  other routes in [operations.md](operations.md#backups).

## CLI fallback

If you prefer SSH over the UI, use the file the plugin wrote. Its location is
`<Compose Files folder>/<stack name>/<stack name>.yml`:

```bash
sudo find /srv -path '*/jukebox/jukebox.yml' -print
# e.g. /srv/dev-disk-by-uuid-…/compose/jukebox/jukebox.yml
```

Then use that path:

```bash
COMPOSE_FILE=/srv/dev-disk-by-uuid-XXXX/compose/jukebox/jukebox.yml   # your path
sudo docker compose -f "$COMPOSE_FILE" pull
sudo docker compose -f "$COMPOSE_FILE" up -d
```

Mixing CLI and UI is fine — they operate on the same file — but pick one as your
habit so the UI's **Up/Pull** doesn't surprise you. That file is *generated* from
the stack body (the placeholder is already expanded in it) and rewritten on the
next **Save**, so keep deliberate edits in the UI.

## Next

- [https-and-offline.md](https-and-offline.md) — TLS, reverse proxies and offline
  launch (plain HTTP works, but the service worker that allows launching without
  the server needs HTTPS)
- [operations.md](operations.md) — backups, health, env vars, log rotation (cap
  the container's json-file log — a full disk is how SQLite starts failing)
- [troubleshooting.md](troubleshooting.md) — when **Up** starts but nothing
  answers
