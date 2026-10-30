# Docker image (prebuilt)

Pull the published multi-arch image — no source, no build. This is the shortest
path and the one to prefer for a home server.

```
ghcr.io/ackervekenbm/jukebox
```

## Tags

| Tag | What it is |
| --- | --- |
| `:latest` | Multi-arch index (linux/amd64 + linux/arm64), tracks `main` |
| `:<sha7>` | Multi-arch index for one commit, e.g. `:351e79b` |
| `:latest-amd64`, `:latest-arm64` | Single-architecture images |
| `:<full-sha>-amd64`, `:<full-sha>-arm64` | Single-architecture, per commit |

`:latest` resolves to the right architecture per host, so the same compose file
works on an x86 box and on a Raspberry Pi. Images are only rebuilt when app paths
change on `main` (`src/**`, `Dockerfile`, `package.json`, …) — a docs-only merge
leaves the current `:latest` in place.

## Pull: log in once

GHCR requires authentication even for public images. Use a GitHub **classic**
personal access token with `read:packages`:

```bash
echo "$GHCR_TOKEN" | sudo docker login ghcr.io -u <your-github-username> --password-stdin
```

Fine-grained tokens don't work with GitHub Packages. Keep the token's expiry ≤ 1
year and redo the login when it lapses (symptom: `denied`/`unauthorized` on
`docker pull`).

## Run it

```bash
docker run -d --name jukebox \
  -p 8080:3000 \
  -v jukebox-data:/app/data \
  --restart unless-stopped \
  ghcr.io/ackervekenbm/jukebox:latest
```

→ <http://localhost:8080>. The image has a built-in `HEALTHCHECK` that polls
`/api/health`, so `docker ps` shows `healthy` once the DB is writable.

Or as a compose file:

```yaml
services:
  jukebox:
    image: ghcr.io/ackervekenbm/jukebox:latest
    container_name: jukebox
    ports:
      - "8080:3000"
    environment:
      DATA_DIR: /app/data
    volumes:
      - jukebox-data:/app/data
    restart: unless-stopped

volumes:
  jukebox-data:
```

```bash
docker compose up -d
docker compose logs -f jukebox
```

## Pin a version, roll back

`:latest` is convenient but not reproducible. Pin the commit you verified:

```yaml
    image: ghcr.io/ackervekenbm/jukebox:351e79b    # short SHA of a main commit
```

Rolling back is the same edit with an older SHA, then `docker compose up -d`
(the data volume is untouched, so the cabinet layout survives either way). For a
byte-for-byte pin, use the digest shown by:

```bash
docker image inspect ghcr.io/ackervekenbm/jukebox:latest \
  --format '{{index .RepoDigests 0}}'
# ghcr.io/ackervekenbm/jukebox@sha256:…
```

## Update

```bash
docker compose pull && docker compose up -d     # or: docker pull <image> + recreate
```

Only the container is replaced; `jukebox-data` (the SQLite database) stays. Then
refresh the browser tab — `index.html` and `sw.js` are served `no-cache`, so a
normal reload picks up the new build; force-refresh once if a stale service
worker is still holding the old shell.

## Behind a proxy / with HTTPS

The image serves plain HTTP on `3000`; TLS is a reverse proxy's job. See
[https-and-offline.md](https-and-offline.md) for Caddy/nginx examples and the
three self-hosting certificate options.

## Next

- [operations.md](operations.md) — env vars, backups, health monitoring
- [troubleshooting.md](troubleshooting.md) — arch mismatch, `db:false`, GHCR auth
- [openmediavault.md](openmediavault.md) — the same image, via the OMV plugin
