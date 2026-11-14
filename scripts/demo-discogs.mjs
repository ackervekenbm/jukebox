// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

/**
 * A stand-in for the Discogs API with an invented collection and generated
 * cover art, for demos and README screenshots. Nothing here is a real record.
 *
 *   node scripts/demo-discogs.mjs            # listens on 127.0.0.1:3999
 *   DISCOGS_API_BASE=http://127.0.0.1:3999 npm run dev
 *
 * Then sign in with username "demo" and any token.
 */
import http from 'node:http'

const PORT = Number(process.env.DEMO_PORT ?? 3999)
const BASE = `http://127.0.0.1:${PORT}`
const USER = 'demo'

// [artist, title, year, format, genre, style]
// format: LP | 2LP | GF (gatefold LP) | 7 | 10 | CD
const RECORDS = [
  ['Amber Satellites', 'Low Orbit Lullabies', 1977, 'GF', 'Rock', 'Prog Rock'],
  ['Amber Satellites', 'Signal Fade', 1979, 'LP', 'Rock', 'Prog Rock'],
  ['Amber Satellites', 'Re-entry', 1983, '2LP', 'Rock', 'Art Rock'],
  ['Amber Satellites', 'Parallax Garden', 1986, 'LP', 'Rock', 'Art Rock'],
  ['Amber Satellites', 'Halo Drive', 1986, '7', 'Rock', 'Art Rock'],
  ['Amber Satellites', 'Glass Horizon', 1990, 'CD', 'Rock', 'Prog Rock'],
  ['The Bellwether Choir', 'Hymns for Highways', 1968, 'LP', 'Folk, World, & Country', 'Folk Rock'],
  ['The Bellwether Choir', 'Dust & Daylight', 1971, 'GF', 'Folk, World, & Country', 'Folk Rock'],
  ['The Bellwether Choir', 'Lanterns on the Ridge', 1973, 'LP', 'Folk, World, & Country', 'Folk Rock'],
  ['The Bellwether Choir', 'Old Roads, New Maps', 1975, '2LP', 'Folk, World, & Country', 'Country Rock'],
  ['Cassia Moreno', 'Saudade Machine', 1974, 'LP', 'Latin', 'Bossa Nova'],
  ['Cassia Moreno', 'Noites de Neon', 1976, 'LP', 'Latin', 'MPB'],
  ['Cassia Moreno', 'Água Viva', 1976, '7', 'Latin', 'MPB'],
  ['Copper Lantern', 'Midnight at the Foundry', 1959, '10', 'Jazz', 'Hard Bop'],
  ['Copper Lantern', 'Blue Rivets', 1961, 'LP', 'Jazz', 'Hard Bop'],
  ['Copper Lantern', 'The Lantern Sessions', 1962, '2LP', 'Jazz', 'Modal'],
  ['Dahlia Static', 'Television Hearts', 1981, 'LP', 'Electronic', 'Synth-pop'],
  ['Dahlia Static', 'Cold Neon', 1982, '7', 'Electronic', 'New Wave'],
  ['Dahlia Static', 'Mirrorball Requiem', 1984, 'LP', 'Electronic', 'Synth-pop'],
  ['Ember & The Undertow', 'Saltwater Gospel', 1972, 'GF', 'Rock', 'Southern Rock'],
  ['Ember & The Undertow', 'Riverbend', 1973, 'LP', 'Rock', 'Blues Rock'],
  ['Fennel Grove', 'Paper Lanterns', 1996, 'CD', 'Rock', 'Indie Rock'],
  ['Fennel Grove', 'Quiet Engines', 1999, 'LP', 'Rock', 'Indie Rock'],
  ['Glasshouse Radio', 'Static Bloom', 1989, 'LP', 'Rock', 'Shoegaze'],
  ['Glasshouse Radio', 'Underwater Fireworks', 1991, '2LP', 'Rock', 'Dream Pop'],
  ['Harbor Lights Orchestra', 'Tidal Suites', 1957, 'LP', 'Jazz', 'Big Band'],
  ['Iris Calder', 'Small Hours', 2014, 'LP', 'Pop', 'Chamber Pop'],
  ['Iris Calder', 'Kite Weather', 2017, 'LP', 'Pop', 'Chamber Pop'],
  ['Iris Calder', 'Paper Moon Radio', 2021, 'GF', 'Pop', 'Indie Pop'],
  ['Juniper Vale', 'Thunder in the Orchard', 1975, 'LP', 'Rock', 'Hard Rock'],
  ['Juniper Vale', 'Electric Pastures', 1977, 'GF', 'Rock', 'Hard Rock'],
  ['Kodiak Sound System', 'Bassline Cathedral', 1979, '10', 'Reggae', 'Dub'],
  ['Kodiak Sound System', 'Roots & Rafters', 1980, 'LP', 'Reggae', 'Roots Reggae'],
  ['Lumen Drift', 'Night Bus Ambient', 2008, '2LP', 'Electronic', 'Ambient'],
  ['Lumen Drift', 'Weightless', 2011, 'LP', 'Electronic', 'Downtempo'],
  ['Marigold Parade', 'Sunday Funnies', 1966, 'LP', 'Rock', 'Psychedelic Rock'],
  ['Marigold Parade', 'Kaleidoscope Lane', 1967, '7', 'Rock', 'Psychedelic Rock'],
  ['Nightjar', 'Feathers & Fuses', 1986, 'LP', 'Rock', 'Post-Punk'],
  ['Nightjar', 'Concrete Valentine', 1988, 'LP', 'Rock', 'Post-Punk'],
  ['Opaline Twins', 'Velvet Telegram', 1970, 'LP', 'Funk / Soul', 'Soul'],
  ['Opaline Twins', 'Groove Cartography', 1973, 'GF', 'Funk / Soul', 'Funk'],
  ['Opaline Twins', 'Sugar Static', 1974, '7', 'Funk / Soul', 'Funk'],
  ['Pale Orchard', 'Winter Correspondence', 2003, 'CD', 'Folk, World, & Country', 'Indie Folk'],
  ['Quarry Saints', 'Hammer & Halo', 1993, 'LP', 'Rock', 'Grunge'],
  ['Rosa Kestrel', 'Cartographer', 2019, 'LP', 'Jazz', 'Contemporary Jazz'],
]

