# Troubleshooting

Part of the [deployment guides](README.md).

The commands here use the container name `jukebox` (the `docker run` route and
both compose files). On [OpenMediaVault](openmediavault.md) it is
`jukebox-jukebox-1`, and commands need `sudo`.

## First 60 seconds

Docker:

```bash
docker ps -a --filter name=jukebox          # running? healthy? restarting?
curl -fsS http://127.0.0.1:8080/api/health  # {"ok":true,"db":true}
docker logs --tail=50 jukebox
```

Bare Node:

```bash
systemctl status jukebox                    # active? restart loop?
curl -fsS http://127.0.0.1:3000/api/health
sudo journalctl -u jukebox -n 50
```

If health is good, the server is fine and the problem is in front of it (proxy,
browser, service worker). If it isn't, the problem is behind it (data directory,
config, wrong port).

## Symptoms

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| **Cabinet layout empty** after a redeploy, health OK | The app is running on a different (new, empty) database than before | [The cabinet looks empty](#the-cabinet-looks-empty) |
| `curl` → connection refused | Wrong port, or bare Node bound to loopback | Docker: the host side of the `8080:3000` mapping. Bare Node: port `3000`, and `HOST=0.0.0.0` for access from other devices |
| Container stuck in `Restarting`, or exits right after start | The data directory isn't writable | [The container restarts in a loop](#the-container-restarts-in-a-loop) |
| `/api/health` → `500 {"ok":false,"db":false}` | The database connection is unusable (rare while serving) | Restart; if it comes back, check the logs for an SQLite error ([what health checks](operations.md#health-and-monitoring)) |
| Cabinet changes don't save ("Could not save the cabinet"), health OK | Disk full, or the database file was deleted or replaced underneath the app | Free space or restore the file, then restart ([why health stays OK](operations.md#health-and-monitoring)) |
| `exec format error` | 32-bit Raspberry Pi OS, or a single-architecture tag for the wrong CPU | 64-bit OS ([why](README.md#the-contract-every-route-shares)); use `:latest` or the matching `-amd64`/`-arm64` tag |
| Bare Node exits at start-up: `Cannot find module …/better_sqlite3.node` | 32-bit OS | 64-bit OS ([why](README.md#the-contract-every-route-shares)), then `npm ci` again |
| `[jukebox] no client build found; serving API only` | Started without a client build | `npm run build`, or set `CLIENT_DIST` |
| Proxy answers `502`, the app is up | The proxy points at the wrong port, or (proxy in a container) can't reach the app's network | Docker: `127.0.0.1:8080`; bare Node: `127.0.0.1:3000`; proxy in a container: both on one network, upstream `jukebox:3000` ([table](https-and-offline.md#reverse-proxy)) |
| The DuckDNS name works on one device but not another, or `nslookup` finds nothing while a public resolver does | The router's DNS-rebinding protection refuses a public name pointing to a LAN address | Allow the name in that protection, or give the devices a resolver that doesn't filter ([step 4](https-and-offline.md#duckdns--lets-encrypt-with-caddy)) |
| `/discogs` → `502 {"error":"Discogs API is unreachable"}` | The server can't reach `api.discogs.com`, or the call took longer than `DISCOGS_TIMEOUT_MS` | Check DNS and outbound HTTPS from the server; raise the timeout if Discogs is just slow |
| Collection never loads, the console shows CORS or 429 errors | `dist/` is served by a static web server instead of the app | Proxy everything, including `/discogs`, to the app ([why](README.md#common-mistakes)) |
| Old version after a deploy | The device hasn't switched to the new build yet, or a proxy caches it | [Devices after an update](operations.md#devices-after-an-update); if that doesn't help, [a stale deployment](#a-stale-deployment-survives-every-reload) |
| `docker pull` → `denied` / `unauthorized` | Stale GitHub credentials on the host (the image is public) | [If a pull is denied](docker-image.md#if-a-pull-is-denied) |
| Cabinet sync fails with 401 | The Discogs token is invalid or expired | Generate a new token on Discogs (settings → developers) and paste it into Settings |
| Cabinet sync fails with 409 | Another device saved first; normally fixes itself | A 409 that keeps coming back is worth an issue |
| Cabinet sync fails with 413 | The cabinet document is over the server's 256 KB limit | [Below](#cabinet-sync-fails-with-413) |
| The app won't open offline | Plain HTTP, or a certificate the device doesn't trust | [https-and-offline.md](https-and-offline.md) |
| Certificate warning on the phone | Your CA isn't trusted on that device | Install and trust it ([mkcert step 6](https-and-offline.md#mkcert-your-own-local-ca)); iOS needs the extra *Certificate Trust Settings* step |
| Works on one device but not another | Browser data is per device | [Below](#it-works-on-my-phone-but-not-my-laptop) |

## The cabinet looks empty

The server stores the cabinet layout in one SQLite file, per Discogs account. An
empty cabinet with a healthy server means the app is looking at a different
database, or a different account, than before. Health still says
`{"ok":true,"db":true}`, because a brand-new database is a valid one: the app
creates it the moment it starts. Find where your old data went:

**A different Docker volume.** Compose prefixes volume names with the project
(folder) name, so the same compose file run from another folder gets a new, empty
volume. The `docker run` command and the compose file in
[docker-image.md](docker-image.md) both use `jukebox-data`; the repo's own
`docker-compose.yml` uses `<folder>_jukebox-data`. List them and look inside each
with [`jukebox_peek`](operations.md#load-the-helpers):

```bash
docker volume ls | grep -i jukebox
jukebox_peek jukebox-data
jukebox_peek jukebox_jukebox-data
```

Then either [copy the database across](operations.md#moving-between-routes), or
pin compose to the volume that **already has the data**:

```yaml
volumes:
  jukebox-data:
    name: jukebox_jukebox-data     # the volume with your data, exactly as `docker volume ls` shows it
```

Don't pin to a name that has no data yet: that gives you yet another empty volume.

**A different OMV data folder.** On [OpenMediaVault](openmediavault.md) the data
lives in the *Data* shared folder chosen in **Services → Compose → Settings**.
Changing that setting, or the `CHANGE_TO_COMPOSE_DATA_PATH` line, starts the
container on an empty folder. Point it back, or copy `jukebox.db` across. A stack
from before the bind-folder layout has its data in a volume:
[upgrading from a named-volume stack](openmediavault.md#upgrading-from-a-named-volume-stack).

**A different bare-Node data directory.** A manual `npm start` keeps its
database in `./data` in the checkout, while the systemd service uses
`/var/lib/jukebox`. A cabinet made in one isn't in the other; copy it with the
[restore steps](operations.md#restore).

**A different Discogs account.** The cabinet is stored per Discogs username. If
the device is signed in with another username (or a token for another account),
it shows that account's cabinet, which may be empty. Check the username in
Settings.

**A different address.** Browser data is per address, so a device that opens
the app at a new address (HTTP → HTTPS, a new host name, `:3000` → `:8080`)
starts fresh there, without your token. Enter the token again in Settings; the
cabinet then loads from the server. If it doesn't, one of the causes above
applies.

## The container restarts in a loop

First read the log (below). If it says `exec format error`, the host runs a
32-bit OS: see [64-bit only](README.md#the-contract-every-route-shares).
Otherwise it is almost always the data directory. The database is opened at
start-up, so a data directory the process can't write to stops it before it
listens. You get `Restarting` in `docker ps -a`, not a 500
from `/api/health`:

```bash
docker ps -a --filter name=jukebox
docker logs --tail=30 jukebox
# SqliteError: unable to open database file
# SqliteError: attempt to write a readonly database
```

Fix the mount, then restart:

- **Named volume:** usually just works. If something root-only wrote into it,
  `docker run --rm -v "$VOL":/data alpine:3.24 chown -R 0:0 /data`. Set `VOL` to
  your route's real volume name first ([how](operations.md#set-the-names)); with
  the wrong name this changes a new, empty volume and fixes nothing.
- **Bind mount (a host folder):** the container runs as root, so the folder has
  to be writable for root. Check its mode, and where it really points with
  `docker inspect --format '{{json .Mounts}}' jukebox`.
- **Docker with user-namespace remapping** (`userns-remap` in the daemon
  config): root in the container is an unprivileged user on the host. Give the
  folder to that user, or use a named volume.
- **SELinux hosts** (Fedora, RHEL): a bind mount needs `:z` or `:Z` after the
  container path.

## A stale deployment survives every reload

First check **Settings → the build line** on the device. If it shows the new
commit, the device is up to date. If it shows the old one, either the device
hasn't switched yet ([devices after an update](operations.md#devices-after-an-update))
or the deploy didn't land ([which build is running](operations.md#which-build-is-running)).

If the server does run the new build and a device keeps getting the old one, a
**proxy is caching** `sw.js` or `index.html`. The app sends them with
`cache-control: no-cache`, but a caching proxy passes that header through
unchanged, so look for the proxy's own signs:

```bash
curl -sI https://your-https-address/sw.js | grep -iE 'cache-control|^age|x-cache|cf-cache-status|etag|last-modified'
# want: no Age header, no X-Cache: HIT, no cf-cache-status: HIT
curl -sI http://127.0.0.1:8080/sw.js | grep -iE 'etag|last-modified'   # 3000 for bare Node
```

An `Age` header, a cache `HIT`, or an `ETag` that differs from the one the app
returns directly means the proxy caches; exclude `sw.js` and `index.html` there.

Last resort on a desktop browser: DevTools → **Application → Service Workers →
Unregister**, then reload twice.

## Port 80/443 is taken

Publish a different host port (`"8080:3000"`); only the left-hand side is yours.
This is the normal case on [OpenMediaVault](openmediavault.md), whose web UI holds
80 and 443.

## Collection loading stalls or retries

Discogs allows about 60 requests a minute. The app paces itself, and the
`/discogs` proxy passes Discogs' rate-limit headers through, so a `429` is
retried after the delay Discogs asks for. If you see throttling again and again:

- make sure requests go through the app's `/discogs` proxy and not straight to
  `api.discogs.com`; direct requests from the browser show throttling as a CORS
  error;
- a very large collection is slow the first time: the collection plus the
  original release years can take a few minutes to load once, and then come from
  the browser cache.

## Cabinet sync fails with 413

`PUT /api/sync/cabinet` is capped at 256 KB. The cabinet document stores an entry
per release, so a very large collection, or a small cabinet that leaves many
records without a shelf, can go over it. The app then says "Could not save the
cabinet".

This is a server limit, not a deployment problem, and there is no setting for it
today. Report it with your collection size:
<https://github.com/ackervekenbm/jukebox/issues>. Until it is raised, the cabinet
still works in the browser; only syncing it to other devices fails.

## It works on my phone but not my laptop

Browser data is per device and per browser profile: the cached collection, saved
views, settings and the stored token don't transfer. Only the cabinet layout
syncs, through the server, per Discogs username. A second device starts with a
fresh fetch and needs the token entered once.

## Reporting a problem

Include: how you deploy (image tag or commit), the output of
`curl -s http://<server>:<port>/api/health`, the container or service logs,
browser console errors, and whether it happens in a private window too (which
runs without the service worker).
<https://github.com/ackervekenbm/jukebox/issues>

## Next

- Back to the overview: [docs/deploy/README.md](README.md)
