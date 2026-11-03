# OpenMediaVault (Compose plugin)

Part of the [deployment guides](README.md).

The reference deployment: **OpenMediaVault** with omv-extras and the
**Compose** plugin, on a 64-bit OS. One container, managed
entirely from the OMV web UI.

OMV's own web UI uses port **80** (and **443** if you turned on its SSL), so the
app is published on **8080** below (any free port works). The container's own
port, `3000`, is fixed: only the host side is yours.

## Prerequisites

- **OpenMediaVault itself**, on a minimal 64-bit Debian-based OS without a
  desktop environment (desktop images aren't supported). On x86, follow the
  [OMV installation docs](https://docs.openmediavault.org/en/stable/installation/index.html),
  then add omv-extras with its
  [install script](https://github.com/OpenMediaVault-Plugin-Developers/installScript).
  On ARM boards, use the [omv-extras wiki](https://wiki.omv-extras.org/)'s guide
  for your board, e.g.
  [Installing OMV8 on a Raspberry Pi](https://wiki.omv-extras.org/doku.php?id=omv8:raspberry_pi_install)
  (on the board's 64-bit *Lite* image); its script also sets up omv-extras.
- **omv-extras** with the docker repo enabled in **System → omv-extras**.
- **`openmediavault-compose`** installed (**System → Plugins**). It installs the
  Docker engine too. **Services → Compose** then has, among others, the
  *Settings*, *Files*, *Services* and *Schedule* tabs used below.
- **A 64-bit OS** (`amd64` or `arm64`)
  ([why](README.md#the-contract-every-route-shares)).
- **Two shared folders.** Create them first in **Storage → Shared Folders →
  Create** (`+`), e.g. `compose` and `data` on your data disk, then pick them in
  **Services → Compose → Settings**:
  - **Compose Files**: where the plugin stores its compose files (one subfolder
    per stack). Saving a stack fails with *"Please set shared folder for file
    storage."* until this is set.
  - **Data**: where this deployment's real data lives. The compose file below
    refers to it as `CHANGE_TO_COMPOSE_DATA_PATH`, and saving fails with
    *"Please set shared folder for data on the Settings tab."* until it is set.

  Note the Data folder's absolute path from the Shared Folders page (show the
  *Absolute Path* column if it is hidden), e.g.
  `/srv/dev-disk-by-uuid-XXXX/data`. The backup commands need it.

## Create the stack

1. **Services → Compose → Files → Create** (the `+` button).
2. **Name**: `jukebox`. This is a label for the stack, not a filename: the
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
       logging:
         driver: json-file
         options:
           max-size: "10m"
           max-file: "3"
       restart: unless-stopped
   ```

5. Leave **Environment** empty. The image's defaults (`PORT=3000`,
   `DATA_DIR=/app/data`, `HOST=0.0.0.0`) are the ones you want.
6. **Save**.
7. Select the entry → **Check** if you want compose to validate the file, then
   **Up**. That pulls the image and starts the container.
8. Open `http://<server-ip>:8080`.

Verify: **Services → Compose → Services** lists the container as running, and
`http://<server-ip>:8080/api/health` returns `{"ok":true,"db":true}`.

## What that file does

- **`CHANGE_TO_COMPOSE_DATA_PATH/jukebox-data`**: the plugin substitutes the
  *Data* shared folder's path every time it renders the file, so
  `<Data shared folder>/jukebox-data/jukebox.db` is the whole server-side state.
  That beats a named volume here: it is an ordinary folder you can see, browse
  and copy in OMV, and **Prune → Volume** cannot delete it.
- **No `container_name`**: compose derives it from the stack and service, so it
  is `jukebox-jukebox-1`. The plugin's **Logs** button doesn't care.
- **Port `8080`**: host side only. Change the left-hand number if that port is
  taken; never the right-hand one. Once you reach the app only through
  [Tailscale](#https-on-omv), change it to `"127.0.0.1:8080:3000"` and press
  **Up**, so plain HTTP isn't also open on the LAN.
- **`logging`**: caps the container log at 30 MB. Without it the log grows until
  the disk is full, and a full disk is how SQLite starts failing.
- **Pin instead of tracking `:latest`**: replace the image with a commit tag,
  e.g. `ghcr.io/ackervekenbm/jukebox:351e79b`, for a reproducible deploy. Only
  commits that changed the app have a tag
  ([which ones](docker-image.md#pin-a-version-roll-back)). Editing that line and
  pressing **Up** is also how you roll back.

## Updating

**Services → Compose → Files** → select `jukebox` → **Pull**, then **Up**.

- **Pull** fetches `:latest`; if the image hasn't changed it's a no-op.
- **Up** recreates the container when the image did change. The data folder is
  untouched, so the cabinet survives.
- Old images stay on disk. **Prune → Image** removes untagged ones, such as the
  previous `:latest` after a pull. A pinned tag you no longer use (e.g. after a
  rollback) stays until you delete it in the **Images** tab.

Devices pick up the new build on their own
([details](operations.md#devices-after-an-update)). If **Pull** is refused with
an authentication error, see
[If a pull is denied](docker-image.md#if-a-pull-is-denied) and run its commands
over SSH.

## Backups

The data folder is the only server-side state, so treat it as user data:

- **The plugin's own backup**: **Services → Compose → Schedule** → create a job
  with *Backup* enabled. It stops the containers, copies to the shared folder set
  in *Settings → Backup* (bind-mount folders included, unless marked
  `# SKIP_BACKUP` or over the size limit) and restarts them. With the default
  *rsync* backend it keeps **one** copy that the next run overwrites. For
  versioned backups, set the backup backend to *borg* in **Settings** (it keeps 7
  by default; available since plugin version 8.1.3), or add a separate OMV rsync
  job or snapshot.
- **By hand over SSH**: [operations.md](operations.md#backups) has hot (app
  running) and cold (app stopped) backups and the restore for the OMV folder.
  Never copy the folder by hand while the container runs: you can catch a
  half-written WAL file.

If you forgot where the data folder is, ask the running container. This prints
the full path, ending in `/jukebox-data`:

```bash
sudo docker inspect jukebox-jukebox-1 --format '{{range .Mounts}}{{.Source}}{{end}}'
```

## HTTPS on OMV

Offline launch needs HTTPS ([why](https-and-offline.md)). A reverse proxy on the
OMV host itself can't take ports 80/443, because OMV's own web UI holds them.
The easiest route is **Tailscale** (`tailscale serve` gives you HTTPS without
touching those ports); see
[https-and-offline.md](https-and-offline.md#tailscale). A Caddy or nginx on
another port (e.g. `8443`), or on a different machine, works too.

## Upgrading from a named-volume stack

Earlier versions of this guide used a named volume (`jukebox-data:/app/data`,
with `container_name: jukebox`). That data is in a Docker volume such as
`jukebox_jukebox-data`, not in the *Data* shared folder. Pasting the file above
over the old one starts on an **empty** folder: health still says
`{"ok":true,"db":true}`, but the cabinet layout looks gone. Carry the database
across once:

```bash
sudo docker volume ls | grep -i jukebox                 # find the old volume
OLD=jukebox_jukebox-data                                # the name you just saw
DATA=/srv/dev-disk-by-uuid-XXXX/data/jukebox-data       # Data shared folder + /jukebox-data
# Services → Compose → Files → jukebox → Down, then:
sudo docker volume inspect "$OLD" >/dev/null && sudo mkdir -p "$DATA" && \
sudo docker run --rm -v "$OLD":/old:ro -v "$DATA":/new alpine:3.24 sh -c \
  'test -s /old/jukebox.db && rm -f /new/jukebox.db /new/jukebox.db-wal /new/jukebox.db-shm && \
   cp /old/jukebox.db /new/ && { [ ! -e /old/jukebox.db-wal ] || cp /old/jukebox.db-wal /new/; }'
```

`volume inspect` stops it if the name is wrong, so it can't create a new empty
volume. The `rm` clears the empty database the new stack made if you already
pressed **Up**, including any leftover `-wal`, which SQLite would otherwise replay
over the migrated file. To check that the old volume really holds your cabinet first, use
[`jukebox_peek`](operations.md#load-the-helpers). Then save the new
file and press **Up**. Keep the old volume until the cabinet shows up on a
device, then remove it with `sudo docker volume rm "$OLD"`.

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

Mixing CLI and UI is fine, since they operate on the same file, but pick one as
your habit so the UI's **Up/Pull** doesn't surprise you. That file is
*generated* from the stack body (the placeholder is already expanded in it) and
rewritten on the next **Save**, so keep deliberate edits in the UI.

## Next

- [https-and-offline.md](https-and-offline.md): HTTPS and offline launch
- [operations.md](operations.md): backups, health, env vars, logs
- [troubleshooting.md](troubleshooting.md): when **Up** starts but nothing
  answers
- Back to the overview: [docs/deploy/README.md](README.md)
