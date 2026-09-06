// Screenshots every screen at the artboard size with the 3 stores that have data.
// Run from the repo root so it can resolve the shared playwright install:
//   node app/scripts/shots.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../screenshots')
mkdirSync(out, { recursive: true })

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const STORES = [
  'newworld:afbe3446-1f57-4dca-9a58-0c7d5a4a6020',
  'woolworths:9469',
  'paknsave:5cf0392f-c187-4fc4-a463-eb269d2e8f45',
]

const errors = []

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  locale: 'en-NZ',
  permissions: ['geolocation'],
  geolocation: { latitude: -42.4504, longitude: 171.2109 }, // Greymouth
})
await ctx.addInitScript(
  ([stores]) => {
    localStorage.setItem('nzd:selected', JSON.stringify(stores))
    if (!localStorage.getItem('nzd:lang')) localStorage.setItem('nzd:lang', JSON.stringify('en'))
  },
  [STORES],
)
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

async function shot(hash, name, { wait = 1200, before } = {}) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(wait)
  if (before) await before()
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false })
  const h = await page.evaluate(() => document.body.scrollHeight)
  console.log(`${name.padEnd(22)} scrollHeight=${h}`)
}

await shot('/', 'home', { wait: 4000 })
await shot('/browse', 'browse')
await shot('/search?q=chicken', 'search-chicken', {
  before: async () => {
    await page.fill('input', 'chicken')
    await page.waitForTimeout(600)
  },
})
await shot('/top10', 'top10')
await shot('/half-price', 'half-price')
await shot('/fresh', 'fresh')
await shot('/me', 'me')
await shot('/recipes', 'recipes')

// Product sheet over the home page, and add a few items through the real UI
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
for (const i of [0, 1, 3]) {
  await page.locator('.grid3 .card').nth(i).click()
  await page.waitForTimeout(800)
  if (i === 0) {
    await page.screenshot({ path: `${out}/product-sheet.png` })
    console.log('product-sheet           ok')
  }
  await page.locator('.bsheet button.btn').first().click()
  await page.waitForTimeout(300)
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
}

await shot('/list', 'list-split', { wait: 1500, before: async () => {
  await page.fill('.field input', 'Spring onions')
  await page.locator('button.btn', { hasText: 'Add' }).click()
  await page.waitForTimeout(400)
} })
await page.click('.seg > div:nth-child(2)')
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/list-one-stop.png` })
console.log('list-one-stop           ok')

// Chinese pass
await page.evaluate(() => localStorage.setItem('nzd:lang', JSON.stringify('zh')))
await page.reload({ waitUntil: 'networkidle' })
await shot('/', 'home-zh', { wait: 2500 })
await shot('/browse', 'browse-zh', { wait: 1500 })
await page.evaluate(() => localStorage.setItem('nzd:lang', JSON.stringify('en')))
await page.reload({ waitUntil: 'networkidle' })

// Store picker
await page.goto(`${BASE}/#/stores`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/stores.png` })
console.log('stores                  ok')

await browser.close()

if (errors.length) {
  console.log('\nCONSOLE ERRORS:')
  for (const e of [...new Set(errors)]) console.log('  ' + e)
  process.exitCode = 1
} else {
  console.log('\nno console errors')
}
