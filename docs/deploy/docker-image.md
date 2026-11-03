# Docker image (prebuilt)

Part of the [deployment guides](README.md).

Pull the published image: no source, no build. This is the shortest path and the
one to prefer for a home server.

```
ghcr.io/ackervekenbm/jukebox
```

## What you need

- Docker Engine or Docker Desktop
  ([install](https://docs.docker.com/engine/install/)). The Compose v2 plugin
  (`docker compose`) is only needed for the compose variant.
- The commands here run `docker` as your own user, which needs membership in the
  `docker` group (`sudo usermod -aG docker $USER`, then log in again; that group
  is equivalent to root on this machine). Otherwise put `sudo` in front of each
  `docker` command.
- A 64-bit `amd64` or `arm64` host. On an ARM board that means a 64-bit OS
  ([why](README.md#the-contract-every-route-shares)).
- No source, Node or login: the image is public.

## Tags

| Tag | What it is |
| --- | --- |
| `:latest` | The newest build of `main`, for both `amd64` and `arm64` |
| `:<sha7>` | The build of one commit, both architectures, e.g. `:351e79b` |
| `:latest-amd64`, `:latest-arm64` | The newest build, one architecture only |
| `:<full-sha>-amd64`, `:<full-sha>-arm64` | One commit, one architecture |

`:latest` and `:<sha7>` are multi-arch: Docker picks the right architecture for
the host, so the same compose file works on an x86 box and on an ARM board.
Images are only built from `main`, and only when app paths change (`src/**`,
`Dockerfile`, `package.json`, …): a docs-only merge leaves `:latest` as it was
and gets no tag of its own.

## Run it

```bash
docker run -d --name jukebox \
  -p 8080:3000 \
  -v jukebox-data:/app/data \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  --restart unless-stopped \
  ghcr.io/ackervekenbm/jukebox:latest
```

Open <http://localhost:8080>, or `http://<server-ip>:8080` from another device.

- `docker ps` shows `healthy` once the built-in `HEALTHCHECK` passes
  ([what it checks](operations.md#health-and-monitoring)). An unwritable
  `/app/data` makes the container exit at start-up instead
  ([troubleshooting](troubleshooting.md#the-container-restarts-in-a-loop)).
- Port `3000` is fixed inside the image, because the healthcheck probes it. To
  serve on another port, change the **host** side of the mapping (`80:3000`),
  not `PORT`.
- `-p 8080:3000` listens on every network interface. With a reverse proxy or
  Tailscale on the same host, use `-p 127.0.0.1:8080:3000` so only they can reach
  it ([why](README.md#keep-it-on-your-lan-or-tailnet)). A port mapping can't be
  changed on a running container: `docker rm -f jukebox`, then run the command
  again with the new `-p` (the data volume stays).
- The `--log-*` flags cap the container log at 30 MB. Without them it grows until
  the disk is full, and a full disk is how SQLite starts failing.

## Or with compose

Make an empty folder, e.g. `~/jukebox`, and save this in it as `compose.yaml`:

```yaml
services:
  jukebox:
    image: ghcr.io/ackervekenbm/jukebox:latest
    container_name: jukebox
    ports:
      - "8080:3000"          # "127.0.0.1:8080:3000" behind a reverse proxy on this host
    volumes:
      - jukebox-data:/app/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    restart: unless-stopped

volumes:
  jukebox-data:
    name: jukebox-data       # the same volume as the docker run command above
```

Then, in that folder:

```bash
docker compose up -d
docker compose logs -f jukebox
```

`name:` stops compose from prefixing the volume with the folder name, so this
file and the `docker run` command share the `jukebox-data` volume. Without it,
compose would create `jukebox_jukebox-data` and start with an empty cabinet.

**Switching from `docker run` to compose:** remove the old container first
(`docker rm -f jukebox`); the data stays in the volume. Compose then warns
`volume "jukebox-data" already exists but was not created by Docker Compose`.
That is expected: it is the volume `docker run` made, and compose uses it as is.

## Update

Take a [backup](operations.md#backups) first if the cabinet matters to you.

With compose, in the folder with `compose.yaml`:

```bash
docker compose pull && docker compose up -d
```

With `docker run`, pull and recreate with the same flags:

```bash
docker pull ghcr.io/ackervekenbm/jukebox:latest
docker rm -f jukebox
docker run -d --name jukebox -p 8080:3000 -v jukebox-data:/app/data \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  --restart unless-stopped ghcr.io/ackervekenbm/jukebox:latest
```

Only the container is replaced; the `jukebox-data` volume (the SQLite database)
stays. Devices pick up the new build on their own
([details](operations.md#devices-after-an-update)).

## Pin a version, roll back

`:latest` is convenient but not reproducible. Pin a commit tag instead:

```yaml
    image: ghcr.io/ackervekenbm/jukebox:351e79b
```

Only commits that changed the app have a tag, so pick one from the
[package page](https://github.com/ackervekenbm/jukebox/pkgs/container/jukebox).

Rolling back is the same edit with an older tag, then `docker compose up -d`.
With `docker run`, run the update commands above with the older tag in place of
`:latest`. The data volume is untouched either way.

For a byte-for-byte pin, use the digest of an image you **pulled**:

```bash
docker image inspect ghcr.io/ackervekenbm/jukebox:latest \
  --format '{{index .RepoDigests 0}}'
# ghcr.io/ackervekenbm/jukebox@sha256:…
```

## If a pull is denied

The image is public, so pulls normally need no login. A `denied` or
`unauthorized` error usually means stale GitHub credentials are stored for the
user that runs `docker`. Credentials are per user, so clear both your own and
root's (OMV and other `sudo docker` setups use root's):

```bash
docker logout ghcr.io
sudo docker logout ghcr.io
```

Try the pull again. If you really need a login (a private fork, or the package
was made private), use a GitHub **classic** personal access token with only the
`read:packages` scope (<https://github.com/settings/tokens> → *Tokens
(classic)*; fine-grained tokens don't work with GitHub Packages). Give it a short
expiry, e.g. 30 days. Run the login, the pull and the logout as the **same**
user: as yourself, or all with `sudo` (as on OMV). The token is typed in, not put
on the command line, so it stays out of your shell history (bash):

```bash
read -rsp 'GitHub token: ' GHCR_TOKEN; echo
GH_USER=your-github-username
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GH_USER" --password-stdin
unset GHCR_TOKEN
docker pull ghcr.io/ackervekenbm/jukebox:latest    # or: docker compose pull
docker logout ghcr.io
```

`docker login` stores the token in that user's `~/.docker/config.json`,
base64-encoded but not encrypted, which is why logging out again after the pull
is worth it.

## Behind a proxy / with HTTPS

The image serves plain HTTP on `3000`; HTTPS is a reverse proxy's job. See
[https-and-offline.md](https-and-offline.md) for Caddy/nginx examples and the
three self-hosting certificate options.

## Next

- [operations.md](operations.md) — backups, health monitoring, env vars, logs
- [troubleshooting.md](troubleshooting.md) — when something doesn't work
- [openmediavault.md](openmediavault.md) — the same image, via the OMV plugin
- Back to the overview: [docs/deploy/README.md](README.md)
