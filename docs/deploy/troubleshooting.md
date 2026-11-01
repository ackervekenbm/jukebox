# Troubleshooting

First 60 seconds, in this order:

```bash
docker ps                                   # running? healthy?
curl -fsS http://127.0.0.1:8080/api/health  # {"ok":true,"db":true}
docker compose logs --tail=50 jukebox       # or: journalctl -u jukebox -n 50
```

Bare Node instead of Docker:

```bash
systemctl status jukebox                    # active? restart loop?
curl -fsS http://127.0.0.1:3000/api/health
journalctl -u jukebox -n 50
```

If `health` is good, the server side is fine and the problem is in front of it
(proxy, browser, service worker). If it isn't, the problem is behind it (data
dir, config, wrong port).

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `curl` → connection refused | Wrong host/port, or the process is bound to loopback (bare Node) | Bare Node: `HOST=0.0.0.0` for direct access. Any route: check the port (`8080:3000` mapping, or `3000` for bare Node) |
| `/api/health` → `500 {"ok":false,"db":false}` | The SQLite handle itself is unusable (closed, or the driver refused the statement) — rare while serving | Restart the process; if it returns, check the logs for a driver error. Disk-full or a deleted DB file do **not** show up here — they break writes instead |
| Container stuck in `Restarting`, or exits right after `Up` | `DATA_DIR` not writable — wrong ownership, read-only mount, or an unwritable parent | `docker ps -a` + `docker logs`; fix the mount — see [the restart loop](#the-container-restarts-in-a-loop) |
| Bare Node exits at start-up: `Cannot find module …/better_sqlite3.node` | 32-bit OS (`armv7l`) — no `armv7` prebuild and no compile fallback | Install 64-bit Raspberry Pi OS, then `rm -rf node_modules && npm ci` |
| `/discogs` → `502 {"error":"Discogs API is unreachable"}` | The host can't reach `api.discogs.com`, or the call exceeded `DISCOGS_TIMEOUT_MS` | Check outbound DNS/HTTPS from the host; raise the timeout if Discogs is just slow |
| Proxy answers `502` / connection refused, app is "up" | Proxy points at `3000` when only `8080` is published | Point it at the published host port — [https-and-offline.md](https-and-offline.md#topology) |
| `[jukebox] no client build found; serving API only` | Started without a client build | `npm run build`; or set `CLIENT_DIST` |
| `docker pull` → `denied` / `unauthorized` | Rare: the image is public, so this is a stale/incorrect local credential (or a private fork) | `docker logout ghcr.io` for anonymous pulls, or log in with a classic PAT (`read:packages`) — fine-grained tokens don't work with Packages |
| `exec format error` | Single-arch image for the wrong CPU, or 32-bit Raspberry Pi OS (the image is `amd64`/`arm64` only) | Use `:latest` (multi-arch) or the right `-amd64`/`-arm64` tag; on a Pi, install 64-bit Raspberry Pi OS |
| Old UI after a deploy | Service worker still holding the old shell | Force-refresh; or unregister the SW in DevTools → Application |
| Collection never loads, console shows CORS/429 | `dist/` served by a static server instead of the Node process | Proxy `/` (including `/discogs`) to the app |
| Cabinet sync fails with 401 | Discogs token invalid/expired | Regenerate the token in Settings |
| Cabinet sync fails with 409 | Another device wrote first - normally self-healing | Check the client rebased; a persistent 409 is worth an issue |
| Cabinet sync fails with 413 | Cabinet document exceeded the server's 256 KB JSON limit (very large collection, or small cabinets leaving many records unplaced) | Report it with your collection size — see [below](#cabinet-sync-fails-with-413) |
| Device can't open the app offline | HTTP instead of HTTPS, or untrusted cert | [https-and-offline.md](https-and-offline.md) |
| Cert warning on the phone | CA not trusted on that device | Install/trust the CA (iOS needs the second "Certificate Trust Settings" step) |
| Data "disappeared" after redeploy | Different volume | See below |

## The container restarts in a loop

The database is opened at start-up (create dir → open → WAL → `CREATE TABLE`), so
a `DATA_DIR` the process cannot write to kills it before it listens — you get
`Restarting` in `docker ps -a`, not a 500 from `/api/health`:

```bash
docker ps -a --filter name=jukebox
docker logs --tail=30 jukebox
# SqliteError: unable to open database file
# SqliteError: attempt to write a readonly database
```

Fix the mount, then restart:

- **Named volume:** usually just works. If it was populated by a root-only
  process, `docker run --rm -v jukebox-data:/data alpine chown -R 0:0 /data`.
- **Bind mount:** the container runs as root by default, so a host directory owned
  by another UID is still writable only if the permissions allow it. Check the
  mode and `docker inspect --format '{{json .Mounts}}' jukebox`.
- **`userns-remap`:** the container's root maps to an unprivileged host UID; chown
  the directory to that UID (see the daemon config) or use a named volume.
- **SELinux hosts:** a bind mount needs `:z` / `:Z`.

## A stale deployment survives every reload

`index.html` and `sw.js` are served `no-cache` by the app, so this is almost
always a **proxy** caching them:

```bash
curl -sI https://jukebox.example.com/sw.js | grep -i cache-control
# want: cache-control: no-cache
```

If your proxy answers with a max-age, exclude `sw.js`/`index.html` from caching
there. Second candidate: the device kept the old service worker — DevTools →
Application → Service Workers → *Unregister*, then reload twice. Before either,
check **Settings → the build line**: if it already shows the new commit, the
server is fine and this is a client-cache problem; if it shows the old commit,
the deploy didn't land ([operations.md](operations.md#which-build-is-running)).

## The volume moved

Docker prefixes named volumes with the compose **project name** (usually the
directory name). Deploying the same compose file from a different directory, or
under a different project name, silently creates a *new* empty volume:

```bash
docker volume ls | grep -i jukebox
```

If you see two, your data is in the older one. Either copy the DB across
([operations.md](operations.md#backups)) or pin the volume name in compose:

```yaml
volumes:
  jukebox-data:
    name: jukebox-data
```

## Port 80/443 is taken

Common on OpenMediaVault (its web UI owns them). Map the container to something
else instead of fighting it — the image listens on `3000` and its `HEALTHCHECK`
probes that port:

```yaml
    ports:
      - "8080:3000"
```

## Collection loading stalls or retries

Discogs allows ~60 requests/minute. The app paces itself, and the `/discogs`
proxy passes rate-limit headers through so a `429` is retried after the
server-provided delay. If you see repeated throttling:

- confirm traffic goes through the app's proxy (same-origin `/discogs`), not
  directly to `api.discogs.com` — direct cross-origin calls surface throttling as
  an opaque CORS error;
- a very large collection's first fetch plus master-year enrichment is the
  heaviest case; it is expected to stream in over a few minutes once, then come
  from the browser cache.

## Cabinet sync fails with 413

`PUT /api/sync/cabinet` is capped at 256 KB (the server's `express.json` limit).
The cabinet document stores a placement entry per release, so a very large
collection — or a small cabinet that leaves a large `unplaced` list — can exceed
it. The client then reports a generic "Could not save the cabinet".

This is a server limit rather than a deployment problem, and there is no setting
for it today. Report it with your collection size:
<https://github.com/ackervekenbm/jukebox/issues>. Until it is raised, the cabinet
still works locally in the browser; only cross-device sync of that document
fails.

## "It works on my phone but not my laptop" (or vice versa)

Browser data is per device and per browser profile: the collection cache, saved
views, settings and the stored token don't transfer. Only the cabinet layout
syncs (server-side, identified by your Discogs username). A second device starts
with a fresh fetch.

## Reporting a problem

Include: how you deploy (image tag or commit), `curl -s http://<host>/api/health`,
the container/service logs, browser console errors and whether it's reproducible
in a private window (no service worker). <https://github.com/ackervekenbm/jukebox/issues>
