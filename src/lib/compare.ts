import type { Group, Offer, Special, Store } from './types'
import { chainOf } from './format'

export type TagKind = 'half' | 'pct' | 'save' | 'multi' | 'club' | 'low'
export interface Tag {
  kind: TagKind
  /** percent for 'pct', dollars for 'save', qty/total for 'multi' */
  pct?: number
  amount?: number
  qty?: number
  total?: number
}

/** Price a multi-buy is compared at: the price you pay per unit once the deal is met. */
export function dealPrice(s: Special): number {
  if (s.multi_buy && s.multi_buy.qty > 0) return s.multi_buy.total / s.multi_buy.qty
  return s.price
}

/**
 * §8 tag vocabulary. PAK'nSAVE never gets a was-price/savings tag; New World club prices always
 * carry the CLUBCARD outline. The discount tags need a was-price, which only WW/NW publish.
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
  if (s.multi_buy) out.push({ kind: 'multi', qty: s.multi_buy.qty, total: s.multi_buy.total })
  if (s.club_only) out.push({ kind: 'club' })
  if (chain === 'paknsave' && out.length === 0) out.push({ kind: 'low' })
  return out
}

/** The single tag shown on a thumbnail. */
export function primaryTag(s: Special): Tag | null {
  const tags = tagsFor(s)
  const order: TagKind[] = ['half', 'pct', 'save', 'multi', 'club', 'low']
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
  const deal = dealPrice(special)
  const ratio = special.price > 0 ? deal / special.price : 1
  return {
    store,
    special,
    deal,
    unit: special.unit_price != null ? special.unit_price * ratio : null,
    unitUnit: special.unit_price_unit ? special.unit_price_unit.toLowerCase() : null,
  }
}

/**
 * Rank offers for one product_key. Compare on unit price when every offer shares the same unit,
 * otherwise on the price you pay. Never produces a "more expensive" statement — the caller only
 * ever renders the cheapest and the gap.
 */
export function buildGroup(key: string, all: Offer[]): Group {
  // A store can carry the same product_key on more than one row (pack sizes, duplicate SKUs).
  // Keep the cheapest per store so "3 stores" always means three different stores.
  const perStore = new Map<string, Offer>()
  for (const o of all) {
    const cur = perStore.get(o.store.id)
    if (!cur || o.deal < cur.deal) perStore.set(o.store.id, o)
  }
  const offers = [...perStore.values()]
  const units = new Set(offers.map((o) => o.unitUnit))
  const byUnit =
    offers.length > 1 && units.size === 1 && offers.every((o) => o.unit != null && o.unit > 0)
  const value = (o: Offer) => (byUnit ? (o.unit as number) : o.deal)
  const sorted = [...offers].sort((a, b) => value(a) - value(b))
  const gap = sorted.length > 1 ? value(sorted[1]) - value(sorted[0]) : null
  // What the shopper actually saves by walking to the cheapest store, in dollars paid.
  const payGap =
    sorted.length > 1 ? Math.max(0, Math.min(...sorted.slice(1).map((o) => o.deal)) - sorted[0].deal) : null
  const cheapestPaid = offers.reduce((a, b) => (b.deal < a.deal ? b : a))
  const unitDecided = byUnit && cheapestPaid.store.id !== sorted[0].store.id
  return { key, offers: sorted, best: sorted[0], gap, payGap, byUnit, unitDecided }
}
