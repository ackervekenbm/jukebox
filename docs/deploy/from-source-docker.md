# Docker, built from a checkout

Build the image yourself from a git clone. Same image as the published one
([docker-image.md](docker-image.md)), but you own the source and the build.

## What you need

- Docker Engine (or Docker Desktop) with the Compose v2 plugin.
- `git`.
- A 64-bit host ([prerequisites](README.md#the-contract-every-route-shares)).
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

**Building for a Raspberry Pi from an amd64 machine** — build on the Pi natively
if you can; it is much faster and needs no emulation. To cross-build:

1. On Docker Engine (Linux), register QEMU for arm64. The registration doesn't
   survive a reboot, so repeat it after one. Docker Desktop already includes
   it, so skip this step there.

   ```bash
   docker run --privileged --rm tonistiigi/binfmt --install arm64
   ```

   Without it the build fails inside `RUN npm ci` with `exec format error`.

2. Build under the tag the compose file uses, `jukebox:latest`:

   ```bash
   docker buildx build --platform linux/arm64 -t jukebox:latest --load .
   ```

3. Copy the image to the Pi (or push it to a registry, below):

   ```bash
   docker save jukebox:latest | gzip | ssh pi 'gunzip | sudo docker load'
   ```

4. On the Pi, start it **without** `--build`, so compose uses the loaded image
   instead of building natively:

   ```bash
   docker compose up -d      # in a checkout of the same commit, for the compose file
   ```

The Pi needs a 64-bit OS
([prerequisites](README.md#the-contract-every-route-shares)).

**A real version line** — Settings shows the commit and its date from the
`COMMIT_SHA`/`BUILD_TIME` build args; `docker compose up -d --build` passes
neither, so a local build reads `development build`. Stamp it with the commit and
the commit date (what CI passes) and recreate:

```bash
docker compose build \
  --build-arg COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg BUILD_TIME=$(git log -1 --format=%cI)
docker compose up -d
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

The named volume (`jukebox-data`, usually prefixed with the project directory)
survives recreation, so the cabinet sync data is intact — see
[troubleshooting.md](troubleshooting.md#the-volume-moved) if a rebuild comes up
with an empty cabinet. Docker's layer cache means an unchanged tree rebuilds in
seconds; `--build` alone does not pull newer base images — add
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
- When something breaks: [troubleshooting.md](troubleshooting.md)
- Back to the overview: [docs/deploy/README.md](README.md)
