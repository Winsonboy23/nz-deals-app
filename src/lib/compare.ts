import type { Group, MultiBuy, Offer, Special, Store } from './types'
import { chainOf } from './format'
import { kgOf } from './size'

export type TagKind = 'half' | 'pct' | 'save' | 'low'
export interface Tag {
  kind: TagKind
  /** percent for 'pct', dollars for 'save' */
  pct?: number
  amount?: number
}

/**
 * The one number every list ranks and displays by: the single-unit shelf price (2026-09-15).
 * Multi-buy and Clubcard are conditions shown next to the price (PriceLine.vue), never the basis.
 * Before this, one store's row was ranked at its "2 for $3" unit price while the next store's row
 * used its single price — two rulers in one list.
 */
export function rankPrice(s: { price: number }): number {
  return s.price
}

/** Per-unit price once a multi-buy is met ("2 for $3" → 1.50). For the detail line only. */
export function multiUnitPrice(s: { multi_buy: MultiBuy | null }): number | null {
  const m = s.multi_buy
  return m && m.qty > 0 ? m.total / m.qty : null
}

/**
 * What you pay for `qty` units: every full bundle at the multi-buy price, the remainder at the single price.
 * Sold per kg: price × kilos × qty, kilos from the name ("… Min Order 1.6kg" → 1.6), else 1 kg — so $17.99/kg pork
 * shoulder at 1.6kg is $28.78, not $17.99, and every store is measured with the same ruler (一站 v2, 2026-09-24).
 */
export function costFor(s: { price: number; multi_buy: MultiBuy | null; price_unit?: string | null; size?: string | null; name?: string | null }, qty: number): number {
  if ((s.price_unit ?? '').toLowerCase() === 'kg') return s.price * kgOf(s) * qty
  const m = s.multi_buy
  if (!m || m.qty <= 0 || qty < m.qty) return s.price * qty
  return Math.floor(qty / m.qty) * m.total + (qty % m.qty) * s.price
}

/** Sort value of an offer inside a list: $/kg (or $/L) when the list compares by unit and the row has one, else the price. */
export function offerValue(o: Offer, byUnit = false): number {
  return byUnit && o.unit != null && o.unit > 0 ? o.unit : o.price
}

/** Order for "similar items" (同類可比): unit price when both share a unit, rows with a unit price first, then price. */
export function byUnitThenPrice(a: Offer, b: Offer): number {
  if (a.unit != null && b.unit != null && a.unitUnit === b.unitUnit) return a.unit - b.unit
  if (a.unit != null && b.unit == null) return -1
  if (a.unit == null && b.unit != null) return 1
  return a.price - b.price
}

/**
 * §8 tag vocabulary — discount badges only. PAK'nSAVE publishes no was-price, so it never gets a
 * savings tag and gets the LOW PRICE label instead. Clubcard and multi-buy are conditions, not
 * discounts: they live on the price line (PriceLine.vue) so every price carries its own conditions.
 */
export function tagsFor(s: Special): Tag[] {
  const out: Tag[] = []
  const chain = chainOf(s.store_id)
  const was = chain === 'paknsave' ? null : s.was_price
  if (was && was > s.price) {
    const off = 1 - s.price / was
    if (s.price <= was / 2) out.push({ kind: 'half' })
    else if (off >= 0.4) out.push({ kind: 'pct', pct: Math.round(off * 100) })
    else out.push({ kind: 'save', amount: was - s.price })
  }
  if (chain === 'paknsave' && out.length === 0) out.push({ kind: 'low' })
  return out
}

/** The single tag shown on a thumbnail. */
export function primaryTag(s: Special): Tag | null {
  const tags = tagsFor(s)
  const order: TagKind[] = ['half', 'pct', 'save', 'low']
  for (const k of order) {
    const t = tags.find((x) => x.kind === k)
    if (t) return t
  }
  return null
}

/** How deep the discount is, 0 when there is no was-price. Used for ranking. */
export function discountDepth(s: Special): number {
  const was = chainOf(s.store_id) === 'paknsave' ? null : s.was_price
  if (!was || was <= s.price) return 0
  return 1 - s.price / was
}

export function toOffer(store: Store, special: Special): Offer {
  return {
    store,
    special,
    price: rankPrice(special),
    unit: special.unit_price,
    unitUnit: special.unit_price_unit ? special.unit_price_unit.toLowerCase() : null,
  }
}

/**
 * Rank offers for one product_key. Compare on unit price when every offer shares the same unit,
 * otherwise on the single-unit price. Never produces a "more expensive" statement — the caller only
 * ever renders the cheapest and the gap.
 */
export function buildGroup(key: string, all: Offer[]): Group {
  // A store can carry the same product_key on more than one row (pack sizes, duplicate SKUs).
  // Keep the cheapest per store so "3 stores" always means three different stores.
  const perStore = new Map<string, Offer>()
  for (const o of all) {
    const cur = perStore.get(o.store.id)
    if (!cur || o.price < cur.price) perStore.set(o.store.id, o)
  }
  const offers = [...perStore.values()]
  const units = new Set(offers.map((o) => o.unitUnit))
  const byUnit =
    offers.length > 1 && units.size === 1 && offers.every((o) => o.unit != null && o.unit > 0)
  const value = (o: Offer) => offerValue(o, byUnit)
  const sorted = [...offers].sort((a, b) => value(a) - value(b))
  const gap = sorted.length > 1 ? value(sorted[1]) - value(sorted[0]) : null
  // What the shopper actually saves by walking to the cheapest store, in dollars paid.
  const payGap =
    sorted.length > 1 ? Math.max(0, Math.min(...sorted.slice(1).map((o) => o.price)) - sorted[0].price) : null
  const cheapestPaid = offers.reduce((a, b) => (b.price < a.price ? b : a))
  const unitDecided = byUnit && cheapestPaid.store.id !== sorted[0].store.id
  return { key, offers: sorted, best: sorted[0], gap, payGap, byUnit, unitDecided }
}
