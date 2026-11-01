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
| Service worker → **offline launch** | ❌ never registers (except on `http://localhost`, which counts as secure) | ✅ |
| Cache API (`caches`), used for album art | ❌ covers aren't kept between visits | ✅ |
| `navigator.storage.persist()` (protection from eviction) | ❌ | ✅ |

The app feature-detects the storage APIs (`navigator.storage`, `persist()`, the
`caches` Cache API) and degrades quietly instead of breaking; a browser that
refuses to register a service worker over HTTP just means no offline shell.

The certificate must be one the **device trusts**; a self-signed cert the phone
rejects is no better than no cert.

**Switching to HTTPS starts the app fresh on each device.** `http://host:8080`
and `https://jukebox.lan` are different origins to the browser, so the stored
token, settings, saved views and cached collection stay behind on the old
address. A home-screen icon added over HTTP keeps opening the HTTP address.
Delete the old icon, open the HTTPS address, enter the token again and add it to
the home screen from there. The first load fetches the collection again; the
cabinet layout comes back from the server.

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
  `Cache-Control: no-cache` for both. The nginx and Caddy snippets below cache
  nothing; the risk comes from an explicit proxy cache (`proxy_cache`, a cache
  plugin) or a CDN in front. A cached service worker means devices keep the old
  shell until its cache is cleared.
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
        proxy_read_timeout 60s;             # nginx's default; keep it above DISCOGS_TIMEOUT_MS if you raise that
    }
}
```

For plain HTTP only, drop the redirect block and the two `ssl_*` lines, and
change `listen 443 ssl;` to `listen 80;`.

### Caddy

For a public domain, Caddy gets a Let's Encrypt certificate on its own:

```caddyfile
jukebox.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

A LAN name such as `jukebox.lan` needs an explicit `tls` line. Caddy only uses
its internal CA automatically for `localhost`, IP addresses and the `.local`,
`.internal` and `.home.arpa` names. For any other name it tries Let's Encrypt,
and that fails on a private network:

```caddyfile
jukebox.lan {
    tls /etc/ssl/jukebox.lan.pem /etc/ssl/jukebox.lan-key.pem   # mkcert files, see below
    # or: tls internal   (Caddy's own CA)
    reverse_proxy 127.0.0.1:3000
}
```

With `tls internal`, devices have to trust Caddy's root certificate, the same
way as with mkcert. It is at `<caddy data dir>/pki/authorities/local/root.crt`
(for a systemd install, `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`).

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

Point the proxy at those two files. On each phone/laptop, install the CA.
`mkcert -CAROOT` shows the folder: send only `rootCA.pem`. The `rootCA-key.pem`
next to it must never leave the server.

- **iOS:** open the file on the device, then **Settings → Profile Downloaded →
  Install**. Then go to **Settings → General → About → Certificate Trust
  Settings** and turn on full trust for it. Without that last step iOS still
  refuses the cert.
- **Android:** **Settings → Security → Encryption & credentials → Install a
  certificate → CA certificate** (the menu names vary by vendor). Chrome trusts
  user-installed CAs for websites, so the service worker works. Firefox for
  Android ignores them unless you enable that in its settings. Installing the
  app from a site with a user-installed CA is less dependable than with a public
  certificate, so on Android DuckDNS or Tailscale is the smoother choice.

### DuckDNS + Let's Encrypt with Caddy (DNS-01)

No inbound ports needed, and the DNS challenge works behind CGNAT. Stock Caddy
can't do it: it needs a build with the DuckDNS DNS module. Any of these works:

- `xcaddy build --with github.com/caddy-dns/duckdns`, then replace the `caddy`
  binary with the result;
- in Docker, a `caddy:builder` stage running that `xcaddy build`, copied into a
  `caddy` image;
- a custom download from <https://caddyserver.com/download> with
  `caddy-dns/duckdns` ticked.

`caddy add-package github.com/caddy-dns/duckdns` also exists, but it swaps the
installed binary in place, and an apt/dnf upgrade later puts the stock one back.

```caddyfile
example.duckdns.org {
    tls {
        dns duckdns {env.DUCKDNS_TOKEN}
    }
    reverse_proxy 127.0.0.1:3000
}
```

`DUCKDNS_TOKEN` has to be in Caddy's own environment, for example an
`Environment=DUCKDNS_TOKEN=…` line in a systemd override for `caddy.service`.

Then point the DuckDNS record at the LAN IP for local use (or the public IP if you
actually expose it — the DNS-01 challenge doesn't require that). Many routers and
resolvers block public DNS answers that point to a private address (DNS-rebinding
protection, e.g. on FRITZ!Box, OpenWrt/dnsmasq, pfSense/Unbound). If the phone
can't resolve the name, allow the domain in that protection.

### Tailscale

If both server and devices are on your tailnet, Tailscale can serve HTTPS for you
and no certificate handling is involved. First, in the Tailscale admin console
under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**; without them
`serve` can't issue a certificate. Then, on the server (a recent Tailscale with
the `--bg` syntax; on Linux it needs `sudo`, or `tailscale set --operator=$USER`
once):

```bash
sudo tailscale serve --bg 8080   # proxy to http://127.0.0.1:8080
sudo tailscale serve status
```

The certificate puts the `<host>.<tailnet>.ts.net` name in public Certificate
Transparency logs. Nothing on the tailnet becomes reachable because of that, but
the name is public.

`8080` here is whatever the app is published on — the container's host port, or
`3000` for bare Node. The app is then reachable at
`https://<host>.<tailnet>.ts.net` from any device on the tailnet, which is a
secure context — service worker included.

## Verifying offline launch

Test on the device itself. The server's own browser proves nothing:
`http://localhost` already counts as secure there.

1. On the device, open the app at its HTTPS address and add it to the home
   screen.
2. Open it **from the home screen** and let the collection load completely. On
   iOS a home-screen app has its own storage, separate from Safari, so data
   loaded in Safari doesn't count.
3. Check that the worker is in control. In a desktop browser, open the console.
   For an iPhone, use Safari's Web Inspector from a Mac (**Develop → <device>**).
   Both of these should be `true`:

   ```js
   isSecureContext
   navigator.serviceWorker.controller !== null
   ```

4. Turn on airplane mode, close the app completely and launch it from the home
   screen. It should open with the cached collection; cabinet sync can't reach
   the server while offline.

Persistent storage is optional, and the app never asks for it on its own. To get
it, press **Request persistent storage** in Settings → Advanced, then check with
`await navigator.storage.persisted()` in the console.

## Next

- [operations.md](operations.md) — what's cached where, and what to back up
- [troubleshooting.md](troubleshooting.md) — stale service worker after a deploy
