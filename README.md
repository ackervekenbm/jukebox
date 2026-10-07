# Vinyl Vault

Browse your personal **Discogs collection** on any device — grouped by artist, by album, or as a recently-added timeline, sorted the way you want, searchable, filterable, and available offline. It's an installable web app that runs entirely in your browser: fetch your collection once and it's yours.

## What it can do

- **Your collection, beautifully browsed** — the collection is fetched from the Discogs API and shown as a cover-art grid grouped by artist. Split/collaboration releases are cross-listed under every credited artist (compilations stay under **Various**), and Discogs' disambiguation suffixes are stripped, so **Alice Cooper (2)** groups and searches under **Alice Cooper**.
- **Filing sort** — leading articles (`a`, `an`, `the`) are ignored when sorting, so **The Menzingers** files under **M**. Diacritics and punctuation are normalized too (`Motörhead` → `motorhead`).
- **Sort within an artist** — toggle between **Year** (oldest → newest, default) and **A–Z** per artist; click any artist header to collapse or expand its shelf.
- **Artists / Albums view** — a toggle in the toolbar flips the grid to one card per album: every pressing of the same Discogs master collapses together, badged `3 pressings`, with each pressing listed on the card (year, country, format, label). The card opens the earliest pressing, a listed row opens that exact one, long lists collapse behind **+N more**, and duplicate copies of one pressing count as `×N copies` instead of repeating. Releases without a master group by release id. Artist shelves and the summary line keep counting in pressings either way, so the totals never change when you flip views.
- **Recently added view** — a third option turns the grid into a timeline: month-by-month sections (newest first, bucketed in your local time) of everything you've added, with the artist credited on every card since there are no shelves to hang them from. Search and filters still apply, releases without a usable date land in a final **Undated** section instead of vanishing, and the year/A–Z sort steps aside — it costs no extra API calls, because it only reads timestamps the collection already cached.
- **Summary & unique albums** — running totals of `N artists · M releases · U unique albums`, and every artist header shows its own counts. *Unique albums* counts distinct masters (a release id when a master is missing), so several pressings of the same album count once — the same rule the Albums view groups by.
- **Search & filter** — debounced search across artist, title, genre, style, label and year; filters for format, genre, style, label and year range, all populated from your actual data.
- **Saved views (smart lists)** — save any search + filter combination under a name (**7-inch singles**, **90s techno**) and switch back to it in one tap from the toolbar. Each view shows how many releases it matches *right now*, and can be renamed, updated or deleted; touching the search box or filters marks the view as changed, with a one-tap **update** or **revert**. A view captures the search box and filters only — your folder and sort preference stay as you left them.
- **Collection folders** — a folder bar above the search: pick a Discogs folder (or **All**) and the search, filters, summary and grids all follow it. The whole collection is fetched once, so switching folders is instant.
- **Release details** — click any cover for an overlay with everything we have: original/pressing years, format, label + catno, genres/styles, credits, country, rating, added date and direct Discogs links.
- **Tracklists** — the detail view also lists the full tracklisting, loaded per release on demand and cached in the browser, so it's instant on reopening and works offline.
- **Random picker** — can't decide what to listen to? A floating shuffle button picks from the current folder (respecting any active search/filters); with a release open, it re-rolls to a new random pick.
- **4 UI styles** — **Midnight** (dark navy), **Paper** (warm light), **Club** (neon dark) or **Forest** (mossy dark) in settings; your choice is remembered.
- **Instant & offline** — pages are fetched from Discogs at a pace that stays inside their rate limit, then cached in the browser: later visits show the collection instantly and refresh it quietly in the background. Add the app to your home screen and use it like a native app.

## What you need

