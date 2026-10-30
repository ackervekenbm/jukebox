# Bare Node (from a checkout)

Run the built server directly under Node, with systemd keeping it alive. Use
this when the host already runs Node and you'd rather not add Docker.

## What you need

- **Node 22 or newer** (`package.json` engines) and `git`.
- No C compiler, Python or `make`: dependency installs are script-free
  (`.npmrc` → `ignore-scripts`), and `better-sqlite3` uses its shipped prebuild.
- Optional: a reverse proxy for a hostname/TLS — see
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
DATA_DIR=/var/lib/jukebox \
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

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /opt/jukebox --shell /usr/sbin/nologin jukebox
sudo mkdir -p /var/lib/jukebox && sudo chown jukebox: /var/lib/jukebox
sudo systemctl daemon-reload
sudo systemctl enable --now jukebox
curl -fsS http://127.0.0.1:3000/api/health     # {"ok":true,"db":true}
```

The process handles `SIGTERM`/`SIGINT`: it stops accepting connections, closes
the database and exits (force-exit after 10s), so `systemctl restart` is clean.

## Updating

```bash
cd /opt/jukebox
git pull --ff-only
npm ci
npm run build
sudo systemctl restart jukebox
```

To keep only what the runtime needs after building:

```bash
npm prune --omit=dev     # removes tsc/eslint/vite/tsup
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

## Next

- Reverse proxy and TLS: [https-and-offline.md](https-and-offline.md)
- Backup the data directory, monitor the health endpoint:
  [operations.md](operations.md)
