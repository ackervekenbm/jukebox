# Bare Node (from a checkout)

Run the built server directly under Node, with systemd keeping it alive. Use
this when the host already runs Node and you'd rather not add Docker.

## What you need

- **Node 22 or newer** (`package.json` engines) and `git`.
- **A 64-bit OS** (`x64` or `arm64`; on a Pi, `uname -m` must say `aarch64`,
  not `armv7l`). `better-sqlite3` ships prebuilds for those only — there is no
  `armv7` binary, and because installs are script-free (`.npmrc` →
  `ignore-scripts`) there is no compile fallback. On 32-bit Raspberry Pi OS the
  build still succeeds, but `npm start` dies with
  `Cannot find module …/better-sqlite3/build/Release/better_sqlite3.node`.
- No C compiler, Python or `make`: nothing is compiled at install time, so a
  minimal host is enough.
- Optional: a reverse proxy for a hostname/TLS - see
  [https-and-offline.md](https-and-offline.md). For direct LAN access you can
  skip it, but then the process must listen on more than loopback (below).

## Build and run

```bash
git clone https://github.com/ackervekenbm/jukebox.git
cd jukebox
npm ci
npm run build          # tsc + eslint + vite build (dist/) + tsup (dist-server/)
```

Start it:

```bash
NODE_ENV=production \
HOST=127.0.0.1 \
PORT=3000 \
DATA_DIR="$PWD/data" \
npm start              # = node dist-server/index.js
```

- `npm start` serves the client **and** the API. There is no separate static
  server step: `dist/` is picked up from `CLIENT_DIST` (default `./dist`).
- The server logs `[jukebox] http://127.0.0.1:3000 (client + API)` on boot. If it
  logs `no client build found; serving API only`, run `npm run build` first (or
  point `CLIENT_DIST` at the right directory).
- **`HOST` defaults to `127.0.0.1`** — that is deliberate. Behind a reverse proxy
  on the same machine, leave it. To reach the app directly from other devices on
  the LAN, set `HOST=0.0.0.0`.
- `DATA_DIR` is created if missing and must be writable; it holds `jukebox.db`
  (plus `-wal`/`-shm` while running).
- If the data directory can't be opened (permissions, wrong ownership,
  read-only mount) the process **exits during start-up** instead of answering
  500 — `systemctl status` and the journal show the SQLite error. `/api/health`
  will never respond in that state.

The snippet above keeps the database in `./data`, owned by whoever ran it. The
systemd unit below moves it to `/var/lib/jukebox` instead, so that the service
user — not you — owns it.

## systemd unit

`/etc/systemd/system/jukebox.service`:

```ini
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
ExecStart=/usr/bin/node dist-server/index.js
Restart=on-failure
RestartSec=5

# Optional hardening: the app only reads /opt/jukebox and writes DATA_DIR.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/jukebox

[Install]
WantedBy=multi-user.target
```

`ExecStart` assumes Node is at `/usr/bin/node` (distro package or NodeSource). If
you installed it with `nvm`/`fnm` it lives under `$HOME`, which `ProtectHome=yes`
in the unit hides from the service: either install Node system-wide, or drop
`ProtectHome=yes` and point `ExecStart` at that interpreter's absolute path.

```bash
sudo useradd --system --home /opt/jukebox --shell /usr/sbin/nologin jukebox
sudo mkdir -p /opt/jukebox /var/lib/jukebox
sudo chown -R jukebox: /opt/jukebox /var/lib/jukebox

# Clone and build as the service user, so the tree it reads at runtime is the
# one it wrote (a root-owned checkout breaks `npm run build` and later updates).
# `-H` matters: without it sudo keeps HOME=/root and `npm ci` dies with
# EACCES on /root/.npm, because it caches into $HOME.
sudo -u jukebox -H git clone https://github.com/ackervekenbm/jukebox.git /opt/jukebox
sudo -u jukebox -H bash -c 'cd /opt/jukebox && npm ci && npm run build'

sudo systemctl daemon-reload
sudo systemctl enable --now jukebox
curl -fsS http://127.0.0.1:3000/api/health     # {"ok":true,"db":true}
```

`WorkingDirectory=/opt/jukebox` is where `CLIENT_DIST`'s default `./dist`
resolves from, and it is why the checkout has to live there. `DATA_DIR` is set
explicitly in the unit; if you install somewhere else, change both.

The process handles `SIGTERM`/`SIGINT`: it stops accepting connections, closes
the database and exits (force-exit after 10s), so `systemctl restart` is clean.

## Updating

```bash
sudo -u jukebox -H bash -c 'cd /opt/jukebox && git pull --ff-only && npm ci && npm run build'
sudo systemctl restart jukebox
```

Build as the service user (`jukebox`), not as root: a root-owned
`dist-server/` still runs, but the next update as `jukebox` fails on permissions.

To keep only what the runtime needs after building:

```bash
sudo -u jukebox -H bash -c 'cd /opt/jukebox && npm prune --omit=dev'
```

The build outputs (`dist/`, `dist-server/`) stay; only dev dependencies go. You
need `npm ci` again before the next `npm run build`.

## Shipping a tarball

There is no published package, but you can make your own artifact from a build.
On a matching platform:

```bash
npm ci && npm run build
tar -czf jukebox-$(git rev-parse --short HEAD).tar.gz \
  dist dist-server package.json package-lock.json .npmrc
```

On the target then:

```bash
tar -xzf jukebox-*.tar.gz -C /opt/jukebox
cd /opt/jukebox && npm ci --omit=dev
NODE_ENV=production HOST=127.0.0.1 DATA_DIR=/var/lib/jukebox npm start
```

`npm ci --omit=dev` still needs network access to a registry (or a warm npm
cache) for `express`, `better-sqlite3`, `zod` and friends; it needs **no
toolchain**, because installs are script-free and the sqlite binary ships inside
the package. `better-sqlite3` is native, so the tarball is per-platform (the
package ships prebuilds for linux/darwin/win32 on x64/arm64, and musl variants).
If `/opt/jukebox` belongs to the `jukebox` service user, do the extract and
`npm ci` as that user (`sudo -u jukebox -H …`) so the next build doesn't trip
over root-owned files.

## Next

- Reverse proxy and TLS: [https-and-offline.md](https-and-offline.md)
- Backup the data directory, monitor the health endpoint:
  [operations.md](operations.md)
