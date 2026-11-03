# Jukebox

Browse your personal **Discogs collection** on any device — grouped by artist (optionally stacking every pressing of a master into one card) or as a recently-added timeline, sorted the way you want, searchable, filterable, and available offline. It's an installable web app that runs entirely in your browser: fetch your collection once and it's yours.

## What it can do

- **Your collection, beautifully browsed** — the collection is fetched from the Discogs API and shown as a cover-art grid grouped by artist. Split/collaboration releases are cross-listed under every credited artist (compilations stay under **Various**), and Discogs' disambiguation suffixes are stripped, so **Alice Cooper (2)** groups and searches under **Alice Cooper**.
- **Filing sort** — leading articles (`a`, `an`, `the`) are ignored when sorting, so **The Menzingers** files under **M**. Diacritics and punctuation are normalized too (`Motörhead` → `motorhead`).
- **Sort within an artist** — toggle between **Year** (oldest → newest by original release year, default; records without a year come last) and **A–Z** per artist; click any artist header to collapse or expand its shelf.
- **Group pressings by master** — an optional setting (off by default) collapses every pressing of the same Discogs master into one plain card whose corner chip reads `3 pressings` (or `3 copies` for duplicates of a single pressing) with a vinyl icon. The card keeps a plain card's footprint, so shelf rows stay even, and opening it steps through the pressings with ‹ / › buttons or the arrow keys. Releases without a master group by release id.
- **Recently added view** — the **Recent** toggle turns the grid into a timeline: month-by-month sections (newest first, bucketed in your local time) of everything you've added, with the artist credited on every card since there are no shelves to hang them from. Search and filters still apply, releases without a usable date land in a final **Undated** section instead of vanishing, and the year/A–Z sort steps aside — it costs no extra API calls, because it only reads timestamps the collection already cached.
- **Summary & unique albums** — running totals of `N artists · M releases · U unique albums`, and every artist header shows its own counts. *Unique albums* counts distinct masters (a release id when a master is missing), so several pressings of the same album count once — the same rule the pressings grouping uses.
- **Search & filter** — debounced search across artist, title, genre, style, label and year; filters for format, genre, style, label and year range, all populated from your actual data.
- **Saved views (smart lists)** — save any search + filter combination under a name (**7-inch singles**, **90s techno**) and switch back to it in one tap from the toolbar. Each view shows how many releases it matches *right now*, and can be renamed, updated or deleted; touching the search box or filters marks the view as changed, with a one-tap **update** or **revert**. A view captures the search box and filters only — your folder and sort preference stay as you left them.
- **Collection folders** — a folder bar above the search: pick a Discogs folder (or **All**) and the search, filters, summary and grids all follow it. The whole collection is fetched once, so switching folders is instant.
- **Record cabinet** — the cabinet icon in the header opens a full-screen planner for the physical shelf. Add shelves, set how much each holds and let the app lay your collection out automatically: shelves file artists in the same order as the main view, and within each artist use the same **Year** or **A–Z** order you can pick there. Shelf space is counted realistically: a double LP takes two spaces, and so does a gatefold sleeve — found in the format or, when only the release notes mention it (in English or the usual German, French, Italian, Spanish, Dutch and Japanese words), by checking those notes once in the background while the cabinet is open. Each vinyl record has a **Gatefold** button to correct the call; a correction of yours is marked "you", and syncs across your devices. An optional mode keeps 12" records and 7"/10" singles on shelves of their own (vinyl counts as 12" unless Discogs states a smaller size, so an LP with a bonus 7" is still a 12"; CDs and tapes get their own group). Shelf sizes go from 1 to 500 records; remove a shelf by mistake and **Undo** puts it back, or remove every shelf to start the layout over. It warns when the layout can't follow its own rules: sizes that have to share a shelf, an artist split across shelves, records filed out of order because the shelves are nearly full, a shelf over capacity, or records that fit nowhere. The plan syncs across your devices through the app's server, so the same cabinet follows you from phone to laptop.
- **Release details** — click any cover for an overlay with everything we have: original/pressing years, format, label + catno, genres/styles, credits, country, rating, added date and direct Discogs links.
- **Tracklists** — the detail view also lists the full tracklisting, loaded per release on demand and cached in the browser, so it's instant on reopening and works offline.
- **Random picker** — can't decide what to listen to? A floating shuffle button picks from the current folder (respecting any active search/filters); with a release open, it re-rolls to a new random pick. Every pick is remembered in a local **listen log** (the last 200 per account) and the picker skips your most recent picks, so it won't hand you the same record twice — how many to skip is yours to choose in settings (0–100, default 10), and the window shrinks gracefully on small collections rather than running out of options. Opened from the picker, the detail view lists the last few picks with relative timestamps, so you can hop back to an earlier one without it counting as a new listen.
- **4 UI styles** — **Midnight** (dark navy), **Paper** (warm light), **Club** (neon dark) or **Forest** (mossy dark) in settings; your choice is remembered.
- **Instant & offline** — pages are fetched from Discogs at a pace that stays inside their rate limit, then cached in the browser: later visits show the collection instantly and refresh it quietly in the background. Add the app to your home screen and use it like a native app.

