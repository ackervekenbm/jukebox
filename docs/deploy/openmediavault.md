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

5. Leave **Environment** empty: nothing in this file needs a variable, and the
   image's defaults (`PORT=3000`, `DATA_DIR=/app/data`, `HOST=0.0.0.0`) are the
   ones you want.
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
- **Ownership is automatic.** The app runs as the unprivileged user uid 1000,
  not as root. Each time the container starts it gives `jukebox-data` and
  the files in it to that user. Nothing to set up in OMV and no SSH needed, also
  for a folder an older image left owned by root
  ([first update](#the-first-update-after-the-switch-to-uid-1000)). Only
  `jukebox-data` changes hands: the *Data* shared folder, its permissions in
  the OMV UI and the other stacks' folders stay as they are. On the host,
  uid 1000 is usually the first user created on the machine, and that user can
  read the database (your Discogs username and cabinet layout); if that
  matters, keep the *Data* shared folder closed to them.
- **The Data folder must be on a Linux filesystem.** Check its type under
  **Storage → File Systems**: ext4, btrfs and xfs (what OMV formats with) work.
  NTFS, exFAT and FAT can't store an owner, so the container can't take the
  folder over and won't start.
- **No `container_name`**: compose derives it from the stack and service, so it
  is `jukebox-jukebox-1`. The plugin's **Logs** button doesn't care.
- **Port `8080`**: host side only. Change the left-hand number if that port is
  taken; never the right-hand one. Once you reach the app only over
  [HTTPS](#https-on-omv), close it so plain HTTP isn't also open on the LAN:
  with Tailscale, change it to `"127.0.0.1:8080:3000"`; with Caddy, remove
  `ports:` altogether. Then press **Up**. Keep it while some devices still use
  `http://<server-ip>:8080`.
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
- **Up** recreates the container when the image did change. The data in the
  folder is untouched, so the cabinet survives.
- Old images stay on disk. **Prune → Image** removes untagged ones, such as the
  previous `:latest` after a pull. A pinned tag you no longer use (e.g. after a
  rollback) stays until you delete it in the **Images** tab.

Devices pick up the new build on their own
([details](operations.md#devices-after-an-update)). If **Pull** is refused with
an authentication error, see
[If a pull is denied](docker-image.md#if-a-pull-is-denied) and run its commands
over SSH.

### The first update after the switch to uid 1000

Images from before the app stopped running as root left `jukebox-data` owned
by root. The first **Up** with a newer image hands it over by itself; there is
nothing to do beforehand. Afterwards, check:

1. **Services → Compose → Services** shows the container running and, after
   about half a minute, healthy.
2. Its **Logs** have no line starting with `jukebox: could not give`.
3. The app opens and the cabinet shows your shelves.

If the container keeps restarting instead, the log says why
([troubleshooting](troubleshooting.md#the-container-restarts-in-a-loop)). The
database is not damaged either way. To go back meanwhile, pin the previous image
tag in the stack ([how](docker-image.md#pin-a-version-roll-back)) and press **Up**.

**Resetting permissions in OMV:** a recursive *Reset permissions* or ACL change
on the *Data* shared folder gives `jukebox-data` back to root while the app
runs, and saving the cabinet then fails. Restart the stack (**Down**, **Up**) and
the container takes the folder over again.

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
Two routes work well:

- **Tailscale**: `tailscale serve` gives you HTTPS without touching those
  ports, but every device needs the Tailscale app; see
  [https-and-offline.md](https-and-offline.md#tailscale).
- **Caddy in its own stack**, on port `8443`, with a free DuckDNS name and a
  Let's Encrypt certificate. Devices need nothing installed, no port is opened
  on your router, and the same Caddy can serve your other apps. The steps
  follow; [Caddy in Docker](https-and-offline.md#caddy-in-docker) explains each
  part.

### Caddy on OMV

**1. A DuckDNS name.** Sign in at <https://www.duckdns.org>, add a name (e.g.
`yourname`), set its IP to the OMV box's **LAN** address, and note the token at
the top of the page. Give the box a fixed address (a DHCP reservation in your
router), since the name points to it. The app will be at
`https://jukebox.yourname.duckdns.org:8443`. Check from a laptop that
`nslookup jukebox.yourname.duckdns.org` answers with the LAN address; if it
doesn't, see step 4 of
[DuckDNS + Let's Encrypt](https-and-offline.md#duckdns--lets-encrypt-with-caddy).

**2. A shared network.** **Services → Compose → Networks → Create**, name
`proxy`, defaults otherwise (or `sudo docker network create proxy` over SSH).

**3. Put Jukebox on it.** Edit the `jukebox` stack, add `networks: [proxy]` to
the service and the network at the bottom, then **Save** → **Up**:

```yaml
services:
  jukebox:
    image: ghcr.io/ackervekenbm/jukebox:latest
    ports:
      - "8080:3000"
    volumes:
      - CHANGE_TO_COMPOSE_DATA_PATH/jukebox-data:/app/data
    networks:
      - proxy
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    restart: unless-stopped

networks:
  proxy:
    external: true
```

**4. The Caddy stack.** **Files → Create**, name `caddy`. In **File**, paste the
following and replace `yourname` (twice):

```yaml
services:
  caddy:
    build:
      pull: true       # fresh base images and module on every (re)build
      no_cache: true
      dockerfile_inline: |
        FROM caddy:2-builder AS builder
        RUN xcaddy build --with github.com/caddy-dns/duckdns
        FROM caddy:2
        COPY --from=builder /usr/bin/caddy /usr/bin/caddy
    image: caddy-duckdns:local
    ports:
      - "8443:8443"
      - "8443:8443/udp"
    environment:
      DUCKDNS_TOKEN: ${DUCKDNS_TOKEN:?set DUCKDNS_TOKEN in Environment}
    configs:
      - source: caddyfile
        target: /etc/caddy/Caddyfile
    volumes:
      - CHANGE_TO_COMPOSE_DATA_PATH/caddy/data:/data
      - CHANGE_TO_COMPOSE_DATA_PATH/caddy/config:/config
    networks:
      - proxy
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    restart: unless-stopped

configs:
  caddyfile:
    content: |
      *.yourname.duckdns.org:8443 {
        tls {
          dns duckdns {env.DUCKDNS_TOKEN}
          resolvers 1.1.1.1 8.8.8.8
        }

        @jukebox host jukebox.yourname.duckdns.org
        handle @jukebox {
          reverse_proxy jukebox:3000
        }

        handle {
          abort
        }
      }

networks:
  proxy:
    external: true
```

In **Environment**, put the token on one line, `DUCKDNS_TOKEN=<your token>`, so
it stays out of the file itself. **Save**.

**5. Up.** The first **Up** builds Caddy, which takes a few minutes, and the UI
looks idle meanwhile. Then **Services** → `caddy-caddy-1` → **Logs** should show
"certificate obtained successfully" within a minute or two.
`https://jukebox.yourname.duckdns.org:8443/api/health` should then answer
`{"ok":true,"db":true}` with no certificate warning. A `502` means Jukebox isn't
on the `proxy` network (step 3).

**6. Devices.** Open the HTTPS address and add it to the home screen from
there. It is a new site to the browser, so you enter your **Discogs** token again
([details](https-and-offline.md#what-actually-needs-https)); then
[verify offline launch](https-and-offline.md#verifying-offline-launch).

Notes:

- **Changing the Caddyfile** (e.g. another app): edit the stack, **Save**, then
  **Down** and **Up**. A plain **Up** can keep the old config.
- **Updating Caddy**: **Down**, delete `caddy-duckdns:local` in the **Images**
  tab, then **Up**. `pull` and `no_cache` make that rebuild fetch the newest
  Caddy and module. **Pull** can't fetch this image and reports an error for
  it; that is harmless.
- **More apps**: add them to the `proxy` network and give each a `handle`
  block ([how](https-and-offline.md#caddy-in-docker)); the wildcard
  certificate already covers every name under yours.
- **The plain-HTTP port** of the `jukebox` stack: see
  [Port `8080`](#what-that-file-does).
- **Backups**: `caddy/` holds only the certificate, which Caddy requests again
  if it is lost. `jukebox-data` is still the folder that matters.

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
