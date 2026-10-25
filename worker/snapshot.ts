// R2 快照：一家店一週的特價，從 D1 的三張表合併成 App 現在拿到的那種列（docs/national-plan.md §2.3、§2.6）。
//   store_specials（這家店哪些 key 在特價）→ chain_prices（連鎖價）→ store_prices 有的就覆蓋 → products / chain_items 補名字、分類、圖、編號。
// 寫到 specials/<store_id>/<week>.json：{ week, store_id, built_at, rows }，rows 的欄位跟 Supabase specials 表一樣（階段 3 App 直接改讀這份）。
import type { Env } from './env'

export const snapshotKey = (storeId: string, week: string) => `specials/${storeId}/${week}.json`

interface PriceRow {
  product_key: string
  price: number
  regular_price: number | null
  member_price: number | null
  multi_buy: string | null
  badges: string | null
  price_unit: string | null
  unit_price: number | null
  unit_price_unit: string | null
  promo_type: string | null
}
interface ProductRow { key: string; display_name: string; brand: string | null; size: string | null; category_id: string | null; family_key: string | null; is_food: number; image_url: string | null; family_name_en: string | null; family_name_zh: string | null }
interface ItemRow { product_key: string; product_id: string; url: string | null; name_listed: string | null }

const UNIT_TEXT: Record<string, string> = { each: ' each', kg: ' kg', pack: ' pack', litre: ' L' }

function parseJson<T>(s: string | null, fallback: T): T {
  if (s == null) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

/** 組出一家店一週的列；這家店這週沒有 store_specials 就回 null。 */
export async function buildSnapshot(env: Env, storeId: string, week: string) {
  const chain = storeId.split(':')[0]
  const sp = await env.DB.prepare('select product_keys from store_specials where store_id = ? and week_start = ?').bind(storeId, week).first<{ product_keys: string }>()
  if (!sp) return null
  const keys = parseJson<string[]>(sp.product_keys, [])
  const keysJson = JSON.stringify(keys)

  // IN (...) 會超過 100 個綁定參數，改用 json_each 一個參數帶整包 key
  const [cp, spr, prods, items, st] = await Promise.all([
    env.DB.prepare('select cp.* from chain_prices cp join json_each(?) k on k.value = cp.product_key where cp.chain_id = ? and cp.week_start = ?').bind(keysJson, chain, week).all<PriceRow>(),
    env.DB.prepare('select * from store_prices where store_id = ? and week_start = ?').bind(storeId, week).all<PriceRow>(),
    env.DB.prepare('select p.*, f.name_en as family_name_en, f.name_zh as family_name_zh from products p join json_each(?) k on k.value = p.key left join families f on f.key = p.family_key').bind(keysJson).all<ProductRow>(),
    env.DB.prepare('select ci.product_key, ci.product_id, ci.url, ci.name_listed from chain_items ci join json_each(?) k on k.value = ci.product_key where ci.chain_id = ? order by ci.seen_at').bind(keysJson, chain).all<ItemRow>(),
    env.DB.prepare('select last_fetched_at from stores where id = ?').bind(storeId).first<{ last_fetched_at: string | null }>(),
  ])
  const price = new Map<string, PriceRow>()
  for (const r of cp.results) price.set(r.product_key, r)
  for (const r of spr.results) price.set(r.product_key, r)          // 店價蓋連鎖價
  const prod = new Map(prods.results.map((p) => [p.key, p]))
  const item = new Map<string, ItemRow>()
  for (const i of items.results) item.set(i.product_key, i)         // 同 key 多個編號：seen_at 最新的留下（order by seen_at，後蓋前）
  const fetchedAt = st?.last_fetched_at ?? new Date().toISOString()

  const rows = []
  let missingPrice = 0
  for (const key of keys) {
    const pr = price.get(key)
    if (!pr) { missingPrice++; continue }
    const p = prod.get(key)
    const it = item.get(key)
    const multi = parseJson<{ qty: number; total: number } | null>(pr.multi_buy, null)
    const badges = parseJson<string[]>(pr.badges, [])
    const unit = pr.price_unit ?? 'each'
    const productId = it?.product_id ?? key
    rows.push({
      id: `${storeId}|${week}|${productId}`,
      store_id: storeId,
      week_start: week,
      product_id: productId,
      product_key: key,
      name: p?.display_name ?? it?.name_listed ?? key,
      brand: p?.brand ?? null,
      size: p?.size ?? null,
      price: pr.price,
      price_unit: unit,
      price_text: multi ? `${multi.qty} for $${multi.total.toFixed(2)}` : `$${pr.price.toFixed(2)}${UNIT_TEXT[unit] ?? ''}`,
      was_price: pr.regular_price != null && pr.regular_price > pr.price ? pr.regular_price : null,
      unit_price: pr.unit_price,
      unit_price_unit: pr.unit_price_unit,
      multi_buy: multi,
      promo_type: pr.promo_type,
      club_only: pr.member_price != null && Math.abs(pr.member_price - pr.price) < 0.005,   // 只有會員價的那列 price = 會員價（migrations/002 的規矩）
      source_category_path: null,
      category_id: p?.category_id ?? null,
      image_url: p?.image_url ?? null,
      product_url: it?.url ?? null,
      needs_review: false,
      fetched_at: fetchedAt,
      badges,
      is_special: badges.length > 0,
      regular_price: pr.regular_price,
      member_price: pr.member_price,
      // 同類可比：跟 App 從 Supabase 拿 `products(family_key,family_name_en,family_name_zh)` 的巢狀形狀一樣，前端 flatten 直接吃
      products: p ? { family_key: p.family_key, family_name_en: p.family_name_en, family_name_zh: p.family_name_zh } : null,
    })
  }
  return { week, store_id: storeId, built_at: new Date().toISOString(), rows, missing_price: missingPrice }
}

/** 組好寫進 R2，回寫了幾列、幾 bytes。 */
export async function writeSnapshot(env: Env, storeId: string, week: string) {
  const snap = await buildSnapshot(env, storeId, week)
  if (!snap) return null
  const { missing_price, ...body } = snap
  const text = JSON.stringify(body)
  await env.DATA.put(snapshotKey(storeId, week), text, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { rows: String(body.rows.length), built_at: body.built_at },
  })
  return { rows: body.rows.length, bytes: text.length, missing_price }
}
