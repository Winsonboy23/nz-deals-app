// 首頁「生鮮特價」那一排（Chris 首頁改版規格 §4，2026-10-01）：肉 2、海鮮 2、蔬菜 2、水果 2，固定最多 8 張，照這個順序。
// 純函式，tests/freshPicks.test.ts 用 node --test 直接跑（所以這裡不 import 別的檔，只 import 型別）。
import type { Special } from './types'

/** 用到的欄位（useSpecials 的 rows 一列的 special） */
export type FreshSpecial = Pick<Special, 'store_id' | 'product_id' | 'product_key' | 'price' | 'price_unit' | 'was_price' | 'unit_price' | 'unit_price_unit' | 'category_id'> & { name?: string | null }
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

/** 分類在蔬果底下、但其實是罐裝／醬／乾貨的不算生鮮（例：Sushi Ginger 120g Jar 歸在 fresh-salad-and-herbs） */
const JARRED = /\b(jar|paste|pickled|minced|crushed|dried|tube|squeeze|sauce|canned)\b/i
/** 肉和海鮮裡的加工品不算生鮮：裹粉、漢堡排、醃好的、煮熟的（2026-10-01 使用者決定，例：Tegel Crunchy Chicken Burger Patties） */
const PROCESSED = /\b(crumbed|coated|battered|crunchy|crispy|burgers?|patty|patties|nuggets?|schnitzels?|chargrilled|marinated|seasoned|glazed|kebabs?|cooked|precooked|tempura|fingers|bites|popcorn)\b/i

export function freshKind(categoryId: string | null): FreshKind | null {
  if (!categoryId) return null
  return KIND[categoryId.split('/').slice(0, 2).join('/')] ?? null
}

/** 省多少錢（原價 − 特價，Chris 規格「省最多」）；黃超不寫原價（畫面上也從不顯示），一律當沒原價 */
function saving(s: FreshSpecial): number {
  const was = s.store_id.startsWith('paknsave:') ? null : s.was_price
  return was && was > s.price ? was - s.price : 0
}
/** 每公斤單價；不是按公斤算的回 null */
function perKg(s: FreshSpecial): number | null {
  if (s.unit_price != null && (s.unit_price_unit ?? '').toLowerCase() === 'kg') return s.unit_price
  if ((s.price_unit ?? '').toLowerCase() === 'kg') return s.price
  return null
}
/** 「省最多」的排前面：有原價的按省多少錢大到小；沒原價的（黃超）排後面，按每公斤單價小到大；沒有每公斤價的再後面，按價格 */
function bySaving(a: FreshSpecial, b: FreshSpecial): number {
  const da = saving(a)
  const db = saving(b)
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
    const kind = freshKind(r.special.category_id)
    const name = r.special.name ?? ''
    if (!kind || JARRED.test(name) || ((kind === 'meat' || kind === 'seafood') && PROCESSED.test(name))) continue
    const k = r.special.product_key ?? `${r.special.store_id}|${r.special.product_id}`
    const cur = cheapest.get(k)
    if (!cur || r.special.price < cur.special.price) cheapest.set(k, r)
  }
  const by: Record<FreshKind, R[]> = { meat: [], seafood: [], veg: [], fruit: [] }
  for (const r of cheapest.values()) by[freshKind(r.special.category_id)!].push(r)
  for (const list of Object.values(by)) list.sort((x, y) => bySaving(x.special, y.special))
  return [...pair(by.meat, by.seafood), ...pair(by.veg, by.fruit)]
}
