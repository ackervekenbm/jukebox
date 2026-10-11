# Vinyl Vault

A React 19 + TypeScript + Vite progressive web app that renders a Discogs
collection from the user's personal access token. All data lives in the
browser (IndexedDB, localStorage, service-worker caches); there is no backend.

## Build, lint, verify

```bash
npm install       # install deps (uses package-lock.json, commit it)
npm run build     # = tsc --noEmit && eslint . && vite build
npm test          # unit tests (vitest, jsdom) — @testing-library/react
```

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
  All calls go through the same-origin `/discogs` proxy (vite dev + nginx) —
  the app must never call `api.discogs.com` cross-origin, because Discogs' 429s
  carry no CORS headers and the browser would mask throttling as an opaque
  CORS error.
- `src/db/database.ts` — one shared `openDB` connection for IndexedDB
  `vinyl-vault` (idb lib), five stores: `collection` (1 row/username),
  `masterYears` (1 row), `collectionValue` (1 row/username), `releaseDetails`
  (unbounded tracklist cache — the app's main space grower) and `listenLog`
  (random-pick history, capped at 200 entries/username). Bump `VERSION` there
  to invalidate caches after a shape change. `src/db/collection.ts` and
  `src/db/listenLog.ts` are the typed store APIs; `settings.ts`, `views.ts`
  and `picker.ts` in the same folder are the localStorage counterparts.
- `src/theme.ts` + `src/styles.css` — CSS-variable themes
  (`midnight`/`paper`/`club`/`forest`); new UI styles must use existing `--*`
  tokens, never hardcoded colors.
- PWA via `vite-plugin-pwa`: app-shell precache + `album-art` runtime cache
  (500 entries, 30-day expiry). `vite.config.ts`.

## Platform caveats (important)

- Served over **plain HTTP on LAN** (nginx in the container). IndexedDB and
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

## Deployment (internal)

The production host is a Raspberry Pi running **OpenMediaVault**. OMV's web UI
owns ports 80/443, so the app is exposed on host port **8080**. The container is
stateless (nginx serving the static build + the `/discogs` proxy) — every user's
data lives in the browser, so any redeploy is lossless and no volumes are needed.

- Every `main` push with app paths re-builds the multi-arch image and pushes
  `ghcr.io/ackervekenbm/vinyl-vault:latest` (see `.github/workflows/docker-build.yml`).
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
  (Services → Compose): create a compose file `vinyl-vault.yml`:
  ```yaml
  services:
    vinyl-vault:
      image: ghcr.io/ackervekenbm/vinyl-vault:latest
      container_name: vinyl-vault
      ports:
        - "8080:80"
      restart: unless-stopped
  ```
  Save → select it → **Up** (creates/starts the container; open
  `http://<pi-ip>:8080`). To update after a merge: select → **Pull** → **Up**
  (an unchanged image is a no-op). If **Pull** fails with an auth error, redo
  the SSH login first. The app is plain HTTP: a normal phone refresh picks up
  the new build (nginx never caches `index.html`); force-refresh once if a tab
  looks stale.
- **Route B — build on the Pi** (e.g. local variants):
  ```bash
  cd ~
  git clone https://github.com/ackervekenbm/vinyl-vault.git && cd vinyl-vault
  sudo docker compose up -d --build
  ```
  Update later with `git pull && sudo docker compose up -d --build`.
- **Offline / iPhone over HTTP** — home-screen install works over plain HTTP via
  the legacy `apple-*` meta tags; the service worker (and therefore offline
  launch) needs HTTPS with a device-trusted cert. Options live in the README's
  *Deployment* section.