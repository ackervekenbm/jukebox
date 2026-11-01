# HTTPS and offline launch

Part of the [deployment guides](README.md).

Short version: **the app works over plain HTTP; offline launch does not.** HTTPS
is optional for using Jukebox on your LAN, and required if you want it to open
while the server is down.

## What actually needs HTTPS

Browsers only enable some features on a *secure context*: a page served over
HTTPS (or from `localhost`).

| Feature | Plain HTTP | HTTPS |
| --- | --- | --- |
| Browsing, search, filters, cabinet | ✅ | ✅ |
| Caching the collection in the browser (IndexedDB, localStorage) | ✅ | ✅ |
| Add to home screen on iOS | ✅ (via the `apple-*` tags in `index.html`) | ✅ |
| Service worker → **offline launch** | ❌ never registers (except on `http://localhost`) | ✅ |
| Cache API, used for album art | ❌ covers aren't kept between visits | ✅ |
| Persistent storage (protection from the browser clearing data) | ❌ | ✅ |

Over plain HTTP the app just does without them; nothing breaks.

Two more things to know before you switch:

- **Over plain HTTP your Discogs token crosses the network unencrypted** on every
  request, because every Discogs call goes through the app's own `/discogs`
  proxy. That is fine on a home network you trust; anywhere else, use HTTPS.
- **Switching to HTTPS starts the app fresh on each device.** `http://host:8080`
  and `https://jukebox.lan` are different sites to the browser, so the stored
  token, settings, saved views and cached collection stay behind on the old
  address. A home-screen icon added over HTTP keeps opening the HTTP address.
  Delete the old icon, open the HTTPS address, enter the token again and add it
  to the home screen from there. The first load fetches the collection again;
  the cabinet layout comes back from the server.

The certificate must be one the **device trusts**; a self-signed certificate
the phone rejects is no better than none.

## Pick an approach

From least to most setup:

