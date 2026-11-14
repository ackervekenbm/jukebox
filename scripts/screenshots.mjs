// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2025-2026 ackervekenbm

/**
 * Regenerates the README screenshots in docs/screenshots/ from the demo
 * collection (scripts/demo-discogs.mjs), so no real collection or cover art
 * ever lands in the repo.
 *
 *   npm run demo                                   # in one terminal
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/screenshots.mjs [http://localhost:5199]
 *
 * Playwright is not a dependency on purpose: only this script needs it.
 */
/* global document -- used inside callbacks that run in the page */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const { chromium } = await import('playwright').catch(() => {
  console.error('Needs Playwright: npm i --no-save playwright && npx playwright install chromium')
  process.exit(1)
})

const APP = process.argv[2] ?? 'http://localhost:5199'
const OUT = path.resolve('docs/screenshots')
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const DESKTOP = { viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1.5 }

await fs.mkdir(OUT, { recursive: true })
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'jukebox-shots-'))

/** One browser profile, so the collection and its years load only once. */
async function open(device) {
  const context = await chromium.launchPersistentContext(profile, {
    ...device,
    executablePath: process.env.CHROMIUM_PATH,
    reducedMotion: 'reduce',
  })
  const page = context.pages()[0] ?? (await context.newPage())
  page.on('pageerror', (error) => console.error('page error:', error.message))
  return { context, page }
}

async function setTheme(page, theme) {
  await page.evaluate((value) => {
    localStorage.setItem('vinyl-vault:settings', JSON.stringify({ username: 'demo', token: 'demo-token', theme: value }))
  }, theme)
  await page.reload()
  await page.waitForSelector('.release-card')
  await page.waitForTimeout(800)
}

/** Waits until the background work (years, release notes) has finished. */
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.sync-banner:not(.error)'), null, { timeout: 120_000 })
  await page.waitForFunction(() => !document.querySelector('.cabinet-progress'), null, { timeout: 120_000 })
  await page.waitForTimeout(500)
}

async function shot(page, name) {
  const png = await page.screenshot()
  await sharp(png).webp({ quality: 82 }).toFile(path.join(OUT, `${name}.webp`))
  console.log('wrote', name)
}

// First run: load the collection and its original years.
{
  const { context, page } = await open(PHONE)
  await page.goto(APP)
  await setTheme(page, 'midnight')
  await settle(page)
  await context.close()
}

// Desktop hero.
{
  const { context, page } = await open(DESKTOP)
  await page.goto(APP)
  await setTheme(page, 'midnight')
  await settle(page)
  await shot(page, 'desktop')
  await context.close()
}

// Phone screens.
{
  const { context, page } = await open(PHONE)
  await page.goto(APP)
  for (const theme of ['midnight', 'paper', 'club', 'forest']) {
    await setTheme(page, theme)
    await shot(page, `theme-${theme}`)
  }

  await setTheme(page, 'midnight')
  await page.getByRole('button', { name: /Dust & Daylight/ }).first().click()
  await page.waitForSelector('.tracklist')
  await page.locator('.detail-card .card-scroll').evaluate((element) => element.scrollTo(0, 250))
  await page.waitForTimeout(400)
  await shot(page, 'phone-detail')
  await page.keyboard.press('Escape')

  await page.getByRole('radio', { name: 'Recent' }).click()
  await page.waitForTimeout(500)
  await shot(page, 'phone-recent')
  await page.getByRole('radio', { name: 'Artists' }).click()

  await page.getByRole('button', { name: 'Record cabinet' }).click()
  const shelves = await page.locator('.cabinet-slot-toggle').count()
  for (let shelf = shelves; shelf < 3; shelf++) {
    await page.getByRole('button', { name: 'Add shelf' }).click()
    await page.getByRole('spinbutton', { name: 'Shelf size' }).fill('16')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
  }
  await settle(page)
  await page.getByRole('button', { name: /^Shelf 1,/ }).click()
  await page.locator('.cabinet-slot').first().evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.locator('.cabinet-card .card-scroll').evaluate((element) => element.scrollBy(0, -12))
  await page.mouse.move(0, 0) // no hover highlight left on the tapped row
  await page.waitForTimeout(400)
  await shot(page, 'phone-cabinet')
  await page.keyboard.press('Escape')

  await setTheme(page, 'paper')
  await page.getByRole('button', { name: 'Collection stats' }).click()
  await page.waitForTimeout(800)
  await page.locator('[aria-label="Collection stats"] .card-scroll').evaluate((element) => element.scrollTo(0, 455))
  await page.waitForTimeout(300)
  await shot(page, 'phone-stats')
  await setTheme(page, 'midnight')
  await context.close()
}

await fs.rm(profile, { recursive: true, force: true })
