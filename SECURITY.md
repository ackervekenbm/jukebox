# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

- Use **Report a vulnerability** on the repository's **Security** tab (GitHub
  private vulnerability reporting).
- If that option isn't available, open an issue that only asks for a private
  contact, without any details of the problem.

You'll get an answer within a week. Fixes land on `main` and ship in the next
`ghcr.io/ackervekenbm/jukebox:latest` image; there are no older release lines
to patch.

## Scope and design notes

Jukebox is built to run on a home network for one household. Keep that in mind
when judging impact:

- **Discogs tokens** stay in the browser (localStorage). The server checks a
  token against Discogs on each sync request, remembers the answer for ten
  minutes in memory, and never writes tokens to disk or logs.
- **The `/discogs` proxy** forwards only `GET`/`HEAD` requests to the Discogs
  API, so the browser never calls Discogs cross-origin. It is not an open
  proxy to other hosts.
- **The sync store** (SQLite in `/app/data`) holds each user's record-cabinet
  layout, keyed by the Discogs username the token belongs to.
- **Plain HTTP** on the LAN is a supported setup. For anything reachable from
  outside your network, put it behind HTTPS (see
  [docs/deploy/https-and-offline.md](docs/deploy/https-and-offline.md)).

Reports about exposing the app directly to the internet without HTTPS are
expected behaviour, not vulnerabilities; reports about token leaks, the proxy
reaching other hosts, or one user reading or overwriting another user's sync
data are very welcome.
