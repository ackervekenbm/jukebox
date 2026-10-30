# HTTPS and offline launch

Short version: **the app works over plain HTTP; offline launch does not.** HTTPS
is optional for using Jukebox on your LAN and required if you want it to open
with the server down.

## What actually depends on a secure context

| Feature | Plain HTTP | HTTPS |
| --- | --- | --- |
| Browsing, search, filters, cabinet | ✅ | ✅ |
| IndexedDB / localStorage caching | ✅ | ✅ |
| Install to home screen (iOS) | ✅ via legacy `apple-*` meta tags | ✅ |
| Service worker → **offline launch** | ❌ never registers | ✅ |
| `navigator.storage.persist()` (protection from eviction) | ❌ | ✅ |

The app feature-detects the storage APIs (`navigator.storage`, `persist()`, the
`caches` Cache API) and degrades quietly instead of breaking; a browser that
refuses to register a service worker over HTTP just means no offline shell.

The certificate must be one the **device trusts**; a self-signed cert the phone
rejects is no better than no cert.

## Topology

Keep the Node process where it is (loopback) and terminate TLS in front of it:

```
phone/laptop ──HTTPS──▶ Caddy/nginx ──HTTP──▶ jukebox (127.0.0.1:3000)
```

- Leave `HOST` at its default `127.0.0.1` — only the proxy needs to reach it.
- Proxy **everything** (`/`, `/api/*`, `/discogs/*`) to that one upstream. Don't
  split static files off to the proxy's own file server: `/discogs` is the
  reason the browser can talk to Discogs at all.
- Don't let the proxy cache `sw.js` or `index.html`. The server already sends
  `Cache-Control: no-cache` for both; some proxies ignore that for `.js`. A
  cached service worker means devices keep the old shell until its cache is
  cleared.

### nginx (plain HTTP, and TLS with your own cert)

```nginx
server {
    listen 80;
    server_name jukebox.lan;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

For TLS add `listen 443 ssl;`, `ssl_certificate …` and `ssl_certificate_key …`.

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
caddy add-package github.com/mholt/caddy-dns/duckdns
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

The app is then reachable at `https://<host>.<tailnet>.ts.net` from any device on
the tailnet, which is a secure context — service worker included.

## Verifying offline launch

1. Open the app over HTTPS on the device and use it once (the shell precaches).
2. DevTools → **Application → Service Workers**: an activated worker, scope `/`.
3. On the phone: add to home screen, open it once, then enable airplane mode and
   launch from the home screen. It should open the cached shell with the cached
   collection; the cabinet sync obviously can't resolve while offline.

Optional: check persistent storage in the console — `await navigator.storage.persisted()`
after the app has requested it.

## Next

- [operations.md](operations.md) — what's cached where, and what to back up
- [troubleshooting.md](troubleshooting.md) — stale service worker after a deploy
