# Docker, built from a checkout

Build the image yourself from a git clone. Same image as the published one
([docker-image.md](docker-image.md)), but you own the source and the build.

## What you need

- Docker Engine (or Docker Desktop) with the Compose v2 plugin.
- `git`.
- No Node, no toolchain on the host: the build happens inside the image.

## Run it

```bash
git clone https://github.com/ackervekenbm/jukebox.git
cd jukebox
docker compose up -d --build
```

That uses the repository's [`docker-compose.yml`](../../docker-compose.yml):

```yaml
services:
  jukebox:
    build: .
    image: jukebox:latest
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

→ <http://localhost:8080>. Check it:

```bash
docker compose ps          # STATUS should become "healthy" (HEALTHCHECK is baked in)
curl -fsS http://localhost:8080/api/health   # {"ok":true,"db":true}
docker compose logs -f jukebox
```

## Variations

**Different host port** (e.g. `80` or `9000`) — edit the mapping, left side is
the host:

```yaml
    ports:
      - "9000:3000"
```

**Background vs foreground** — `docker compose up -d --build` vs
`docker compose up --build`; the latter streams logs and stops with Ctrl+C.

**Different data location** — bind-mount instead of the named volume:

```yaml
    volumes:
      - /srv/jukebox-data:/app/data
```

The directory must be writable by the container (the image runs as root by
default, so this usually just works; a `userns-remap` setup needs adjusting).

**Building for a Raspberry Pi from an amd64 machine** — the Pi can build
natively, which is faster; cross-build only if you must:

```bash
docker buildx build --platform linux/arm64 -t jukebox:arm64 --load .
```

**Your own registry** — tag and push after the build:

```bash
docker compose build
docker tag jukebox:latest registry.example.com/jukebox:latest
docker push registry.example.com/jukebox:latest
```

## Updating

```bash
cd /path/to/jukebox
git pull --ff-only
docker compose up -d --build     # rebuilds, recreates the container, keeps the volume
```

The named volume (`jukebox-data`) survives recreation, so the cabinet sync data
is intact. Docker's layer cache means an unchanged tree rebuilds in seconds;
`--build` alone does not pull newer base images — add
`docker compose build --pull` if you want a fresh `node:22-alpine`.

## Prebuilt vs built here

- Same `Dockerfile`, same runtime. Building yourself is for when you want to
  patch something or can't pull from GHCR.
- The published image is multi-arch and tagged per commit — see
  [docker-image.md](docker-image.md) if you'd rather track `:latest` and pin a
  SHA for rollback.

## Next

- TLS / offline launch: [https-and-offline.md](https-and-offline.md)
- Backups, updates, monitoring: [operations.md](operations.md)