| Approach | What's needed | Good for |
| --- | --- | --- |
| **[Tailscale](#tailscale)** | Tailscale on the server and your devices | The easiest. Free certificates that renew themselves; no DNS, no proxy, no ports. Also the way to go on [OpenMediaVault](openmediavault.md#https-on-omv), whose UI holds 80/443 |
| **[DuckDNS + Let's Encrypt](#duckdns--lets-encrypt-with-caddy)** | A free DuckDNS name and a Caddy build with the DuckDNS module | Devices trust it with no setup, and no ports are opened |
| **[mkcert](#mkcert-your-own-local-ca)** | Your own certificate authority, installed on every device | Fully offline, no third party, works with a `jukebox.lan` name |

Tailscale needs nothing else on this page. The other two need a reverse proxy
in front of the app; the [next section](#reverse-proxy) shows how.

## Reverse proxy

Keep the app where it is and terminate HTTPS in a proxy in front of it. **The
upstream depends on how you run the app**, and getting it wrong is the most
common cause of a 502:

| Route | Proxy upstream | Notes |
| --- | --- | --- |
| Docker ([image](docker-image.md), [from source](from-source-docker.md), [OMV](openmediavault.md)) | `127.0.0.1:8080` | `8080` is the published **host** port; `3000` exists only inside the container. Publish it as `127.0.0.1:8080:3000` so plain HTTP isn't also open on the LAN ([why](README.md#keep-it-on-your-lan-or-tailnet)) |
| Bare Node ([from-source-node.md](from-source-node.md)) | `127.0.0.1:3000` | Leave `HOST` at its default `127.0.0.1` |
| Proxy in another container | the compose service name, e.g. `jukebox:3000` | Put both on one Docker network; the `ports:` mapping can then go |

The snippets below use the Docker upstream, `127.0.0.1:8080`; for bare Node,
change it to `127.0.0.1:3000`.

- Proxy **everything** (`/`, `/api/*`, `/discogs/*`) to that one upstream. Don't
  serve the static files from the proxy instead: `/discogs` is how the browser
  talks to Discogs at all.
- Don't add caching. The app sends `Cache-Control: no-cache` for `sw.js` and
  `index.html`, and the snippets below cache nothing. An explicit proxy cache
  (`proxy_cache`, a cache plugin) or a CDN in front would keep devices on the old
  version.
- **Serve it at a hostname or port, not a subpath.** The app assumes it lives at
  `/`, so `https://host/jukebox/` loads the page but every `/assets/*` request
  fails.
- `/discogs` calls can take up to `DISCOGS_TIMEOUT_MS` (30 s by default); keep the
  proxy's read timeout above that.
- On OpenMediaVault, a proxy on the host can't use ports 80/443 (OMV's UI holds
  them). Use [Tailscale](#tailscale), another port, or another machine.

### Caddy

Install it from your distribution or <https://caddyserver.com/docs/install>. A
`jukebox.lan` name needs an explicit `tls` line: Caddy only uses its own
certificate authority automatically for `localhost`, IP addresses and the
`.local`, `.internal` and `.home.arpa` names, and for any other name it tries
Let's Encrypt, which fails on a private network. `/etc/caddy/Caddyfile`:

```caddyfile
jukebox.lan {
    tls /etc/ssl/jukebox.lan.pem /etc/ssl/jukebox.lan-key.pem   # mkcert files, see below
    # or: tls internal   (Caddy's own CA)
    reverse_proxy 127.0.0.1:8080
}
```

Then `sudo systemctl reload caddy`. With `tls internal`, devices have to trust
Caddy's root certificate the same way as with mkcert; a packaged Caddy keeps it
at `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`.

A public domain (`jukebox.example.com { reverse_proxy 127.0.0.1:8080 }`) gets a
Let's Encrypt certificate on its own, but only with ports 80/443 open to the
internet, which exposes the app. Jukebox has no login, so don't do that by
default ([why](README.md#keep-it-on-your-lan-or-tailnet)); DuckDNS below gets a
public certificate without it.

### nginx

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
        proxy_pass http://127.0.0.1:8080;   # bare Node: 127.0.0.1:3000
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;             # nginx's default; keep it above DISCOGS_TIMEOUT_MS if you raise that
    }
}
```

Save it as `/etc/nginx/conf.d/jukebox.conf`, then
`sudo nginx -t && sudo systemctl reload nginx`.

## Tailscale

[Tailscale](https://tailscale.com) is a private network between your own
devices (your *tailnet*). It can give the app an HTTPS address with a real
certificate, with no proxy and no DNS work.

1. Install Tailscale on the server
   (<https://tailscale.com/download/linux>, `sudo tailscale up`) and on each
   phone and laptop (App Store, Play Store, or the download page), signed in to
   the same account.
2. In the [admin console](https://login.tailscale.com/admin/dns), under **DNS**,
   turn on **MagicDNS** and **HTTPS Certificates**. Without them `serve` can't
   get a certificate.
3. On the server, put the app behind `tailscale serve`. This needs a recent
   Tailscale with the `--bg` option, and `sudo` on Linux (or
   `tailscale set --operator=$USER` once):

   ```bash
   sudo tailscale serve --bg 8080   # the app's port: 8080 for Docker, 3000 for bare Node
   sudo tailscale serve status      # shows the https://<host>.<tailnet>.ts.net address
   ```

The app is then at `https://<host>.<tailnet>.ts.net` for every device on your
tailnet, as long as the Tailscale app on that device is connected.

Use `serve`, **never `funnel`**: Funnel publishes the app to the whole internet.
One thing to know: every certificate issued is listed in public Certificate
Transparency logs, so the `<host>.<tailnet>.ts.net` name becomes public. Nothing
becomes reachable because of that.

## DuckDNS + Let's Encrypt with Caddy

[DuckDNS](https://www.duckdns.org) gives you a free name such as
`yourname.duckdns.org`. Caddy proves to Let's Encrypt that you own it by
creating a DNS record (the *DNS-01 challenge*), so no inbound ports are needed,
and it works even when your internet provider gives you no public IP of your own
(CGNAT).

**1. A Caddy build with the DuckDNS module.** Stock Caddy can't do the DNS
challenge. Any of these gives you one:

- `xcaddy build --with github.com/caddy-dns/duckdns`, then replace the `caddy`
  binary with the result;
- in Docker, a `caddy:builder` stage running that `xcaddy build`, copied into a
  `caddy` image;
- a custom download from <https://caddyserver.com/download> with
  `caddy-dns/duckdns` ticked.

`caddy add-package github.com/caddy-dns/duckdns` also exists, but it swaps the
installed binary in place, and the next apt/dnf upgrade puts the stock one back.

**2. Give Caddy the token in a root-only file.** An `Environment=` line would be
readable by any local user through `systemctl show`. Anyone with the token can
repoint your DuckDNS name:

```bash
sudo install -m 600 /dev/null /etc/caddy/duckdns.env
read -rsp 'DuckDNS token: ' T; echo; printf 'DUCKDNS_TOKEN=%s\n' "$T" | sudo tee /etc/caddy/duckdns.env >/dev/null; unset T
sudo mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/caddy/duckdns.env\n' | \
  sudo tee /etc/systemd/system/caddy.service.d/duckdns.conf >/dev/null
sudo systemctl daemon-reload
```

**3. The Caddyfile:**

```caddyfile
yourname.duckdns.org {
    tls {
        dns duckdns {env.DUCKDNS_TOKEN}
    }
    reverse_proxy 127.0.0.1:8080
}
```

Then `sudo systemctl restart caddy`.

**4. Point the DuckDNS name at the server's LAN IP** (on duckdns.org). Not your
public IP: the challenge doesn't need the app to be reachable from outside
([why](README.md#keep-it-on-your-lan-or-tailnet)). Many routers and DNS
resolvers refuse public names that point to a private address (*DNS-rebinding
protection*, e.g. on FRITZ!Box, OpenWrt/dnsmasq, pfSense/Unbound). If the phone
can't resolve the name, allow the domain in that protection.

## mkcert: your own local CA

[mkcert](https://github.com/FiloSottile/mkcert) creates a certificate authority
(CA) of your own and certificates signed by it. Devices trust them once you have
installed the CA on them.

**1. Make `jukebox.lan` resolve on every device.** A phone can't edit a hosts
file, so the name has to come from your network's DNS. Add a local DNS record
`jukebox.lan` → the server's LAN IP in your router (often under *DNS*, *Local
DNS* or *Hostnames*), in Pi-hole (**Local DNS → DNS Records**) or in dnsmasq
(`address=/jukebox.lan/192.168.1.10`). Check from a laptop with
`nslookup jukebox.lan`. If your router can't do this, use Tailscale or DuckDNS
instead.

**2. Create the certificate** (Debian/Raspberry Pi OS:
`sudo apt install mkcert libnss3-tools`):

```bash
mkcert -install                       # create a local CA for your user, and trust it on this machine
mkcert jukebox.lan                    # → jukebox.lan.pem + jukebox.lan-key.pem in this folder
```

**3. Put the files where the proxy can read them.** mkcert writes the key
readable only by you, but Caddy runs as user `caddy`:

```bash
sudo install -m 644 jukebox.lan.pem /etc/ssl/jukebox.lan.pem
sudo install -o root -g caddy -m 640 jukebox.lan-key.pem /etc/ssl/jukebox.lan-key.pem   # nginx: -g root -m 600
```

Then reload the proxy (`sudo systemctl reload caddy`, or `nginx`).

**4. Protect the CA key.** `mkcert -CAROOT` shows the CA's folder. The
`rootCA-key.pem` in it must stay on this machine, readable only by you
(`chmod 600`). Whoever holds it can create a trusted certificate for **any**
website (your bank included) on every device that trusts this CA.

**5. Trust the CA on each phone and laptop.** Send them only `rootCA.pem`, e.g.
by AirDrop or mail, and remove it from the devices when you stop using it.

- **iOS:** open the file on the device, then **Settings → Profile Downloaded →
  Install**. Then go to **Settings → General → About → Certificate Trust
  Settings** and turn on full trust for it. Without that last step iOS still
  refuses the certificate.
- **Android:** **Settings → Security → Encryption & credentials → Install a
  certificate → CA certificate** (the menu names vary by vendor). Chrome trusts
  user-installed CAs for websites, so the service worker works. Firefox for
  Android ignores them unless you enable that in its settings. Installing the
  app from a site with a user-installed CA is less dependable than with a public
  certificate, so on Android Tailscale or DuckDNS is the smoother choice.

## Verifying offline launch

Test on the phone itself. The server's own browser proves nothing: `localhost`
already counts as secure there.

1. On the phone, open the app at its HTTPS address and add it to the home
   screen.
2. Open it **from the home screen** and let the collection load completely. On
   iOS a home-screen app has its own storage, separate from Safari, so data
   loaded in Safari doesn't count.
3. Turn on airplane mode, close the app completely and launch it from the home
   screen. It should open with the cached collection. Cabinet sync can't reach
   the server while offline; that is expected.

If step 3 fails, look closer (optional). In a desktop browser, open the developer
console. For an iPhone you need a Mac: turn on **Settings → Safari → Advanced →
Web Inspector** on the phone, connect it, and use Safari's **Develop** menu on the
Mac. Both of these should be `true`:

```js
isSecureContext
navigator.serviceWorker.controller !== null
```

The first is `false` when the page isn't on HTTPS (or the certificate isn't
trusted); the second is `false` until the service worker has taken over, which
happens on the second load.

Persistent storage is optional, and the app never asks for it on its own. To get
it, press **Request persistent storage** in Settings → Advanced.

## Next

- [operations.md](operations.md): what's stored where, and what to back up
- [troubleshooting.md](troubleshooting.md): a stale version after a deploy, and
  other failures
- Back to the overview: [docs/deploy/README.md](README.md)
