# Troubleshooting

First 60 seconds, in this order:

```bash
docker ps                                   # running? healthy?
curl -fsS http://127.0.0.1:8080/api/health  # {"ok":true,"db":true}
docker compose logs --tail=50 jukebox       # or: journalctl -u jukebox -n 50
```

If `health` is good, the server side is fine and the problem is in front of it
(proxy, browser, service worker). If it isn't, the problem is behind it (data
dir, config, wrong port).

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Container exits immediately | Bad env/volume | `docker logs jukebox` — usually `DATA_DIR` unwritable |
| `curl` → connection refused | Wrong host/port, or process bound to loopback | `HOST=0.0.0.0` for direct access; check the port mapping (`8080:3000`) |
| `/api/health` → `500 {"ok":false,"db":false}` | `DATA_DIR` missing/unwritable, or `better-sqlite3` couldn't load | Check permissions/ownership of the mounted dir; check logs |
| `[jukebox] no client build found; serving API only` | Started without a client build | `npm run build`; or set `CLIENT_DIST` |
| `docker pull` → `denied` / `unauthorized` | GHCR login missing/expired, or a fine-grained token | Redo `docker login ghcr.io` with a classic PAT (`read:packages`) |
| `exec format error` | Single-arch image for the wrong CPU | Use `:latest` (multi-arch) or the right `-amd64`/`-arm64` tag |
| Old UI after a deploy | Service worker still holding the old shell | Force-refresh; or unregister the SW in DevTools → Application |
| Collection never loads, console shows CORS/429 | `dist/` served by a static server instead of the Node process | Proxy `/` (including `/discogs`) to the app |
| Cabinet sync fails with 401 | Discogs token invalid/expired | Regenerate the token in Settings |
| Cabinet sync fails with 409 | Another device wrote first — normally self-healing | Check the client rebased; a persistent 409 is worth an issue |
| Device can't open the app offline | HTTP instead of HTTPS, or untrusted cert | [https-and-offline.md](https-and-offline.md) |
| Cert warning on the phone | CA not trusted on that device | Install/trust the CA (iOS needs the second "Certificate Trust Settings" step) |
| Data "disappeared" after redeploy | Different volume | See below |

## A stale deployment survives every reload

`index.html` and `sw.js` are served `no-cache` by the app, so this is almost
always a **proxy** caching them:

```bash
curl -sI https://jukebox.example.com/sw.js | grep -i cache-control
# want: cache-control: no-cache
```

If your proxy answers with a max-age, exclude `sw.js`/`index.html` from caching
there. Second candidate: the device kept the old service worker — DevTools →
Application → Service Workers → *Unregister*, then reload twice.

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
else instead of fighting it — the container always listens on `3000`:

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

## "It works on my phone but not my laptop" (or vice versa)

Browser data is per device and per browser profile: the collection cache, saved
views, settings and the stored token don't transfer. Only the cabinet layout
syncs (server-side, identified by your Discogs username). A second device starts
with a fresh fetch.

## Reporting a problem

Include: how you deploy (image tag or commit), `curl -s http://<host>/api/health`,
the container/service logs, browser console errors and whether it's reproducible
in a private window (no service worker). <https://github.com/ackervekenbm/jukebox/issues>
