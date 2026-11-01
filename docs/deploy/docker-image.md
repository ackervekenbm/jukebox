# Docker image (prebuilt)

Pull the published multi-arch image — no source, no build. This is the shortest
path and the one to prefer for a home server.

```
ghcr.io/ackervekenbm/jukebox
```

## Tags

| Tag | What it is |
| --- | --- |
| `:latest` | Multi-arch index (linux/amd64 + linux/arm64), built from `main` |
| `:<sha7>` | Multi-arch index for one commit, e.g. `:351e79b` |
| `:latest-amd64`, `:latest-arm64` | Single-architecture images |
| `:<full-sha>-amd64`, `:<full-sha>-arm64` | Single-architecture, per commit |

`:latest` resolves to the right architecture per host, so the same compose file
works on an x86 box and on a Raspberry Pi. Only `amd64` and `arm64` are built: a
Pi needs a 64-bit OS (32-bit Raspberry Pi OS fails with `exec format error`).
Images are only rebuilt when app paths change on `main` (`src/**`, `Dockerfile`,
`package.json`, …) — a docs-only merge leaves the current `:latest` in place.

## Pull

The image is **public**, so `docker pull` and `docker compose pull` work without
a login — no `docker login` step.

If a pull is refused with `denied`/`unauthorized` (stale credentials on the host,
a private fork, or a package that was switched back to private), log in with a
GitHub **classic** personal access token that has `read:packages` — fine-grained
tokens don't work with GitHub Packages:

```bash
echo "$GHCR_TOKEN" | sudo docker login ghcr.io -u <your-github-username> --password-stdin
```

Keep that token's expiry ≤ 1 year and redo the login when it lapses;
`sudo docker logout ghcr.io` returns you to anonymous pulls.

## Run it

```bash
docker run -d --name jukebox \
  -p 8080:3000 \
  -v jukebox-data:/app/data \
  --restart unless-stopped \
  ghcr.io/ackervekenbm/jukebox:latest
```

→ <http://localhost:8080>. The image has a built-in `HEALTHCHECK` that polls
`/api/health`, so `docker ps` shows `healthy` once the process answers and its
database handle is alive. It is a liveness check, not a write test: an
unwritable `/app/data` makes the container **exit during start-up** instead
(see [troubleshooting.md](troubleshooting.md#the-container-restarts-in-a-loop)).

Port `3000` is fixed inside the image — the healthcheck probes it. To serve on
port `80`, change the **host** side of the mapping (`80:3000`), not `PORT`.

Or as a compose file:

```yaml
services:
  jukebox:
    image: ghcr.io/ackervekenbm/jukebox:latest
    container_name: jukebox
    ports:
      - "8080:3000"
    volumes:
      - jukebox-data:/app/data
    restart: unless-stopped

volumes:
  jukebox-data:
    name: jukebox-data    # same volume as the docker run command above
```

`name:` stops compose from prefixing the volume with the project directory, so
this file and the `docker run` command use the same `jukebox-data` volume. To
switch from `docker run` to compose, remove the old container first
(`docker rm -f jukebox`); the data stays in the volume. Without `name:`, compose
would create `<dir>_jukebox-data` and start empty.

```bash
docker compose up -d
docker compose logs -f jukebox
```

## Pin a version, roll back

`:latest` is convenient but not reproducible. Pin the commit you verified:

```yaml
    image: ghcr.io/ackervekenbm/jukebox:351e79b    # a commit that has an image tag
```

Not every `main` commit has a tag. Docs-only merges build no image, so pick a SHA
that is listed on the
[package page](https://github.com/ackervekenbm/jukebox/pkgs/container/jukebox).

Rolling back is the same edit with an older SHA, then `docker compose up -d`
(the data volume is untouched, so the cabinet layout survives either way). For a
byte-for-byte pin, use the digest of an image you **pulled**:

```bash
docker image inspect ghcr.io/ackervekenbm/jukebox:latest \
  --format '{{index .RepoDigests 0}}'
# ghcr.io/ackervekenbm/jukebox@sha256:…
```

## Update

With compose:

```bash
docker compose pull && docker compose up -d
```

With `docker run`, pull and recreate with the same flags:

```bash
docker pull ghcr.io/ackervekenbm/jukebox:latest
docker rm -f jukebox
docker run -d --name jukebox -p 8080:3000 -v jukebox-data:/app/data \
  --restart unless-stopped ghcr.io/ackervekenbm/jukebox:latest
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

- [operations.md](operations.md) — env vars, backups, health monitoring, log rotation
- [troubleshooting.md](troubleshooting.md) — arch mismatch, `db:false`, `denied` pulls
- [openmediavault.md](openmediavault.md) — the same image, via the OMV plugin
