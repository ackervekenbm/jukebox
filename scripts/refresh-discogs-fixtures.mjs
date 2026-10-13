import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Captures real Discogs API payloads into src/test/fixtures/discogs/, where
// src/api/discogs-contract.test.ts replays them through the app's parsers
// with fetch mocked (hermetic CI: the test suite never touches the network).
//
// Usage:
//   DISCOGS_TOKEN=<personal access token> npm run fixtures [username]
//
// Defaults to the token owner's username (resolved via /oauth/identity); the
// collection/value endpoint requires the owner's token anyway. Requests are
// paced to stay inside the ~60 req/min budget and 429s are retried via
// Retry-After, like the app does.

const API = 'https://api.discogs.com'
const USER_AGENT = 'Jukebox/0.1 (+local personal collection viewer; fixture refresh)'
const OUT_DIR = fileURLToPath(new URL('../src/test/fixtures/discogs/', import.meta.url))
const PAGE_SIZE = 6

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function get(path, token) {
  const url = `${API}${path}`
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Discogs token=${token}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '') || 5
      console.log(`  429 on ${path}, waiting ${retryAfter}s`)
      await sleep((retryAfter + 1) * 1000)
      continue
    }
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
    return response.json()
  }
  throw new Error(`${url} -> gave up after repeated 429s`)
}

async function writeFixture(name, data) {
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`)
  console.log(`wrote ${name}`)
}

async function main() {
  const token = process.env.DISCOGS_TOKEN
  if (!token) {
    console.error('Usage: DISCOGS_TOKEN=<personal access token> npm run fixtures [username]')
    process.exit(1)
  }

  let user = process.argv[2]
  if (!user) {
    const identity = await get('/oauth/identity', token)
    user = identity.username
    console.log(`Resolved token owner: ${user}`)
  }

  const folders = await get(`/users/${encodeURIComponent(user)}/collection/folders`, token)
  await writeFixture('folders.json', folders)
  await sleep(1200)

  const collection = await get(
    `/users/${encodeURIComponent(user)}/collection/folders/0/releases?page=1&per_page=${PAGE_SIZE}`,
    token,
  )
  // A sample, not a faithful mirror: collapse the page to a single page so the
  // contract tests exercise one fetchCollection round-trip. The schema of
  // pagination + releases is unchanged.
  const sample = {
    pagination: {
      page: 1,
      pages: 1,
      per_page: collection.pagination.per_page,
      items: collection.releases.length,
    },
    releases: collection.releases,
  }
  await writeFixture('collection-page.json', sample)
  await sleep(1200)

  const value = await get(`/users/${encodeURIComponent(user)}/collection/value`, token)
  await writeFixture('collection-value.json', value)
  await sleep(1200)

  const masterIds = [
    ...new Set(
      collection.releases
        .map((release) => release.basic_information?.master_id)
        .filter((id) => typeof id === 'number'),
    ),
  ].slice(0, 2)

  for (const id of masterIds) {
    try {
      const master = await get(`/masters/${id}`, token)
      await writeFixture(`master-${id}.json`, master)
    } catch (error) {
      console.warn(`skipping master ${id}: ${error.message}`)
    }
    await sleep(1200)
  }

  const releaseId = collection.releases[0]?.id
  if (releaseId === undefined) {
    console.log('No releases in the sample; nothing more to fetch.')
    return
  }

  const release = await get(`/releases/${releaseId}`, token)
  // The parser only reads id/title/year/tracklist, so keep the fixture lean.
  await writeFixture(
    `release-${releaseId}.json`,
    { id: release.id, title: release.title, year: release.year, tracklist: release.tracklist },
  )

  console.log('Done. `git diff src/test/fixtures/discogs` shows what changed.')
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})