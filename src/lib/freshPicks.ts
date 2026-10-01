// 首頁「生鮮特價」那一排（Chris 首頁改版規格 §4，2026-10-01）：肉 2、海鮮 2、蔬菜 2、水果 2，固定最多 8 張，照這個順序。
// 純函式，tests/freshPicks.test.ts 用 node --test 直接跑（所以這裡不 import 別的檔，只 import 型別）。
import type { Special } from './types'

/** 用到的欄位（useSpecials 的 rows 一列的 special） */
export type FreshSpecial = Pick<Special, 'store_id' | 'product_id' | 'product_key' | 'price' | 'price_unit' | 'was_price' | 'unit_price' | 'unit_price_unit' | 'category_id'>
export type FreshKind = 'meat' | 'seafood' | 'veg' | 'fruit'

/** Foodstuffs 第二層分類 → 哪一類。熟食冷肉、內臟骨頭、植物肉、有機蔬果不算。 */
const KIND: Record<string, FreshKind> = {
  'meat-poultry-and-seafood/beef': 'meat',
  'meat-poultry-and-seafood/chicken-and-poultry': 'meat',
  'meat-poultry-and-seafood/lamb': 'meat',
  'meat-poultry-and-seafood/pork-and-ham': 'meat',
  'meat-poultry-and-seafood/mince-sausages-and-meatballs': 'meat',
  'meat-poultry-and-seafood/venison-and-game': 'meat',
  'meat-poultry-and-seafood/seafood': 'seafood',
  'fruit-and-vegetables/vegetables': 'veg',
  'fruit-and-vegetables/fresh-salad-and-herbs': 'veg',
  'fruit-and-vegetables/fruit': 'fruit',
}

export function freshKind(categoryId: string | null): FreshKind | null {
  if (!categoryId) return null
  return KIND[categoryId.split('/').slice(0, 2).join('/')] ?? null
}

/** 折數（省了原價的幾成）；黃超不寫原價（畫面上也從不顯示），一律當沒原價 */
function depth(s: FreshSpecial): number {
  const was = s.store_id.startsWith('paknsave:') ? null : s.was_price
  return was && was > s.price ? (was - s.price) / was : 0
}
/** 每公斤單價；不是按公斤算的回 null */
function perKg(s: FreshSpecial): number | null {
  if (s.unit_price != null && (s.unit_price_unit ?? '').toLowerCase() === 'kg') return s.unit_price
  if ((s.price_unit ?? '').toLowerCase() === 'kg') return s.price
  return null
}
/** 「省最多」的排前面：有原價的按折數大到小；沒原價的（黃超）排後面，按每公斤單價小到大；沒有每公斤價的再後面，按價格 */
function bySaving(a: FreshSpecial, b: FreshSpecial): number {
  const da = depth(a)
  const db = depth(b)
  if (da !== db) return db - da
  const ka = perKg(a)
  const kb = perKg(b)
  if (ka != null && kb != null && ka !== kb) return ka - kb
  if ((ka == null) !== (kb == null)) return ka == null ? 1 : -1
  return a.price - b.price
}

/** 一對互補的類（肉↔海鮮、蔬菜↔水果）：各拿前 2；有一類不到 2 個，就用另一類多的補在這一段的最後面，湊到 4 個為止 */
function pair<R>(a: R[], b: R[]): R[] {
  const out = [...a.slice(0, 2), ...b.slice(0, 2)]
  const extra = [...a.slice(2), ...b.slice(2)]
  return [...out, ...extra.slice(0, 4 - out.length)]
}

/**
 * 從你的店這週的特價挑生鮮 8 張。同一樣商品（product_key）只留你的店裡最便宜那筆（蔬果價每家分店不一樣，所以傳進來的就是你選的店）。
 * 回傳的是傳進來的那幾列本身，順序：肉、海鮮、蔬菜、水果。
 */
export function freshPicks<R extends { special: FreshSpecial }>(rows: R[]): R[] {
  const cheapest = new Map<string, R>()
  for (const r of rows) {
    if (!freshKind(r.special.category_id)) continue
    const k = r.special.product_key ?? `${r.special.store_id}|${r.special.product_id}`
    const cur = cheapest.get(k)
    if (!cur || r.special.price < cur.special.price) cheapest.set(k, r)
  }
  const by: Record<FreshKind, R[]> = { meat: [], seafood: [], veg: [], fruit: [] }
  for (const r of cheapest.values()) by[freshKind(r.special.category_id)!].push(r)
  for (const list of Object.values(by)) list.sort((x, y) => bySaving(x.special, y.special))
  return [...pair(by.meat, by.seafood), ...pair(by.veg, by.fruit)]
}
