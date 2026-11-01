# HTTPS and offline launch

Short version: **the app works over plain HTTP; offline launch does not.** HTTPS
is optional for using Jukebox on your LAN and required if you want it to open
with the server down.

## What actually depends on a secure context

| Feature | Plain HTTP | HTTPS |
| --- | --- | --- |
| Browsing, search, filters, cabinet | ✅ | ✅ |
| IndexedDB / localStorage caching | ✅ | ✅ |
| Install to home screen (iOS) | ✅ via the legacy `apple-*` tags in `index.html` (`apple-touch-icon`, `apple-mobile-web-app-*`) | ✅ |
| Service worker → **offline launch** | ❌ never registers | ✅ |
| `navigator.storage.persist()` (protection from eviction) | ❌ | ✅ |

The app feature-detects the storage APIs (`navigator.storage`, `persist()`, the
`caches` Cache API) and degrades quietly instead of breaking; a browser that
refuses to register a service worker over HTTP just means no offline shell.

The certificate must be one the **device trusts**; a self-signed cert the phone
rejects is no better than no cert.

## Topology

Keep the app where it is and terminate TLS in front of it. **The upstream target
depends on how you run it** — this is the single most common 502:

| Route | Proxy upstream | Notes |
| --- | --- | --- |
| Bare Node ([from-source-node.md](from-source-node.md)) | `http://127.0.0.1:3000` | Leave `HOST` at its default `127.0.0.1` |
| Docker ([docker-image.md](docker-image.md), [openmediavault.md](openmediavault.md)) | `http://127.0.0.1:8080` | `8080` is the published **host** port; `3000` exists only inside the container. Don't override the image's `HOST=0.0.0.0` |
| Proxy in another container | the compose service name, e.g. `http://jukebox:3000` | Put both on one Docker network; the `ports:` mapping can go if only the proxy needs to reach it |

The snippets below use the bare-Node port; substitute per this table.

- Proxy **everything** (`/`, `/api/*`, `/discogs/*`) to that one upstream. Don't
  split static files off to the proxy's own file server: `/discogs` is the
  reason the browser can talk to Discogs at all.
- Don't let the proxy cache `sw.js` or `index.html`. The server already sends
  `Cache-Control: no-cache` for both; some proxies ignore that for `.js`. A
  cached service worker means devices keep the old shell until its cache is
  cleared.
- **Mount it at a hostname or port, not a subpath.** The build targets the domain
  root (`base: '/'`, manifest `start_url`/`scope` `/`, service-worker scope `/`),
  so `https://host/jukebox/` serves the shell but every `/assets/*` request 404s.
- `/discogs` calls can take up to `DISCOGS_TIMEOUT_MS` (30s by default); keep the
  proxy's read timeout above that.

### nginx

TLS with your own certificate (mkcert, corporate CA, whatever you have):

```nginx
server {
    listen 80;
    server_name jukebox.lan;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name jukebox.lan;

    ssl_certificate     /etc/ssl/jukebox.lan.pem;
    ssl_certificate_key /etc/ssl/jukebox.lan-key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;   # see the table above
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;             # above DISCOGS_TIMEOUT_MS
    }
}
```

For plain HTTP only, drop the redirect block and the two `ssl_*` lines, and
change `listen 443 ssl;` to `listen 80;`.

### Caddy

Automatic HTTPS from a public CA needs a domain; a plain LAN hostname gets
Caddy's internal CA (which the device must trust, like mkcert):

```caddyfile
jukebox.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

## Getting a certificate your devices trust

From least to most setup:

| Approach | What's needed | Notes |
| --- | --- | --- |
| **mkcert — your own local CA** | Install your CA on each device once | Fully self-hosted and offline; no third party; works with a `.lan` hostname |
| **DuckDNS + Let's Encrypt (DNS-01)** | A free domain and a DNS-plugin Caddy build | No ports opened; public CA, so devices trust it with zero setup |
| **Tailscale** | Tailscale on server and devices | Free, auto-renewing certs on your private tailnet; no DNS or port work |

### mkcert

```bash
mkcert -install                       # create/trust a local CA on the server
mkcert jukebox.lan                    # → jukebox.lan.pem + jukebox.lan-key.pem
```

Point the proxy at those two files. On each phone/laptop, install the CA
(`mkcert -CAROOT` shows the `rootCA.pem`): on iOS, send it to the device, install
the profile, then **Settings → General → About → Certificate Trust Settings** and
enable full trust for it. Without that second step iOS still refuses the cert.

### DuckDNS + Let's Encrypt with Caddy (DNS-01)

No inbound ports needed, and the DNS challenge works behind CGNAT. Caddy needs its
DuckDNS DNS module compiled in:

```bash
caddy add-package github.com/caddy-dns/duckdns
```

```caddyfile
jukebox.example.duckdns.org {
    tls {
        dns duckdns {env.DUCKDNS_TOKEN}
    }
    reverse_proxy 127.0.0.1:3000
}
```

Then point the DuckDNS record at the LAN IP for local use (or the public IP if you
actually expose it — the DNS-01 challenge doesn't require that).

### Tailscale

If both server and devices are on your tailnet, Tailscale can serve HTTPS for you
and no certificate handling is involved (Tailscale ≥ 1.50):

```bash
tailscale serve --bg 8080        # proxy to http://127.0.0.1:8080
tailscale serve status
```

`8080` here is whatever the app is published on — the container's host port, or
`3000` for bare Node. The app is then reachable at
`https://<host>.<tailnet>.ts.net` from any device on the tailnet, which is a
secure context — service worker included.

## Verifying offline launch

1. Open the app over HTTPS on the device and use it once (the shell precaches).
2. DevTools → **Application → Service Workers**: an activated worker, scope `/`.
3. On the phone: add to home screen, open it once, then enable airplane mode and
   launch from the home screen. It should open the cached shell with the cached
   collection; the cabinet sync obviously can't resolve while offline.

Optional: check persistent storage in the console —
`await navigator.storage.persisted()` after the app has requested it.

## Next

- [operations.md](operations.md) — what's cached where, and what to back up
- [troubleshooting.md](troubleshooting.md) — stale service worker after a deploy