- A free **Discogs personal access token** — create one at <https://www.discogs.com/settings/developers>.
- That's it. There's no account, no server and nothing to install — the app runs entirely in your browser and your data stays there (see [Where your data lives](#where-your-data-lives)).

## How it works

1. **Set up** — enter your Discogs username and personal access token once.
2. **Fetch** — the app pulls your collection from the Discogs API, paged and paced to stay well inside their 60 requests/minute limit, retrying automatically if the API asks us to slow down.
3. **Browse instantly** — the collection is saved in your browser, so it opens instantly next time — even offline — and quietly re-checks Discogs in the background for changes.
4. **Dive deeper** — original release years are enriched in the background from each album's Discogs master record, streaming in as results arrive, so you gradually see original-year and pressing-year where they differ.
5. **Details on demand** — opening a release shows everything on hand; the full tracklist is fetched per release and cached after first view.

> **For the technical reader:** all API calls go through a same-origin `/discogs` proxy (the vite dev server, and nginx in the Docker image). Discogs rate-limit responses carry no CORS headers, so without that proxy the browser would mask throttling as an opaque CORS error instead of a retryable response.

## Where your data lives

- Your **token stays in your browser** (localStorage). It's sent to Discogs and nowhere else. Anyone with access to your device could extract it — regenerate it anytime at <https://www.discogs.com/settings/developers>.
- The **collection, tracklists and cached years live in your browser** (IndexedDB). Nothing is stored on a server — the deployment is completely stateless.
- **Saved views** are stored in the browser too (localStorage), as plain filter definitions — no account, no API calls.
- **"Clear everything"** in settings removes the cached collection, your saved views and stored credentials from your device.

## Deployment (production)

The app is a static frontend; the published container bundles it with nginx. Every push to `main` builds a multi-arch image for **amd64 and arm64** and publishes one tag: `ghcr.io/ackervekenbm/vinyl-vault:latest`.

**Pull and run** on any machine with Docker (arm64 runs natively on a Raspberry Pi):

```yaml
services:
  vinyl-vault:
    image: ghcr.io/ackervekenbm/vinyl-vault:latest
    ports:
      - "8080:80"
    restart: unless-stopped
```

**Or build from source:**

```bash
docker compose up --build    # serves on http://localhost:8080
```

Notes for self-hosting:

- The container is **stateless** — all user data lives in the browser, so updates and redeploys are lossless (`docker compose pull && docker compose up -d`).
- The nginx image **proxies `/discogs` → `api.discogs.com`**. If you serve the static files some other way, you must replicate that proxy or API calls will run into Discogs' CORS/rate-limit wall (see the note under *How it works*).
- **Offline launch needs HTTPS.** Over plain HTTP, iOS adds the app to the home screen fine (it honors the legacy `apple-*` meta tags) and the app runs as long as the server is up — but the service worker that allows launching with the server down only registers in a secure context, and the certificate must be one the device trusts. From least to most setup:

  | Approach | What's needed | Notes |
  | --- | --- | --- |
  | **mkcert — your own local CA** | Install your CA profile once on each device | Fully self-hosted and offline; no external party involved |
  | **Domain + Let's Encrypt** (DuckDNS + Caddy/nginx) | A free domain and a TLS reverse proxy; use the **DNS-01** challenge so no ports need to be opened | Public CA, so devices trust it with zero setup |
  | **Tailscale** | Tailscale on the server and your devices | Free, auto-renewing Let's Encrypt certs on your private tailnet via `tailscale serve` |

> The maintainer runs this at home on an OpenMediaVault box — the detailed step-by-step ops runbook lives in `AGENTS.md`.

## Development

**Tech stack** — React 19 · TypeScript · Vite · idb (IndexedDB) · vite-plugin-pwa (service worker + manifest) · nginx (container host + API proxy).

**Requirements** — Node.js **22+**, plus a Discogs token if you want to test against a real collection.

**Quick start**

```bash
npm install
npm run dev
```

Open <http://localhost:5199> (if the port is taken, Vite moves to the next free one and prints the address). The dev server proxies `/discogs` to the Discogs API, just like nginx does in production.

**Scripts**

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check, lint, then production build to `dist/` (also regenerates the PWA service worker + manifest) |
| `npm run preview` | Serve the production build locally |
| `npm test` / `npm run test:watch` | Unit tests (vitest + jsdom, @testing-library/react) |
| `npm run lint` / `lint:fix` | ESLint (flat config) |
| `npm run icons` | Regenerate app icons from `public/icons/icon.svg` |

**Verify a change**

```bash
npm run build && npm test
```

**Project structure**

```
├── Dockerfile / docker-compose.yml / nginx.conf   # containerized hosting (nginx + /discogs proxy)
├── .github/
│   ├── workflows/
│   │   ├── ci.yml             # PR checks (type-check + lint + build + tests)
│   │   └── docker-build.yml   # publish multi-arch image to GHCR
│   └── dependabot.yml         # weekly dependency-update PRs
├── eslint.config.js                               # ESLint flat config
├── index.html                                     # app shell + PWA/iOS meta tags
├── vite.config.ts                                 # build, dev proxy + PWA configuration
├── public/                                        # icons (192, 512, maskable), favicon, apple-touch-icon
├── scripts/gen-icons.mjs                          # icon generator
└── src/
    ├── api/discogs.ts                             # Discogs client (proxy base, pacing, retries)
    ├── db/                                        # settings (localStorage) + IndexedDB collection cache
    ├── hooks/                                     # useCollection (sync lifecycle), useReleaseTracklist, useScrollLock
    ├── utils/                                     # sortName (filing sort keys), collection (group/filter/shape)
    ├── test/setup.ts                              # vitest setup
    ├── types/discogs.ts                           # Discogs API types
    ├── theme.ts + styles.css                      # CSS-variable themes + all styles
    └── components/                                # Settings, ReleaseCard, SearchBar, FilterMenu, ReleaseDetail, ArtistSection, StorageStats, …
```

---

This README is part of the repo and is kept in sync as the app evolves — when features, commands, or structure change, this file is updated to match.