## What you need

- A free **Discogs personal access token** — create one at <https://www.discogs.com/settings/developers>.
- That's it. There's no account, no sign-up and nothing to install on your devices — the app runs in your browser and your data stays there (see [Where your data lives](#where-your-data-lives)).

## How it works

1. **Set up** — enter your Discogs username and personal access token once.
2. **Fetch** — the app pulls your collection from the Discogs API, paged and paced to stay well inside their 60 requests/minute limit, retrying automatically if the API asks us to slow down.
3. **Browse instantly** — the collection is saved in your browser, so it opens instantly next time — even offline — and quietly re-checks Discogs in the background for changes.
4. **Dive deeper** — original release years are enriched in the background from each album's Discogs master record, streaming in as results arrive, so you gradually see original-year and pressing-year where they differ.
5. **Details on demand** — opening a release shows everything on hand; the full tracklist is fetched per release and cached after first view.

> **For the technical reader:** all API calls go through a same-origin `/discogs` proxy owned by the app's Express server (the vite dev server forwards to it; the Docker container runs it). Discogs rate-limit responses carry no CORS headers, so without that proxy the browser would mask throttling as an opaque CORS error instead of a retryable response.

## Where your data lives

- Your **token is stored in your browser** (localStorage). Every Discogs API request goes through your own Jukebox server (cover art loads straight from Discogs, without the token), which forwards the token to Discogs; the server doesn't store or log it, and keeps only a hash of it for ten minutes to check sync requests. Over plain HTTP the token crosses your network unencrypted on each request, so [use HTTPS](docs/deploy/https-and-offline.md) if you don't trust the network. Anyone with access to your device could extract it — regenerate it anytime at <https://www.discogs.com/settings/developers>.
- The **collection, tracklists, cached years and pick history live in your browser** (IndexedDB). Saved views, the listen log and settings are localStorage. Browser data is the source of truth for all of it.
- The server keeps a small **SQLite database in its data directory** (a Docker volume or a folder, depending on how you run it) with your **record cabinet layout**, keyed by your Discogs username, so it can sync across devices ([#55](https://github.com/ackervekenbm/jukebox/issues/55)). The layout includes which release sits on which shelf, so the database and its backups do contain the release ids in your collection. Titles, artists, covers and tracklists stay in your browser.
- **"Clear everything"** in settings removes the cached collection, your saved views, the listen log, the picker preference, the cabinet layout and stored credentials from your device.

## Deployment

Jukebox is **one Node process**: it serves the built client, the `/api` sync store and the same-origin `/discogs` proxy. It runs anywhere Node 22+ or Docker does, on a 64-bit OS.

| Route | Good for |
| --- | --- |
| [Prebuilt Docker image](docs/deploy/docker-image.md) | Anything with Docker — multi-arch (`amd64`/`arm64`), no build, easy updates and rollback |
| [Docker, built from a checkout](docs/deploy/from-source-docker.md) | You want to patch it yourself, or can't pull an image |
| [Bare Node](docs/deploy/from-source-node.md) | A host that already runs Node 22+ (systemd + optional reverse proxy) |
| [OpenMediaVault](docs/deploy/openmediavault.md) | The OMV Compose plugin (ports 80/443 are OMV's, so 8080) |

Prerequisites, the shared port/environment contract, TLS and offline launch, backups, updates, rollback and troubleshooting live in **[docs/deploy/](docs/deploy/README.md)**.

Quickest start, on any machine with Docker:

```bash
docker run -d --name jukebox -p 8080:3000 -v jukebox-data:/app/data \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  --restart unless-stopped ghcr.io/ackervekenbm/jukebox:latest
```

The image is public (no `docker login` needed) and built for `amd64`/`arm64`
only — an ARM board needs a 64-bit OS.

Then open <http://localhost:8080>. Four things hold for every route:

- **Keep it on your LAN or tailnet.** Jukebox has no login, so don't expose it to the internet ([why](docs/deploy/README.md#keep-it-on-your-lan-or-tailnet)).
- **Keep the data directory** (`/app/data` in the image). It holds the only server-side state, a small SQLite database with the cabinet layout. Everything else lives in your browser: collection, tracklists, saved views and settings. Updating is lossless as long as the new container or process uses the same data. Each route keeps it in a different place, so check [where yours is](docs/deploy/operations.md#find-your-data-first) before you back up or switch routes.
- **Serve it through the app's server.** The browser must reach Discogs through the same-origin `/discogs` proxy; serving `dist/` from a plain static server makes collection fetches fail with CORS/rate-limit noise (see the note under *How it works*).
- **Offline launch needs HTTPS.** Over plain HTTP the app works and installs to the home screen on iOS, but the service worker that lets it open with the server down only runs over HTTPS, with a certificate the device trusts. See [HTTPS & offline](docs/deploy/https-and-offline.md) for Tailscale, Let's Encrypt via DuckDNS, and mkcert.

## Development

**Tech stack** — React 19 · TypeScript · Vite · idb (IndexedDB) · vite-plugin-pwa (service worker + manifest) · Express + better-sqlite3 (container: static host, `/discogs` proxy, sync API).

**Requirements** — Node.js **22+**, plus a Discogs token if you want to test against a real collection.

**Quick start**

```bash
npm install
npm run dev
```

Open <http://localhost:5199> (if the port is taken, Vite moves to the next free one and prints the address). `npm run dev` starts both the API server (port 3000) and the Vite dev server; Vite proxies `/discogs` and `/api` to it, exactly like production.

**Scripts**

| Command | Purpose |
| --- | --- |
| `npm run dev` | API server + Vite dev server together (hot reload) |
| `npm run dev:server` / `dev:client` | Just one side of the above |
| `npm run build` | Type-check, lint, then production build of client (`dist/`) and server (`dist-server/`) |
| `npm start` | Run the built server (after `npm run build`) |
| `npm run preview` | Serve the production client build locally (no API) |
| `npm test` / `npm run test:watch` | Unit tests (vitest — jsdom for client, node for API route tests) |
| `npm run lint` / `lint:fix` | ESLint (flat config) |
| `npm run icons` | Regenerate app icons from `public/icons/icon.svg` |

**Verify a change**

```bash
npm run build && npm test
```

**Project structure**

```
├── Dockerfile / docker-compose.yml                  # containerized hosting (one Node process)
├── docs/deploy/                                     # deployment guides: one file per route + operations
├── .github/
│   ├── workflows/
│   │   ├── ci.yml             # PR checks (type-check + lint + build + tests)
│   │   └── docker-build.yml   # smoke-test, then publish multi-arch image to GHCR
│   └── dependabot.yml         # weekly dependency-update PRs
├── eslint.config.js                               # ESLint flat config
├── index.html                                     # app shell + PWA/iOS meta tags
├── vite.config.ts                                 # build, dev proxy + PWA configuration
├── tests/                                         # API route tests (vitest, node, supertest)
├── public/                                        # icons (192, 512, maskable), favicon, apple-touch-icon
├── scripts/gen-icons.mjs                          # icon generator
└── src/
    ├── api/discogs.ts                             # Discogs client (proxy base, pacing, retries)
    ├── api/sync.ts                                # cabinet sync client (GET/PUT /api/sync/cabinet, 409 rebase)
    ├── server/                                    # Express API: sync store, Discogs proxy, health, static+SPA
    ├── shared/cabinetDoc.ts                       # sync document schema (server validates, client types)
    ├── db/                                        # IndexedDB stores (collection, tracklists, listen log, cabinet) + localStorage settings/views/picker
    ├── hooks/                                     # useCollection (sync lifecycle), useCabinet (cabinet), useReleaseTracklist, useScrollLock
    ├── utils/                                     # sortName (filing sort keys), collection (group/filter/shape), cabinet (shelf planner)
    ├── test/setup.ts                              # vitest setup
    ├── types/discogs.ts                           # Discogs API types
    ├── theme.ts + styles.css                      # CSS-variable themes + all styles
    └── components/                                # Settings, ReleaseCard, SearchBar, FilterMenu, ReleaseDetail, ArtistSection, StorageStats, …
```

---

## License

Jukebox is free software licensed under the **GNU Affero General Public License v3.0 or later** (`AGPL-3.0-or-later`) — see [`LICENSE`](LICENSE) for the full text. Source-file headers carry the matching `SPDX-License-Identifier: AGPL-3.0-or-later` tag.

In short: you are free to use, study, share and modify this software, and if you run it as a network service (for example hosting the app for others), you must offer the corresponding source code to its users.

---

This README is part of the repo and is kept in sync as the app evolves — when features, commands, or structure change, this file is updated to match.