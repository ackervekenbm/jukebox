# OpenMediaVault (Compose plugin)

The reference deployment: a Raspberry Pi running OpenMediaVault with the Docker
and Compose plugins, serving the app on host port **8080**. Everything happens in
the OMV web UI after a one-time registry login over SSH.

## Why port 8080

OMV's own web UI owns **80** and **443**. The container listens on `3000`, so map
it to something free — the examples use `8080`. These are host-side choices; the
container always listens on `3000`.

## Prerequisites

- **omv-extras** installed (it provides the Docker + Compose plugin packages).
- Docker and Compose plugins enabled: **Services → Compose** shows a *Files* and
  *Services* tab once they are.

## One-time: log in to GHCR over SSH

GHCR needs a login even for public images. On the OMV host:

```bash
sudo docker login ghcr.io -u <your-github-username>
```

Password: a GitHub **classic** personal access token with `read:packages`
(<https://github.com/settings/tokens> → *Tokens (classic)*). Fine-grained tokens
don't work with GitHub Packages. Give it an expiry ≤ 1 year; when it lapses the
web UI's **Pull** fails with an auth error and this login has to be redone.

## Create the stack (web UI)

1. **Services → Compose → Files → Add**.
2. Name it `jukebox.yml`.
3. Paste:

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

4. **Save**.
5. Select the file → **Up**. This pulls the image and starts the container.
6. Open `http://<pi-ip>:8080`.

Verify: **Services → Compose → Services** shows the container as running, and
`http://<pi-ip>:8080/api/health` returns `{"ok":true,"db":true}`.

> **Pin instead of tracking `:latest`** — replace the image with
> `ghcr.io/ackervekenbm/jukebox:<sha7>` for a reproducible deploy. Changing that
> line in the UI and hitting **Up** is also the rollback procedure
> ([docker-image.md](docker-image.md#pin-a-version-roll-back)).

## Updating

**Services → Compose → Files** → select `jukebox.yml` → **Pull**, then **Up**.

- **Pull** fetches `:latest`; if the image hasn't changed it's a no-op.
- **Up** recreates the container when the image did change. The named volume is
  kept, so the cabinet sync data survives.
- If **Pull** fails with an authentication error, redo the SSH login above.

Phone/browser side: a plain reload picks up the new build (the server sends
`no-cache` for `index.html` and `sw.js`). Force-refresh once if a stale service
worker still serves the old shell.

## Where the data lives

The named volume holds the only server-side state (`jukebox.db`). Find it on
disk with:

```bash
docker volume ls | grep jukebox
docker volume inspect <volume> --format '{{.Mountpoint}}'
```

Backups, restore steps and the "stop the container first" caveat are in
[operations.md](operations.md#backups).

## iPhone / home screen on plain HTTP

The app installs to the home screen over plain HTTP (it ships the legacy
`apple-*` meta tags) and works while the server is up. **Offline launch is the
part that needs HTTPS** — the service worker only registers in a secure context,
and the certificate must be trusted by the device. Options for that on an OMV box
(Caddy with a DNS challenge, mkcert, Tailscale) are in
[https-and-offline.md](https-and-offline.md).

## CLI fallback

If you prefer SSH over the UI, the plugin stores its compose files under the
OMV-managed compose directory (`/srv/<disk>/compose/…` on most installs):

```bash
sudo docker compose -f /srv/…/compose/jukebox.yml up -d
sudo docker compose -f /srv/…/compose/jukebox.yml pull
```

Mixing CLI and UI is fine — they operate on the same compose file — but pick one
as your habit so the UI's **Up/Pull** doesn't surprise you.

## Next

- [https-and-offline.md](https-and-offline.md) — TLS and offline launch
- [operations.md](operations.md) — backups, health, env vars
- [troubleshooting.md](troubleshooting.md) — when `Up` starts but nothing answers
