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
| **Prebuilt image** | [docker-image.md](docker-image.md) | Anything with Docker. Multi-arch (`amd64` + `arm64`), no build step, easy updates and rollback | Docker, a GHCR pull |
| **Build from a checkout (Docker)** | [from-source-docker.md](from-source-docker.md) | A variant you patch yourself, or a host that shouldn't pull an image | Docker, git |
| **Bare Node** | [from-source-node.md](from-source-node.md) | A box that already runs Node 22 (systemd + optional reverse proxy) | Node 22+, git |
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
| Container port | `3000` (host side is yours — examples use `8080`) |
| Listens on | `HOST` (default `127.0.0.1`) `PORT` (default `3000`) |
| Persistent data | `DATA_DIR` (default `./data`, image uses `/app/data`) — holds `jukebox.db` |
| Client build | `CLIENT_DIST` (default `./dist`) |
| Health | `GET /api/health` → `200 {"ok":true,"db":true}`, `500 {"ok":false,"db":false}` |
| Sync API | `GET`/`PUT /api/sync/cabinet` (requires a Discogs token, `If-Match` on PUT) |
| Prerequisites | Node **22+** (image ships it); no C toolchain — dependency installs are script-free (`.npmrc`) |

Two mistakes are worth stating up front because both are easy and both look like
app bugs:

- **Don't serve `dist/` from a plain static server.** Without the same-origin
  `/discogs` proxy, collection fetches fail with CORS/429 noise. Put any reverse
  proxy in front of the Node process (which is what the examples do), don't
  replace it.
- **Keep the data directory.** It is the only server-side state. Deleting the
  volume/dir silently drops the cabinet layout (the collection itself is in the
  browsers, so it survives).

## Versions and tags

Images are built from `main` and published to
`ghcr.io/ackervekenbm/jukebox`; see [docker-image.md](docker-image.md#tags) for
the full tag list and how to pin or roll back. Source checkouts are versioned by
commit — `git log -1` is the version you're running.
