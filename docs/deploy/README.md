# Deploying Jukebox

Jukebox runs as **one Node process**. That process does three jobs:

1. serves the web app itself (the built files in `dist/`);
2. serves a small sync API (`/api/*`, backed by an SQLite database) so the record
   cabinet follows you between devices;
3. passes the browser's Discogs requests on to `api.discogs.com` (`/discogs/*`).
   The browser can't call Discogs directly: Discogs' "slow down" answers lack the
   headers a browser needs to read them, so the app would see an unexplained
   error instead of a request it can retry.

Everything else (collection, tracklists, cached years, listen log, saved views,
settings) lives in the browser. The server only stores the cabinet layout, per
Discogs account; that layout does include which releases sit on which shelf.

## Which route?

New here? Start with the **prebuilt image**.

| Route | Guide | Good for | Needs |
| --- | --- | --- | --- |
| **Prebuilt image** | [docker-image.md](docker-image.md) | Anything with Docker: no build step, easy updates and rollback, `amd64` and `arm64` | Docker, 64-bit OS |
| **Build from a checkout (Docker)** | [from-source-docker.md](from-source-docker.md) | A version you patch yourself, or a host that shouldn't pull an image | Docker, git, 64-bit OS |
| **Bare Node** | [from-source-node.md](from-source-node.md) | A box that already runs Node 22+, managed by systemd | Node 22+, git, 64-bit OS |
| **OpenMediaVault** | [openmediavault.md](openmediavault.md) | The OMV Compose plugin, all from the web UI (what the maintainer runs) | OMV with the Compose plugin, 64-bit OS |

Whichever route you pick:

- [https-and-offline.md](https-and-offline.md): HTTPS, reverse proxies, and
  what needs HTTPS (offline launch).
- [operations.md](operations.md): settings, health checks, backups, updates,
  rollback, logs.
- [troubleshooting.md](troubleshooting.md): symptoms and fixes.

> **There is no npm package.** `package.json` is `private: true` and CI only
> publishes the container image, so you deploy either the image or a git
> checkout. To build on one machine and run on another without Docker, see
> [shipping a tarball](from-source-node.md#shipping-a-tarball).

## Keep it on your LAN or tailnet

**Jukebox has no login.** Run it on your home network or your tailnet only: no
port forwarding, no Tailscale Funnel, no VPS without a firewall in front. If it
is reachable from the internet:

- anyone can use its `/discogs` proxy, and Discogs sees those requests coming
  from your IP and your User-Agent;
- any Discogs account holder can store a cabinet document (up to 256 KB) on
  your server;
- nothing is rate-limited.

Docker publishes `-p 8080:3000` on **every** network interface, and its firewall
rules bypass ufw and firewalld. When a reverse proxy on the same host is the only
thing that should reach the app, publish it on loopback only:
`-p 127.0.0.1:8080:3000` (in compose, `"127.0.0.1:8080:3000"`). Bare Node already
listens on `127.0.0.1` by default; `HOST=0.0.0.0` opens it to every interface.

## The contract every route shares

| Item | Value |
| --- | --- |
| Port | The app listens on `3000`. In Docker that is fixed, and you choose the host side (the examples use `8080`) |
| Listen address | `HOST`: `127.0.0.1` for bare Node, `0.0.0.0` in the image |
| Data | `DATA_DIR` (default `./data`, `/app/data` in the image) holds `jukebox.db`. The only server-side state |
| Web app files | `CLIENT_DIST` (default `./dist`) |
| Health | `GET /api/health` → `200 {"ok":true,"db":true}` ([what it checks](operations.md#health-and-monitoring)) |
| Sync | `GET`/`PUT /api/sync/cabinet`, authenticated with the user's own Discogs token |
| Discogs proxy | `GET`/`HEAD /discogs/*`, passes Discogs' rate-limit headers through |
| Prerequisites | Node **22+** (the image ships it) on a **64-bit** `x64`/`arm64` OS; nothing is compiled during install |

All settings are environment variables; the full list is in
[operations.md](operations.md#environment-variables).

**64-bit only.** The image is published for `amd64` and `arm64` only, and the
SQLite library (`better-sqlite3`) ships no 32-bit ARM build. Installs never
compile anything, so there is no fallback either. Check the OS, not the CPU:
`dpkg --print-architecture` must print `arm64` or `amd64` (and for bare Node,
`node -p process.arch` must print `arm64` or `x64`). `uname -m` alone isn't
enough: some 32-bit images boot a 64-bit kernel, so it says `aarch64` while
Docker and Node are 32-bit. On a 32-bit OS, Docker refuses the image with
`no matching manifest for linux/arm/v7` (or `exec format error` if you force
an `-arm64` tag), and a source checkout builds but stops at start-up with
`Cannot find module …/better_sqlite3.node`. Reinstall with the 64-bit
(`arm64`) image of your OS if the CPU supports it (any ARMv8 CPU does); a
board whose CPU is 32-bit only (`armv6l`, or `armv7l` on ARMv7 hardware) can't
run Jukebox.

## Common mistakes

Three mistakes are easy to make, and all of them look like app bugs:

- **Serving `dist/` from a plain web server.** Without the app's own `/discogs`
  proxy, loading the collection fails with CORS or 429 errors. Put a reverse
  proxy in front of the app, as the examples do; don't replace it.
- **Serving it under a subpath.** The app assumes it lives at `/`, so
  `https://host/jukebox/` loads the page but every `/assets/*` request fails. Use
  a hostname or a port.
- **Losing the data directory.** It is the only server-side state. Deleting the
  volume or folder drops the cabinet layout (the collection itself is in the
  browsers, so that survives). Each route keeps it somewhere else:
  [find yours](operations.md#find-your-data-first).

## Versions and tags

Images are built from `main` and published to `ghcr.io/ackervekenbm/jukebox`;
[docker-image.md](docker-image.md#tags) has the tags and how to pin or roll back.
A checkout's version is its commit (`git log -1`). Every build also shows its
commit and date in the app's Settings
([which build is running](operations.md#which-build-is-running)).