const FORMATS = {
  LP: [{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album'] }],
  GF: [{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album', 'Gatefold'] }],
  '2LP': [{ name: 'Vinyl', qty: '2', descriptions: ['LP', 'Album'] }],
  7: [{ name: 'Vinyl', qty: '1', descriptions: ['7"', 'Single', '45 RPM'] }],
  10: [{ name: 'Vinyl', qty: '1', descriptions: ['10"', 'Album'] }],
  CD: [{ name: 'CD', qty: '1', descriptions: ['Album'] }],
}

const LABELS = ['Driftwood Records', 'Northlight', 'Half Moon Music', 'Tin Roof', 'Saltmarsh']

const releases = RECORDS.map(([artist, title, year, format, genre, style], index) => {
  const id = 100001 + index
  // Some records are later reissues; the app files them by the master's year.
  const reissue = index % 5 === 2
  return {
    id,
    masterId: 200001 + index,
    artist,
    title,
    year: reissue ? year + 40 : year,
    originalYear: year,
    format,
    genre,
    style,
    label: LABELS[index % LABELS.length],
    added: new Date(Date.UTC(2023, 0, 1) + index * 9 * 86_400_000).toISOString(),
    rating: [0, 4, 5, 3, 0, 5][index % 6],
  }
})

const byId = new Map(releases.map((record) => [record.id, record]))
const byMaster = new Map(releases.map((record) => [record.masterId, record]))

function basicInformation(record) {
  return {
    id: record.id,
    master_id: record.masterId,
    master_url: `${BASE}/masters/${record.masterId}`,
    resource_url: `${BASE}/releases/${record.id}`,
    thumb: `${BASE}/art/${record.id}.svg`,
    cover_image: `${BASE}/art/${record.id}.svg`,
    title: record.title,
    year: record.year,
    formats: FORMATS[record.format],
    labels: [{ name: record.label, catno: `DW-${record.id % 1000}`, id: 1 }],
    artists: [{ name: record.artist, anv: '', join: '', role: '', id: record.masterId }],
    genres: [record.genre],
    styles: [record.style],
  }
}

function collectionItem(record) {
  return {
    id: record.id,
    instance_id: 900000 + record.id,
    date_added: record.added,
    rating: record.rating,
    folder_id: record.genre === 'Jazz' ? 2 : 1,
    basic_information: basicInformation(record),
  }
}

/** A deterministic, abstract sleeve: two-colour field, a shape, the title. */
function coverSvg(record) {
  const hue = (record.id * 47) % 360
  const second = (hue + 40 + (record.id % 3) * 60) % 360
  const shapes = [
    `<circle cx="300" cy="260" r="170" fill="hsl(${second} 70% 60%)" opacity=".85"/>`,
    `<rect x="110" y="90" width="380" height="380" transform="rotate(12 300 280)" fill="hsl(${second} 65% 55%)" opacity=".8"/>`,
    `<path d="M0 420 Q150 250 300 380 T600 300 V600 H0Z" fill="hsl(${second} 60% 50%)"/>`,
    `<g fill="none" stroke="hsl(${second} 80% 70%)" stroke-width="14">${[0, 1, 2, 3, 4]
      .map((ring) => `<circle cx="300" cy="270" r="${50 + ring * 38}"/>`)
      .join('')}</g>`,
  ]
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 55% 28%)"/><stop offset="1" stop-color="hsl(${hue} 60% 12%)"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#g)"/>
${shapes[record.id % shapes.length]}
<text x="40" y="540" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#fff">${escape(record.title)}</text>
<text x="40" y="575" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#ffffffcc">${escape(record.artist)}</text>
</svg>`
}

const SONGS = [
  'Northbound', 'Paper Planes at Dawn', 'The Long Way Home', 'Static & Starlight', 'Velvet Hour',
  'Saltwater Letters', 'Ferris Wheel', 'Slow Burn', 'Under the Overpass', 'Moth to the Neon',
  'Copper Sky', 'Last Call at the Lighthouse', 'Small Victories', 'Signal Lost', 'Weathervane',
  'Postcard from Nowhere', 'Hold the Line', 'Glass Garden', 'Midnight Ferry', 'Afterglow',
]

function tracklist(record) {
  const count = record.format === '7' ? 2 : record.format === '2LP' ? 12 : 8
  return Array.from({ length: count }, (_, index) => {
    const side = String.fromCharCode(65 + Math.floor(index / Math.max(1, count / (record.format === '2LP' ? 4 : 2))))
    return {
      position: `${side}${(index % 4) + 1}`,
      title: index === 0 ? record.title : SONGS[(record.id * 7 + index * 3) % SONGS.length],
      duration: `${3 + (index % 4)}:${String((index * 17) % 60).padStart(2, '0')}`,
    }
  })
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Discogs-Ratelimit': '60',
    'X-Discogs-Ratelimit-Used': '0',
    'X-Discogs-Ratelimit-Remaining': '60',
    'Cache-Control': 'no-store',
  })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', BASE)
  const path = url.pathname
  let match

  if (path === '/oauth/identity') return send(res, 200, { id: 1, username: USER })

  if ((match = path.match(/^\/art\/(\d+)\.svg$/))) {
    const record = byId.get(Number(match[1]))
    return record ? send(res, 200, coverSvg(record), 'image/svg+xml') : send(res, 404, {})
  }

  if (path === `/users/${USER}/collection/folders`) {
    const jazz = releases.filter((record) => record.genre === 'Jazz').length
    return send(res, 200, {
      folders: [
        { id: 0, name: 'All', count: releases.length },
        { id: 1, name: 'Main shelf', count: releases.length - jazz },
        { id: 2, name: 'Jazz corner', count: jazz },
      ],
    })
  }

  if (path === `/users/${USER}/collection/folders/0/releases`) {
    const perPage = Number(url.searchParams.get('per_page') ?? 50)
    const page = Number(url.searchParams.get('page') ?? 1)
    const pages = Math.max(1, Math.ceil(releases.length / perPage))
    return send(res, 200, {
      pagination: { page, pages, per_page: perPage, items: releases.length },
      releases: releases.slice((page - 1) * perPage, page * perPage).map(collectionItem),
    })
  }

  if (path === `/users/${USER}/collection/value`) {
    return send(res, 200, { minimum: '€612.40', median: '€1,048.75', maximum: '€1,932.10' })
  }

  if ((match = path.match(/^\/masters\/(\d+)$/))) {
    const record = byMaster.get(Number(match[1]))
    return record
      ? send(res, 200, { id: record.masterId, title: record.title, year: record.originalYear })
      : send(res, 404, { message: 'Master not found.' })
  }

  if ((match = path.match(/^\/releases\/(\d+)$/))) {
    const record = byId.get(Number(match[1]))
    return record
      ? send(res, 200, {
          id: record.id,
          title: record.title,
          year: record.year,
          tracklist: tracklist(record),
          notes: record.format === 'GF' ? 'Gatefold sleeve with printed inner.' : '',
        })
      : send(res, 404, { message: 'Release not found.' })
  }

  send(res, 404, { message: 'Not part of the demo.' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Demo Discogs on ${BASE} — sign in as "${USER}" with any token`)
})
