# Deploying Jukebox

Jukebox runs as **one Node process**. That process does three jobs:

1. serves the built client (`dist/`) with SPA fallback,
2. serves the sync API (`/api/*`, backed by a small SQLite database),
3. proxies Discogs (`/discogs/*` → `api.discogs.com`) so the browser only ever
   talks same-origin — Discogs' rate-limit responses carry no CORS headers and
   would otherwise surface as opaque errors instead of retryable 429s.

Everything else — collection, tracklists, cached years, listen log, saved views,
settings — lives in the browser. The server only stores the record-cabinet
layout so it can follow you between devices.

## Which route?

| Route | Guide | Good for | Needs |
| --- | --- | --- | --- |
| **Prebuilt image** | [docker-image.md](docker-image.md) | Anything with Docker. Public image, multi-arch (`amd64` + `arm64`), no build step, easy updates and rollback | Docker |
| **Build from a checkout (Docker)** | [from-source-docker.md](from-source-docker.md) | A variant you patch yourself, or a host that shouldn't pull an image | Docker, git |
| **Bare Node** | [from-source-node.md](from-source-node.md) | A box that already runs Node 22 (systemd + optional reverse proxy) | Node 22+, git, 64-bit OS |
| **OpenMediaVault** | [openmediavault.md](openmediavault.md) | The OMV Compose plugin (this is what the maintainer runs) | OMV + Docker/Compose plugins |

Cross-cutting, whichever route you pick:

- [https-and-offline.md](https-and-offline.md) — TLS, reverse proxies, and what
  actually breaks without HTTPS (offline launch).
- [operations.md](operations.md) — environment variables, health checks,
  backups, updates, rollback, logs.
- [troubleshooting.md](troubleshooting.md) — the failure modes we've actually hit.

> **There is no npm package.** `package.json` is `private: true` and CI
> publishes only the container image, so the supported artifacts are the image
> and a git checkout. If you need an offline tarball, see
> [from-source-node.md § shipping a tarball](from-source-node.md#shipping-a-tarball).

## The contract every route shares

| Item | Value |
| --- | --- |
| Container port | `3000` (host side is yours — examples use `8080`); fixed in the image |
| Listens on | `HOST` — `127.0.0.1` for bare Node, `0.0.0.0` in the image; `PORT` `3000` |
| Persistent data | `DATA_DIR` (default `./data`, image uses `/app/data`) — holds `jukebox.db` |
| Client build | `CLIENT_DIST` (default `./dist`) |
| Health | `GET /api/health` → `200 {"ok":true,"db":true}`, `500 {"ok":false,"db":false}` — a liveness read on the open DB handle, not a write test; an unusable data dir stops the process at start-up instead |
| Sync API | `GET`/`PUT /api/sync/cabinet` — Discogs token required; a `PUT` needs a valid document and a matching `If-Match` (`400` invalid document or malformed header, `428` missing `If-Match`, `409` conflict, `413` body over 256 KB) |
| Discogs proxy | `GET`/`HEAD /discogs/*` (`405` otherwise); forwards `retry-after` and `x-discogs-*` |
| Prerequisites | Node **22+** (image ships it) on **64-bit** `x64`/`arm64` — no `armv7` prebuild; no C toolchain, installs are script-free (`.npmrc`) |

Three mistakes are worth stating up front because all are easy and all look like
app bugs:

- **Don't serve `dist/` from a plain static server.** Without the same-origin
  `/discogs` proxy, collection fetches fail with CORS/429 noise. Put any reverse
  proxy in front of the Node process (which is what the examples do), don't
  replace it.
- **Don't mount it under a subpath.** The build targets the domain root
  (`base: '/'`, manifest and service-worker scope `/`), so `https://host/jukebox/`
  serves the shell but its `/assets/*` requests 404. Use a hostname or a port.
- **Keep the data directory.** It is the only server-side state. Deleting the
  volume/dir silently drops the cabinet layout (the collection itself is in the
  browsers, so it survives).

## Versions and tags

Images are built from `main` and published to
`ghcr.io/ackervekenbm/jukebox`; see [docker-image.md](docker-image.md#tags) for
the full tag list and how to pin or roll back. Source checkouts are versioned by
commit — `git log -1` is the version you're running, and the app's Settings screen
shows the commit and its date
([operations.md](operations.md#which-build-is-running)).
