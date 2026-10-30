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
  enrichment runs in the background and streams in batches.
- `src/api/discogs.ts` — raw Discogs calls, ~60 req/min budget. Master-year
  fetch uses staggered batches of 6 + 6.6s pauses; 429s retry via `Retry-After`.
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
  follow the selected artist/title/year order, keeping artists together.
  Optionally it groups 12" and 7"/10" onto separate shelves (size class read
  from each release's format text); that mode orders the size groups by their
  earliest record so the cabinet still starts with the earliest artist. It
  counts a gatefold sleeve as two capacity spaces and reports size-mix /
  artist-split / unplaced conflicts. Layout is fully automatic — there are no
  manual pins.
- Record cabinet — `src/hooks/useCabinet.ts` orchestrates it: storage-first
  load from IndexedDB, debounced `PUT /api/sync/cabinet` when local changes are
  dirty, and a 409 rebase-and-retry when the server copy moved. Client sync
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
  `vinyl-vault` (idb lib), six stores: `collection` (1 row/username),
  `masterYears` (1 row), `collectionValue` (1 row/username), `releaseDetails`
  (unbounded tracklist cache — the app's main space grower), `listenLog`
  (random-pick history, capped at 200 entries/username) and `cabinet` (one
  cabinet doc + revision/`dirty` flag per username). Bump `VERSION` there
  to invalidate caches after a shape change. `src/db/collection.ts`,
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

The production host is a Raspberry Pi running **OpenMediaVault**. OMV's web UI
owns ports 80/443, so the app is exposed on host port **8080**. One container,
one node process: it serves the static build, the API and the `/discogs` proxy.
The container has a named volume for its SQLite DB (`/app/data`) — today that
holds only the (empty) cabinet-sync table, but the deployment is no longer
stateless, so treat the volume as persistent user data.

- Every `main` push with app paths re-builds the multi-arch image and pushes
  `ghcr.io/ackervekenbm/jukebox:latest` (see `.github/workflows/docker-build.yml`).
  PRs touching the same paths run a **smoke job** first: build the image, boot
  it, poll `/api/health` and assert the PWA cache headers — the image only
  publishes when smoke passes. The tag derives from
  `${{ github.repository }}`, so it follows repo renames.
- **GHCR login (one-time per host).** GHCR requires a login even for public
  images. Log in over SSH:
  ```bash
  sudo docker login ghcr.io -u ackervekenbm
  ```
  The password is a GitHub **classic** personal access token (fine-grained
  tokens don't support GitHub Packages). Create one at
  https://github.com/settings/tokens → *Tokens (classic)* → tick `read:packages`
  (add `repo` too if you also `git pull` on the Pi with the same token). Keep
  the expiry to ≤1 year and re-login when it lapses — a classic token can reach
  everything your account can, so never paste it anywhere public.
- **Route A — prebuilt image (all via the OMV web UI, no building on the Pi).**
  With omv-extras installed and Docker + the Compose plugin enabled
  (Services → Compose): create a compose file `jukebox.yml`:
  ```yaml
  services:
    jukebox:
      image: ghcr.io/ackervekenbm/jukebox:latest
      container_name: jukebox
      ports:
        - "8080:3000"
      volumes:
        - jukebox-data:/app/data
      restart: unless-stopped

  volumes:
    jukebox-data:
  ```
  Save → select it → **Up** (creates/starts the container; open
  `http://<pi-ip>:8080`). To update after a merge: select → **Pull** → **Up**
  (an unchanged image is a no-op; the volume keeps the sync DB). If **Pull**
  fails with an auth error, redo the SSH login first. The app is plain HTTP:
  a normal phone refresh picks up the new build (the server sends
  `Cache-Control: no-cache` for `index.html`); force-refresh once if a tab
  looks stale.
- **Route B — build on the Pi** (e.g. local variants):
  ```bash
  cd ~
  git clone https://github.com/ackervekenbm/jukebox.git && cd jukebox
  sudo docker compose up -d --build
  ```
  Update later with `git pull && sudo docker compose up -d --build`.
- **Offline / iPhone over HTTP** — home-screen install works over plain HTTP via
  the legacy `apple-*` meta tags; the service worker (and therefore offline
  launch) needs HTTPS with a device-trusted cert. Options live in the README's
  *Deployment* section.