# Docker, built from a checkout

Part of the [deployment guides](README.md).

Build the image yourself from a git clone. It is the same image as the published
one ([docker-image.md](docker-image.md)), but you own the source and the build.

## What you need

- Docker Engine (or Docker Desktop) with the Compose v2 plugin (`docker compose`).
- `git`.
- A 64-bit host ([why](README.md#the-contract-every-route-shares)).
- No Node and no compiler on the host: the build happens inside the image.

## Run it

```bash
git clone https://github.com/ackervekenbm/jukebox.git
cd jukebox
docker compose up -d --build
```

That uses the repository's [`docker-compose.yml`](../../docker-compose.yml). It
builds the image from the checkout and tags it `jukebox:latest`, names the
container `jukebox`, publishes `8080:3000`, keeps the data in the named volume
`jukebox-data` (mounted at `/app/data`), caps the container log and restarts the
container unless you stop it. Edit that file for the variations below.

Open <http://localhost:8080>, then check it:

```bash
docker compose ps          # STATUS becomes "healthy" once the built-in healthcheck passes
curl -fsS http://localhost:8080/api/health   # {"ok":true,"db":true}
docker compose logs -f jukebox
```

The data is in the volume `<folder>_jukebox-data`, e.g. `jukebox_jukebox-data`
for a checkout in `jukebox/`. Compose prefixes the volume with the folder name,
so running the same file from another folder starts with an empty cabinet
([more](troubleshooting.md#the-cabinet-looks-empty)).

## Variations

**Different host port** (e.g. `80` or `9000`): edit the left side of the mapping.
Behind a reverse proxy on the same host, bind it to loopback so only the proxy
can reach it ([why](README.md#keep-it-on-your-lan-or-tailnet)):

```yaml
    ports:
      - "127.0.0.1:8080:3000"
```

**Foreground**: `docker compose up --build` (without `-d`) streams the logs and
stops with Ctrl+C.

**Different data location**: bind-mount a host folder instead of the named
volume:

```yaml
    volumes:
      - /srv/jukebox-data:/app/data
```

The app runs as the image's `node` user (uid 1000); the container hands the
folder to that user when it starts. On network storage that blocks root (NFS
with `root_squash`), give it to uid 1000 yourself: `sudo chown -R 1000:1000
/srv/jukebox-data`.

**A real version line**: Settings shows the commit and date of the build, taken
from the `COMMIT_SHA` and `BUILD_TIME` build arguments. `docker compose up -d
--build` passes neither, so a local build reads `development build`. Pass them
the way CI does, then recreate:

```bash
docker compose build \
  --build-arg COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg BUILD_TIME=$(git log -1 --format=%cI)
docker compose up -d
```

**Your own registry**: tag and push after the build:

```bash
docker compose build
docker tag jukebox:latest registry.example.com/jukebox:latest
docker push registry.example.com/jukebox:latest
```

## Building for an arm64 host on another machine

Build on the host itself if you can: a small ARM board is slower than a
desktop, but needs no emulation. To build on an amd64 machine instead:

1. **Docker Engine on Linux only:** teach the kernel to run arm64 programs
   through QEMU emulation. Docker Desktop already can, so skip this step there.
   Either install your distribution's packages, which also survive a reboot
   (Debian 13 and newer: `sudo apt install qemu-user-binfmt`; older Debian and
   Ubuntu: `sudo apt install qemu-user-static binfmt-support`), or run Docker's
   helper image:

   ```bash
   docker run --privileged --rm tonistiigi/binfmt:qemu-v10.2.3 --install arm64
   ```

   The helper runs as a **privileged** container, which means root on your host,
   so it is pinned to a release tag here. Its registration is lost on reboot;
   run it again after one. Without either, the build fails inside `RUN npm ci`
   with `exec format error`.

2. **Build** under the tag the compose file uses, `jukebox:latest`:

   ```bash
   docker buildx build --platform linux/arm64 -t jukebox:latest --load .
   ```

3. **Copy the image to the host** (or push it to a registry, above). This
   pipes it over SSH. In the commands below, replace `user` with your login on
   the host and `192.168.1.10` with the host's address. That user needs to run
   `docker` without a password prompt (membership in the `docker` group, or
   passwordless `sudo`):

   ```bash
   docker save jukebox:latest | gzip | ssh user@192.168.1.10 'gunzip | docker load'
   ```

   If that user needs a password for `sudo docker`, copy the file first:

   ```bash
   docker save jukebox:latest | gzip > jukebox.tar.gz
   scp jukebox.tar.gz user@192.168.1.10:
   ssh -t user@192.168.1.10 'gunzip -c jukebox.tar.gz | sudo docker load'
   ```

4. **Start it on the host without `--build`**, from a checkout of the same commit
   (for the compose file), so compose uses the loaded image instead of building
   again:

   ```bash
   docker compose up -d       # add sudo if your user isn't in the docker group
   ```

## Updating

Take a [backup](operations.md#backups) first if the cabinet matters to you. Then
in the checkout:

```bash
git switch main && git pull --ff-only
docker compose up -d --build     # rebuilds, recreates the container, keeps the volume
```

The volume survives the rebuild, so the cabinet stays. Docker's build cache
makes an unchanged tree rebuild in seconds. `--build` doesn't fetch a newer base
image; run `docker compose build --pull` first if you want a fresh
`node:22-alpine`. Devices pick up the new build on their own
([details](operations.md#devices-after-an-update)).

**Rolling back:** `git checkout` an older commit and run
`docker compose up -d --build` again. The `git switch main` above returns you to
the newest version on the next update.

## Prebuilt vs built here

- Same `Dockerfile`, same runtime. Building yourself is for when you want to
  patch something or can't pull from GHCR.
- The published image is built for both architectures and tagged per commit;
  see [docker-image.md](docker-image.md) if you'd rather pull it and pin a tag.

## Next

- HTTPS and offline launch: [https-and-offline.md](https-and-offline.md)
- Backups, monitoring: [operations.md](operations.md)
- When something breaks: [troubleshooting.md](troubleshooting.md)
- Back to the overview: [docs/deploy/README.md](README.md)
