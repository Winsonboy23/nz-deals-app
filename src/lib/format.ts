import type { ChainClass, ChainId, Special } from './types'

const CLASS: Record<ChainId, ChainClass> = {
  newworld: 'nw',
  woolworths: 'ww',
  paknsave: 'pns',
}
const NAME: Record<ChainId, string> = {
  newworld: 'New World',
  woolworths: 'Woolworths',
  paknsave: "PAK'nSAVE",
}
const SHORT: Record<ChainId, string> = { newworld: 'NW', woolworths: 'WW', paknsave: 'PNS' }

/** Level-1 category ids that are not food (CLAUDE.md §8: alcohol, cleaning, pets, health, baby). */
const NON_FOOD = new Set([
  'beer-wine-and-cider',
  'beer-and-cider-awards',
  'health-and-body',
  'baby-and-toddler',
  'pets',
  'household-and-cleaning',
])

/** Level-1 categories priced per kg. */
const FRESH = new Set(['fruit-and-vegetables', 'meat-poultry-and-seafood'])

export function chainOf(storeId: string): ChainId {
  return storeId.split(':')[0] as ChainId
}
export function chainClass(storeId: string): ChainClass {
  return CLASS[chainOf(storeId)] ?? 'ww'
}
export function chainName(storeId: string): string {
  return NAME[chainOf(storeId)] ?? storeId
}
export function chainShort(storeId: string): string {
  return SHORT[chainOf(storeId)] ?? '?'
}

export function catParts(id: string | null): string[] {
  return id ? id.split('/') : []
}
export function catLevel(id: string | null, level: 1 | 2 | 3): string | null {
  const p = catParts(id)
  return p.length >= level ? p.slice(0, level).join('/') : null
}
export function isFood(categoryId: string | null): boolean {
  const l1 = catParts(categoryId)[0]
  return !l1 || !NON_FOOD.has(l1)
}
export function isFresh(categoryId: string | null): boolean {
  const l1 = catParts(categoryId)[0]
  return !!l1 && FRESH.has(l1)
}

export function money(n: number): string {
  return '$' + n.toFixed(2)
}

/** PAK'nSAVE publishes no was-price, so we never render one or a saving for it. */
export function showsWasPrice(storeId: string): boolean {
  return chainOf(storeId) !== 'paknsave'
}

export function wasPriceOf(s: Special): number | null {
  return showsWasPrice(s.store_id) ? s.was_price : null
}

/**
 * $/kg for fresh, $/100g or $/L for packaged. Returns null when the store gave no unit price.
 */
export function unitLabel(s: Special): string | null {
  if (s.unit_price == null || !s.unit_price_unit) return null
  const u = s.unit_price_unit.toLowerCase()
  if (u === 'each' || u === 'ea') return money(s.unit_price) + ' ea'
  if (u === 'l' || u === 'litre') return money(s.unit_price) + '/L'
  if (u === 'kg') {
    if (isFresh(s.category_id)) return money(s.unit_price) + '/kg'
    return money(s.unit_price / 10) + '/100g'
  }
  return money(s.unit_price) + '/' + s.unit_price_unit
}

/** The suffix rendered next to a big price, e.g. $4.49/kg. */
export function priceSuffix(s: Special): string {
  const u = (s.price_unit || '').toLowerCase()
  if (u === 'kg') return '/kg'
  if (u === 'l' || u === 'litre') return '/L'
  return ''
}

/**
 * Foodstuffs rows carry no image_url; the public CDN serves one keyed by the bare product number
 * (product_id looks like "5025438-EA-000"). Woolworths rows already have a URL.
 */
export function imageFor(s: Special, size: 100 | 200 | 400 = 200): string | null {
  if (s.image_url) return s.image_url
  const chain = chainOf(s.store_id)
  if (chain === 'newworld' || chain === 'paknsave') {
    const num = s.product_id.split('-')[0]
    if (/^\d+$/.test(num)) {
      return `https://a.fsimg.co.nz/product/retail/fan/image/${size}x${size}/${num}.png`
    }
  }
  return null
}

export function displayName(s: Special): string {
  const brand = s.brand && !s.name.toLowerCase().startsWith(s.brand.toLowerCase())
    ? s.brand + ' '
    : ''
  const size = s.size && !s.name.toLowerCase().includes(s.size.toLowerCase()) ? ' ' + s.size : ''
  return (brand + s.name + size).trim()
}
