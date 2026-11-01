# Bare Node (from a checkout)

Part of the [deployment guides](README.md).

Run the built server directly under Node, with systemd keeping it alive. Use
this when the host already runs Node and you'd rather not add Docker.

## What you need

- **Node 22 or newer** (`package.json` engines) and `git`. Check with `node -v`.
  Debian 12 and Raspberry Pi OS (bookworm) ship Node 18 in `apt`, which is too
  old. Install 22 from [NodeSource](https://github.com/nodesource/distributions)
  instead (read the script before you pipe it to a shell):

  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh
  sudo bash nodesource_setup.sh
  sudo apt install -y nodejs git
  ```

  That puts Node at `/usr/bin/node`, which the unit below expects.
- **A 64-bit OS** (`x64` or `arm64`; on a Pi, `uname -m` must say `aarch64`).
  On 32-bit the build succeeds but `npm start` fails; see
  [64-bit only](README.md#the-contract-every-route-shares).
- No C compiler, Python or `make`: nothing is compiled at install time.
- Enough memory to build. `npm run build` type-checks, lints and bundles the
  client on the machine itself. On a 2 GB Raspberry Pi that takes several minutes
  and most of the memory. To avoid that, build on another machine and
  [ship a tarball](#shipping-a-tarball).
- Optional: a reverse proxy for a hostname and HTTPS, see
  [https-and-offline.md](https-and-offline.md).

## Install as a service

The checkout lives in `/opt/jukebox`, the database in `/var/lib/jukebox`, and a
system user `jukebox` owns both. The user's home, `/var/cache/jukebox`, only
holds npm's download cache.

**1. Create the service user:**

```bash
sudo useradd --system --create-home --home-dir /var/cache/jukebox \
  --shell /usr/sbin/nologin jukebox
sudo install -d -o jukebox -g jukebox /opt/jukebox
```

**2. Clone and build as that user**, so the tree the service reads is the one it
wrote. `-H` sets `HOME` to the user's home; without it `npm ci` tries to cache
into `/root/.npm` and fails with `EACCES`:

```bash
sudo -u jukebox -H git clone https://github.com/ackervekenbm/jukebox.git /opt/jukebox
sudo -u jukebox -H bash -c 'cd /opt/jukebox && npm ci && npm run build'
```

**3. Write the unit:**

```bash
sudo tee /etc/systemd/system/jukebox.service >/dev/null <<'EOF'
[Unit]
Description=Jukebox (Discogs collection browser)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=jukebox
Group=jukebox
WorkingDirectory=/opt/jukebox
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/jukebox
# Creates /var/lib/jukebox for User=, readable by it only, and keeps it
# writable under ProtectSystem=strict below.
StateDirectory=jukebox
StateDirectoryMode=0700
# New files (the database) are readable by the service user only.
UMask=0077
ExecStart=/usr/bin/node dist-server/index.js
Restart=on-failure
RestartSec=5

# Hardening: the app only reads /opt/jukebox and writes DATA_DIR.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
EOF
```

**4. Start it:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jukebox
curl -fsS http://127.0.0.1:3000/api/health     # {"ok":true,"db":true}
```

The server logs `[jukebox] http://127.0.0.1:3000 (client + API)` on boot
(`journalctl -u jukebox`). It serves the client **and** the API; there is no
separate static server step.

### What the unit relies on

- **`WorkingDirectory=/opt/jukebox`** is where the default `CLIENT_DIST=./dist`
  resolves from. If you install somewhere else, change it and `DATA_DIR`
  together.
- **`HOST=127.0.0.1`** is deliberate: a reverse proxy on the same machine reaches
  it, nothing else does. To reach the app directly from other devices, set
  `HOST=0.0.0.0`, which listens on every interface. Jukebox has no login, so do
  that only on a trusted network
  ([why](README.md#keep-it-on-your-lan-or-tailnet)).
- **`/usr/bin/node`** is where NodeSource installs Node. With `nvm`/`fnm`, Node
  lives under a home directory that `ProtectHome=yes` hides from the service:
  install Node system-wide, or drop `ProtectHome=yes` and point `ExecStart` at
  that interpreter's absolute path.
- **An unwritable data directory** makes the process exit during start-up
  instead of answering 500, and `/api/health` never responds. `systemctl status
  jukebox` and the journal show the SQLite error.
- **Shutdown** is clean: on `SIGTERM` it stops accepting connections, closes the
  database and exits (forced after 10 s).

## Updating

Take a [backup](operations.md#backups) first. Note the commit you are on, so you
can roll back to it, then stop the service and build:

```bash
PREV=$(sudo -u jukebox bash -c 'cd /opt/jukebox && git rev-parse --short HEAD'); echo "$PREV"
sudo systemctl stop jukebox
sudo -u jukebox -H bash -c 'cd /opt/jukebox && git switch main && git pull --ff-only && npm ci && npm run build'
sudo systemctl start jukebox
```

The service has to be stopped because the build is destructive while it runs:
`npm ci` deletes `node_modules`, `vite build` empties `dist/` and `tsup --clean`
deletes `dist-server/`, so a running server would answer with 404s. `git switch
main` makes the update work after a rollback too, which leaves the checkout on a
detached commit. For an update with no downtime, build in a second checkout and
point `WorkingDirectory` at it.

Always build as the service user, never as root: a root-owned `dist-server/`
still runs, but the next update as `jukebox` fails on permissions.

## Rolling back

To go back to the commit you noted (or any other), check it out and rebuild the
same way:

```bash
sudo systemctl stop jukebox
sudo -u jukebox -H bash -c "cd /opt/jukebox && git checkout $PREV && npm ci && npm run build"
sudo systemctl start jukebox
```

If the shell with `PREV` is gone, `sudo -u jukebox bash -c 'cd /opt/jukebox && git reflog'`
lists the commits the checkout has been on. The next [update](#updating) returns
to `main`. The data is unaffected either way: the schema is one table created with
`CREATE TABLE IF NOT EXISTS`, and nothing migrates destructively.

If a build fails partway (type-check and lint run first), the tree is
half-cleaned and the service can't start until a build succeeds. Roll back to the
last good commit as above.

## Trimming dev dependencies

To keep only what the runtime needs after building:

```bash
sudo -u jukebox -H bash -c 'cd /opt/jukebox && npm prune --omit=dev'
```

The build outputs (`dist/`, `dist-server/`) stay; only dev dependencies go. The
next update's `npm ci` puts them back.

## Shipping a tarball

There is no published package, but you can build on a faster machine and ship
the result. The tarball only contains JavaScript and the package manifests, so
it isn't tied to the build machine's platform:

```bash
# on the build machine, in a checkout
npm ci
COMMIT_SHA=$(git rev-parse HEAD) BUILD_TIME=$(git log -1 --format=%cI) npm run build
tar -czf jukebox-$(git rev-parse --short HEAD).tar.gz \
  dist dist-server package.json package-lock.json .npmrc
```

The `COMMIT_SHA`/`BUILD_TIME` variables stamp the build line in Settings;
without them it reads `development build`.

On the target, set up steps 1 and 3 of [Install as a service](#install-as-a-service)
(the user and the unit), then:

```bash
TARBALL=jukebox-1a2b3c4.tar.gz    # the file you copied over
sudo -u jukebox tar -xzf - -C /opt/jukebox < "$TARBALL"
sudo -u jukebox -H bash -c 'cd /opt/jukebox && npm ci --omit=dev'
sudo systemctl daemon-reload && sudo systemctl enable --now jukebox
```

Your own shell opens the tarball (`< "$TARBALL"`), so it works even though the
`jukebox` user can't read your home folder. `npm ci --omit=dev` needs network
access to the npm registry (or a warm npm cache) for `express`,
`better-sqlite3`, `zod` and friends, but **no toolchain**: installs are
script-free, and `better-sqlite3` ships prebuilt binaries for linux (glibc and
musl), macOS and Windows on x64 and arm64 inside the one package.

Start it through the unit, not by hand as root: a root-run process creates its
database as root (in `DATA_DIR`, or `./data` by default), and the `jukebox`
service then can't open it.

To update a tarball install, extract the new tarball over the old one with the
service stopped, then run `npm ci --omit=dev` again. To roll back, extract the
older tarball the same way.

## Trying it without systemd

For a quick look on your own machine, with no service user:

```bash
git clone https://github.com/ackervekenbm/jukebox.git
cd jukebox
npm ci && npm run build
NODE_ENV=production DATA_DIR="$PWD/data" npm start    # → http://127.0.0.1:3000
```

This keeps its database in `./data`, owned by you. The service install above
does not see it, so treat this as a throwaway: if you want to keep a cabinet you
made here, copy `data/jukebox.db` into the service's data with the
[restore steps](operations.md#restore).

## Next

- Reverse proxy and TLS: [https-and-offline.md](https-and-offline.md)
- Backup the data directory, monitor the health endpoint:
  [operations.md](operations.md)
- When something breaks: [troubleshooting.md](troubleshooting.md)
- Back to the overview: [docs/deploy/README.md](README.md)
