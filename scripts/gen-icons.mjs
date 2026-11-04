// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const OUT = new URL('../public/icons/', import.meta.url)
const ROOT = new URL('../public/', import.meta.url)
const out = (name) => fileURLToPath(new URL(name, OUT))
const root = (name) => fileURLToPath(new URL(name, ROOT))

const disc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="label" cx="0.35" cy="0.35" r="1">
      <stop offset="0" stop-color="#ffd27a"/>
      <stop offset="1" stop-color="#d97a1e"/>
    </radialGradient>
  </defs>
  <circle cx="256" cy="256" r="196" fill="#20202c"/>
  <circle cx="256" cy="256" r="196" fill="none" stroke="#4a4a5c" stroke-width="4"/>
  <g stroke="#ffffff" opacity="0.07" fill="none" stroke-width="2">
    <circle cx="256" cy="256" r="180"/>
    <circle cx="256" cy="256" r="168"/>
    <circle cx="256" cy="256" r="156"/>
    <circle cx="256" cy="256" r="144"/>
    <circle cx="256" cy="256" r="132"/>
    <circle cx="256" cy="256" r="120"/>
    <circle cx="256" cy="256" r="108"/>
    <circle cx="256" cy="256" r="96"/>
  </g>
  <circle cx="256" cy="256" r="76" fill="url(#label)"/>
  <circle cx="256" cy="256" r="76" fill="none" stroke="#ffd27a" stroke-opacity="0.35" stroke-width="1.5"/>
  <path d="M256 214 a42 42 0 0 1 0 84" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="6" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="13" fill="#0a0a10"/>
</svg>`

const maskable = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#161d36"/>
      <stop offset="1" stop-color="#070a18"/>
    </linearGradient>
    <radialGradient id="label" cx="0.35" cy="0.35" r="1">
      <stop offset="0" stop-color="#ffd27a"/>
      <stop offset="1" stop-color="#d97a1e"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(0.72) translate(-256 -256)">
    <circle cx="256" cy="256" r="196" fill="#20202c"/>
    <circle cx="256" cy="256" r="196" fill="none" stroke="#4a4a5c" stroke-width="4"/>
    <g stroke="#ffffff" opacity="0.07" fill="none" stroke-width="2">
      <circle cx="256" cy="256" r="180"/>
      <circle cx="256" cy="256" r="168"/>
      <circle cx="256" cy="256" r="156"/>
      <circle cx="256" cy="256" r="144"/>
      <circle cx="256" cy="256" r="132"/>
      <circle cx="256" cy="256" r="120"/>
      <circle cx="256" cy="256" r="108"/>
      <circle cx="256" cy="256" r="96"/>
    </g>
    <circle cx="256" cy="256" r="76" fill="url(#label)"/>
    <circle cx="256" cy="256" r="76" fill="none" stroke="#ffd27a" stroke-opacity="0.35" stroke-width="1.5"/>
    <path d="M256 214 a42 42 0 0 1 0 84" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="6" stroke-linecap="round"/>
    <circle cx="256" cy="256" r="13" fill="#0a0a10"/>
  </g>
</svg>`

await mkdir(OUT, { recursive: true })

await sharp(Buffer.from(disc)).resize(192, 192).png().toFile(out('icon-192.png'))
await sharp(Buffer.from(disc)).resize(512, 512).png().toFile(out('icon-512.png'))
await sharp(Buffer.from(maskable)).resize(512, 512).png().toFile(out('icon-512-maskable.png'))
await sharp(Buffer.from(disc)).resize(180, 180).png().toFile(root('apple-touch-icon.png'))

console.log('generated: icon-192.png, icon-512.png, icon-512-maskable.png, apple-touch-icon.png')