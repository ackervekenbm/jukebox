# Jukebox

A React 19 + TypeScript + Vite progressive web app that renders a Discogs
collection from the user's personal access token. Collection data lives in the
browser (IndexedDB, localStorage, service-worker caches); a small Express
server inside the container serves the static app, the same-origin `/discogs`
proxy, and the `/api` sync store (SQLite) that backs cross-device features.

## Build, lint, verify

```bash
npm install       # install deps (uses package-lock.json, commit it)
npm run build     # = tsc --noEmit && eslint . && vite build && tsup (server)
npm test          # unit tests (vitest) — jsdom for client, node for server
```

Installs are **script-free**: `.npmrc` sets `ignore-scripts=true`.
`better-sqlite3` ships `prebuilds/<platform>.node`, so nothing needs compiling,
but npm would otherwise run its legacy implicit `node-gyp rebuild` on every
install (its lockfile metadata drops the package's `gypfile: false`), which
wants python3/make/g++ and discards the shipped binary. The Dockerfile relies on
this — keep the install toolchain-free. The consequence: a dependency that
genuinely needs an install/postinstall script cannot be added without revisiting
`.npmrc`; prefer packages that ship prebuilds or use optional platform packages
(esbuild does).

**Verification for every change is `npm run build && npm test`.** CI runs the
`check` job (`npm ci && npm run build && npm test`) on every PR, and a green
`check` is required to merge. There is no other test suite.

## Issue-first workflow (MANDATORY)

Before starting any new work item, create a GitHub issue:

```bash
gh issue create --title "<what>" --body "..."   # → gives an issue number
```

- Name the branch `fix/...`, `feat/...` or `chore/...` (one per issue).
- Put `Fixes #<n>` on its own line in the PR body so the issue auto-closes on merge.
- Stack branches only when fixes are directly related; otherwise branch off `main`.

## Git / PR conventions

- `main` is protected: **no direct pushes** — every change lands via a pull
  request and a **squash merge**. Required check: `check` (CI).
- After merging, GitHub auto-deletes the head branch (`delete-branch-on-merge` is on).
- Pattern: create branch → implement → `npm run build` → push → `gh pr create`
  → merge once `check` passes. Use `gh pr merge --squash` when asked to merge.
- **Never merge your own PR.** Ready PRs are handed over to a reviewer to merge;
  if the author merges, the other party reviews the squash only after the fact.
- Commit messages are imperative, single-paragraph (plus context lines), and
  reference the fix: `Fixes #<n>`.
- **Branch hygiene** — keep the workspace tidy:
  - Always branch off the latest `main` before starting new work.
  - After a PR lands (squash merged), GitHub auto-deletes the remote branch.
    Also delete the local branch afterwards:
    `git checkout main && git fetch --prune && git branch -D <branch>`.
  - Periodically prune stale local branches whose remotes are already gone:
    `git branch -vv` (look for `[origin/...: gone]`) or
    `git fetch --prune && git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | grep gone`. Keep the workspace down to `main` plus active work branches.

## Architecture

- `src/hooks/useCollection.ts` — load orchestration: stale-while-revalidate.
  Content-first: the release grid commits to the UI immediately; master-year
  enrichment runs in the background and streams in as each year arrives.
- `src/api/discogs.ts` — raw Discogs calls, ~60 req/min budget. Every call
  goes through the shared `discogsBudget` (`src/api/rateLimit.ts`): it reads
  `X-Discogs-Ratelimit-Remaining` from each answer, estimates how much of the
  moving minute has come back, and holds new requests before Discogs refuses
  them (background lookups keep a reserve of 10, so another device on the token
  doesn't push them into 429s and an opened record answers at once; requests
  the user waits for keep 2);
  a 429 pauses every caller for its `Retry-After` (or 5 s), and a refused token
  cancels the run's other lookups at once. Per-id lookups
  (`fetchEach`: master years, release notes) keep up to 6 in flight, start one
  every ~1.2 s, and report each result and progress as soon as it's back, so a
  slow or retried lookup only holds its own slot. `useDiscogsWait` turns a
  notable budget hold (a 429 pause, or a wait of 3 s or more) or 15 s without
  progress into a note on the progress text
  (sync banner, cabinet).
  All calls go through the same-origin `/discogs` proxy (vite dev forwards to
  the API server; the container runs it in Express) — the app must never call
  `api.discogs.com` cross-origin, because Discogs' 429s carry no CORS headers
  and the browser would mask throttling as an opaque CORS error.
- `src/server/` — Express API (TypeScript, skin-hq conventions: `tsx watch` in
  dev, `tsup` bundle in prod). `app.ts` = routes + static client + SPA fallback;
  `discogsProxy.ts` forwards `/discogs/*` (GET/HEAD only, rate-limit headers
  passed through); `auth.ts` verifies `Authorization: Discogs token=…` via
  Discogs `/oauth/identity` (10-min in-memory memo, tokens never stored);
  `db.ts` = better-sqlite3 (WAL) with the `cabinet_docs` sync table. Tests for
  routes live in `tests/` (node environment, supertest + temp `DATA_DIR`).
- `src/shared/cabinetDoc.ts` — zod schema + types for the sync document,
  imported by both server (validation) and client (types only, so zod never
  enters the browser bundle).
- `src/utils/cabinet.ts` — the shelf-layout engine (`planCabinet`): shelves
  sort exactly like the main view — always by artist (filing name), and inside
  an artist by the main view's Year or A–Z order (`CabinetSortMode` is
  `ArtistSortMode`), keeping artists together. It reuses the main view's sort
  rules (`compareReleases` / `sortYear` in `src/utils/collection.ts`:
  original year, undated last), so change ordering there, never in a second
  copy. A record credited to several artists is filed once, under the first.
  Size class (`sizeClassOf`) is judged per format of a release and only
  vinyl formats count: a vinyl format is 12" unless it states a smaller size,
  the largest wins (an LP with a bonus 7" is 12"), and a release with no vinyl
  — CD, cassette, file, a 3" CD — is "other". Optionally it keeps the sizes
  on separate shelves: each size group (ordered by its earliest record) gets
  its own run of shelves (`shelfShares`). Without room for that, as few
  neighbouring groups as possible share a run (`groupRuns`), one after the
  other, so only the shelf between two sizes is mixed. Each shelf lists its
  records in that planned order (size group, artist, Year/A–Z), never
  re-sorted on its own, so the shelves read straight through. `allocate`
  tries each arrangement with an equal spread, a spread in proportion to shelf
  size and shelf by shelf, back-fills, and keeps the best: fewest unplaced,
  then fewest out of order, then (sizes kept apart) fewest mixed shelves, then
  the first listed (the equal spread, so a working layout doesn't move). The
  last candidate is the plain size-apart layout or size-skipping walk over
  every record, so no record ends up unplaced that it would place. Records
  bigger than every shelf are left out up front.
  Shelf space (`spaceUnitsOf`): one per disc of the release's largest
  vinyl size (2×LP = 2; a bonus 7" in an LP adds nothing), or 2 for a
  gatefold, whichever is larger. Gatefold detection (`mentionsGatefold`)
  reads only vinyl formats — their descriptions and free `text` — and
  else the release **notes**; it knows other languages (Klappcover, pochette
  ouvrante, …) and skips denials ("not a gatefold", "unlike the original
  gatefold") and gatefold items ("gatefold poster"). The collection listing
  has no notes, so `src/hooks/useGatefoldNotes.ts` fetches `/releases/{id}`
  (the shared `fetchEach` pool in `src/api/discogs.ts`, same pacing as
  master years; a 401/403 stops the whole run) for single vinyl discs the user
  hasn't decided, only while the cabinet is open and the collection has
  loaded. It caches the notes **text**, not a yes/no, so improving the
  detector needs no refetch; the release-detail screen stores notes too. The
  user's own call (`sleeves` in the synced doc, release id → boolean) wins
  over detection and is dropped when it agrees with it again; the server keeps
  the stored calls when an older client saves without the field.
  A last pass back-fills records that found no room into any
  space left, which can put them on an earlier shelf than their place in the
  order. Conflicts: over-capacity, size-mix (one for the cabinet, only when
  sizes are kept apart), artist-split (per size run when sizes are kept
  apart), out-of-order (back-filled records) and unplaced. Layout is fully
  automatic — there are no manual pins.
- Record cabinet — `src/hooks/useCabinet.ts` orchestrates it: storage-first
  load from IndexedDB, debounced `PUT /api/sync/cabinet` when local changes are
  dirty, and a 409 rebase-and-retry when the server copy moved. Pushes run one
  at a time, and a push only marks the cabinet clean when no edit happened
  while it was in flight (an edit counter), so a quick second edit is never
  lost. Shelf ids are unique: the schema rejects duplicates and loading
  repairs them (`withUniqueSlotIds`), since older clients numbered shelves by
  count. Client sync
  lives in `src/api/sync.ts`; the screen is `src/components/CabinetScreen.tsx`.
  Storage-first and local-wins are the invariants: browser data is the
  source of truth and the server copy is only the cross-device echo.
- Discogs contract coverage — `scripts/refresh-discogs-fixtures.mjs` captures
  real payloads into `src/test/fixtures/discogs/` (`npm run fixtures`, needs
  `DISCOGS_TOKEN`). `src/api/discogs-contract.test.ts` replays them through the
  real parsers with `fetch` mocked (hermetic; skips when fixtures are absent),
  so `npm test` itself never touches the network. The nightly
  `discogs-contract` workflow refreshes fixtures on the runner with the
  `DISCOGS_TOKEN` secret and reruns the tests: red = Discogs changed a shape we
  parse (run `npm run fixtures`, fix the parser, commit the refreshed baseline).
  It commits nothing — the fixtures carry live, churning data (marketplace
  values, collection counts), so the committed copies are a frozen baseline for
  offline PR CI, not a mirror of the API.
- `src/db/database.ts` — one shared `openDB` connection for IndexedDB
  `vinyl-vault` (idb lib), seven stores: `collection` (1 row/username),
  `masterYears` (1 row), `collectionValue` (1 row/username), `releaseDetails`
  (unbounded tracklist cache — the app's main space grower), `listenLog`
  (random-pick history, capped at 200 entries/username), `cabinet` (one
  cabinet doc + revision/`dirty` flag per username) and `releaseSleeves`
  (release id → its notes text, for the gatefold check; kept for good). Bump
  `VERSION` there to invalidate caches after a shape change. Upgrades with
  other tabs open: `blocked` (an older tab holds the database) and `blocking`
  (a newer tab wants it; this one closes its connection) set a state that
  `useDatabaseState` turns into an app-wide banner. `src/db/collection.ts`,
  `src/db/listenLog.ts` and `src/db/cabinet.ts` are the typed store APIs;
  `settings.ts`, `views.ts`, `cabinetOptions.ts` and `picker.ts` in the same
  folder are the localStorage counterparts.
- `src/theme.ts` + `src/styles.css` — CSS-variable themes
  (`midnight`/`paper`/`club`/`forest`); new UI styles must use existing `--*`
  tokens, never hardcoded colors.
- PWA via `vite-plugin-pwa`: app-shell precache + `album-art` runtime cache
  (500 entries, 30-day expiry). `vite.config.ts`.

## Platform caveats (important)

- Served over **plain HTTP on LAN** (the container). IndexedDB and
  localStorage work over HTTP, but these are **secure-context-only** and must
  be feature-detected with graceful degradation: `navigator.storage.*`,
  `navigator.storage.persist()`, and the `caches` Cache API.
- iPhone home-screen install works over HTTP via legacy `apple-*` meta tags;
  the service worker (and therefore **offline** launch) needs HTTPS.
- Release-detail scrolling lock sets overflow on BOTH `<html>` and `<body>`
  (`document.body` alone is unreliable on iOS).

## Dependencies / Dependabot

- Dependabot majors stay **enabled** (we watch how often majors recur) — do not
  add `ignore` rules without the maintainer asking.
- One deliberate exception (issue #88): the `typescript` **major** is ignored in
  `.github/dependabot.yml` because TypeScript 7 (the native-compiler line) is
  outside typescript-eslint's `peer typescript <6.1.0` and would make the weekly
  group uninstallable. Patch/minor updates on the current line still land. Lift
  the ignore (and plan a deliberate TS6/7 migration) once typescript-eslint
  supports it.

## Deployment (internal)

User-facing deployment guides live in `docs/deploy/` — one file per route, with
`docs/deploy/README.md` as the decision guide and the shared port/env contract.
This section is the maintainer-specific runbook: when a port, environment
variable, image tag, the Dockerfile or a workflow changes, update
`docs/deploy/` too (and the README pointer).

The production host is a Raspberry Pi running **OpenMediaVault**. OMV's web UI
owns ports 80/443, so the app is exposed on host port **8080**. One container,
one node process: it serves the static build, the API and the `/discogs` proxy.
The SQLite DB lives in `/app/data`, bind-mounted into the Compose plugin's *Data*
shared folder (`CHANGE_TO_COMPOSE_DATA_PATH/jukebox-data`). It holds the synced
cabinet documents, so treat that folder as persistent user data. Backups and
restores: `docs/deploy/operations.md#backups`.

The host must run a 64-bit OS: the image is `amd64`/`arm64` only and
`better-sqlite3` has no `armv7` prebuild. Keep that prerequisite, and the docs'
port/env/tag tables, in sync with the workflow matrix and the Dockerfile.

- Every `main` push with app paths re-builds the multi-arch image and pushes
  `ghcr.io/ackervekenbm/jukebox:latest` (see `.github/workflows/docker-build.yml`).
  PRs touching the same paths run a **smoke job** first: build the image, boot
  it, poll `/api/health` and assert the PWA cache headers — the image only
  publishes when smoke passes. Publishing happens on `main` only: a manual
  (`workflow_dispatch`) run from another branch stops after smoke, so it can't
  overwrite `:latest`. The tag derives from `${{ github.repository }}`, so it
  follows repo renames.
- **GHCR pull.** The package is public, so the OMV plugin's **Pull** works
  anonymously. If a pull is ever denied, follow
  `docs/deploy/docker-image.md#if-a-pull-is-denied`; on this host the login
  user is `ackervekenbm`.
- **Route A — prebuilt image (production).** The stack is the one in
  `docs/deploy/openmediavault.md`: stack name `jukebox`, port `8080`, data in
  the *Data* shared folder, and a `logging:` cap on the container log (add it if
  the production stack predates it), plus the `proxy` network from
  `#caddy-on-omv` step 3. To update after a merge: **Services →
  Compose → Files** → `jukebox` → **Pull** → **Up**.
- **Route B — build on the Pi** (e.g. local variants): `docs/deploy/from-source-docker.md`.
  It uses the repo's `docker-compose.yml`, which keeps its data in the named
  volume `jukebox_jukebox-data`, **not** in Route A's bind folder. Switching
  routes starts on an empty DB unless you copy `jukebox.db` across
  (`docs/deploy/operations.md#moving-between-routes`).
- **HTTPS / offline**: home-screen install works over plain HTTP, but offline
  launch needs HTTPS with a device-trusted cert. Production runs **Caddy in its
  own Compose stack** (`caddy`) on host port **8443** (OMV holds 80/443): a
  Caddy image built with the DuckDNS module, a wildcard Let's Encrypt
  certificate via the DNS-01 challenge, one `handle` block per app, and the
  shared external Docker network `proxy` (upstream `jukebox:3000`). The
  generic steps are `docs/deploy/openmediavault.md#caddy-on-omv` and
  `docs/deploy/https-and-offline.md#caddy-in-docker`; host-specific values
  (names, IPs, DNS quirks) live in the maintainer's private `homelab` repo,
  not here. Keep `ports: 8080` on the `jukebox` stack: devices without the
  right DNS still use plain HTTP. Tailscale remains the documented
  alternative.