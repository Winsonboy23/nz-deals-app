// /api/*（公開讀，階段 3，2026-10-25；docs/national-plan.md §3）：App 開 ?src=d1 之後改向這裡拿資料，不再直接讀 Supabase。
// 回的形狀照 App 原本從 Supabase 拿到的（欄位名一樣），前端只換資料來源不改畫面。
//
//   GET  /api/stores                    stores（App 的 Store 形狀：online_shopping、store_id 由 id 拆）
//   GET  /api/categories                categories {id, level, parent_id, name}
//   GET  /api/taxonomy-zh               [{name, zh}]（從 categories.name_zh 來）
//   GET  /api/settings                  [{key, value}]
//   GET  /api/recipes                   published 的食譜 {id, week_start, reviewed, data}
//   POST /api/products {keys?, families?}   products（含同類名字），最多 500 個
//   GET  /api/products?keys=a,b&families=   同上（給爬蟲 price-worker 用，階段 4 契約 §10；階段 6 切換前它要靠這個拿 display_name）
//   GET  /api/history/:key?stores=a,b   近 8 週這個商品在這幾家店的價格 {store_id, week_start, price, multi_buy}
//   階段 6（2026-10-26，docs/national-plan.md §2.2）：貨架價在 chain_items.shelf_*，回 App 原本 Supabase catalog 的列形狀（store_id 照問的店填）
//   GET  /api/catalog?stores=a,b&keys=k1,k2          這些 key 在這幾家店（＝它們的連鎖）的貨架價
//   GET  /api/catalog/search?stores=&words=w1,w2&l2=&limit=   品名含全部字（可限分類前兩層）
//   GET  /api/catalog/hint?product_id=&store=        這個編號在這群連鎖的 key 和分類（採用商品時用）
// /api/specials/:store 在 index.ts（Supabase 代理 + src=d1 讀 R2 快照）。
import { Hono } from 'hono'
import type { Env } from './env'
import { weeksBack } from './week'

const api = new Hono<{ Bindings: Env }>()
const STORE_ID = /^[a-z]+:[A-Za-z0-9-]{1,64}$/
const KEY = /^[a-z0-9_.-]{1,160}$/i
const json = (c: { json: (b: unknown, s?: 200, h?: Record<string, string>) => Response }, body: unknown, maxAge: number) =>
  c.json(body, 200, { 'cache-control': `public, max-age=${maxAge}` })

api.get('/stores', async (c) => {
  const { results } = await c.env.DB.prepare('select id, chain_id, name, region, lat, lng, online, last_fetched_at from stores order by name').all<{ id: string; chain_id: string; name: string; region: string | null; lat: number | null; lng: number | null; online: number; last_fetched_at: string | null }>()
  return json(c, results.map((s) => ({ id: s.id, chain_id: s.chain_id, store_id: s.id.slice(s.id.indexOf(':') + 1), name: s.name, region: s.region, lat: s.lat, lng: s.lng, online_shopping: !!s.online, last_fetched_at: s.last_fetched_at })), 120)
})

api.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare('select id, level, parent_id, name from categories order by level, id').all()
  return json(c, results, 300)
})

api.get('/taxonomy-zh', async (c) => {
  const { results } = await c.env.DB.prepare('select name, min(name_zh) as zh from categories where name_zh is not null group by name order by name').all()
  return json(c, results, 300)
})

api.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare('select key, value from settings').all()
  return json(c, results, 60)
})

api.get('/recipes', async (c) => {
  const { results } = await c.env.DB.prepare('select id, week_start, reviewed, data from recipes where published = 1 order by week_start desc, id').all<{ id: string; week_start: string | null; reviewed: number; data: string }>()
  const rows = []
  for (const r of results) { try { rows.push({ id: r.id, week_start: r.week_start, reviewed: !!r.reviewed, data: JSON.parse(r.data) }) } catch { /* 壞掉的 JSON 跳過 */ } }
  return json(c, rows, 300)
})

const PRODUCT_COLS = 'p.key, p.display_name, p.brand, p.size, p.category_id, p.family_key, p.is_food, p.image_url, f.name_en as family_name_en, f.name_zh as family_name_zh'
const pickKeys = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((k): k is string => typeof k === 'string' && KEY.test(k)).slice(0, 500) : [])
const splitKeys = (v: string | undefined): string[] => pickKeys((v ?? '').split(',').map((s) => s.trim()).filter(Boolean))
api.get('/products', (c) => productsQuery(c, splitKeys(c.req.query('keys')), splitKeys(c.req.query('families'))))
api.post('/products', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { keys?: unknown; families?: unknown } | null
  return productsQuery(c, pickKeys(b?.keys), pickKeys(b?.families))
})
async function productsQuery(c: { env: Env; json: (b: unknown, s?: 200 | 400, h?: Record<string, string>) => Response }, keys: string[], fams: string[]) {
  if (!keys.length && !fams.length) return c.json({ error: 'keys 或 families 至少一個' }, 400)
  const out: unknown[] = []
  if (keys.length) {
    const { results } = await c.env.DB.prepare(`select ${PRODUCT_COLS} from json_each(?) k cross join products p on p.key = k.value left join families f on f.key = p.family_key`).bind(JSON.stringify(keys)).all()
    out.push(...results)
  }
  if (fams.length) {
    const { results } = await c.env.DB.prepare(`select ${PRODUCT_COLS} from json_each(?) k cross join products p on p.family_key = k.value left join families f on f.key = p.family_key`).bind(JSON.stringify(fams)).all()
    out.push(...results)
  }
  return c.json(out.map((r) => ({ ...(r as { is_food: number }), is_food: !!(r as { is_food: number }).is_food })), 200, { 'cache-control': 'no-store' })
}

api.get('/history/:key', async (c) => {
  const key = c.req.param('key')
  const stores = (c.req.query('stores') ?? '').split(',').map((s) => s.trim()).filter((s) => STORE_ID.test(s)).slice(0, 5)
  if (!KEY.test(key) || !stores.length) return c.json({ error: 'key 或 stores 不對' }, 400)
  const weeks = weeksBack(8)
  const since = weeks[weeks.length - 1]
  // 哪幾家店哪幾週有這個 key 在特價 → 店價優先、沒有就連鎖價
  const { results } = await c.env.DB.prepare(`
    with hit as (
      select ss.store_id, ss.week_start from store_specials ss, json_each(ss.product_keys) k
      where k.value = ?1 and ss.week_start >= ?2 and ss.store_id in (select value from json_each(?3))
    )
    select h.store_id, h.week_start, coalesce(sp.price, cp.price) as price, coalesce(sp.multi_buy, cp.multi_buy) as multi_buy
    from hit h
    left join store_prices sp on sp.store_id = h.store_id and sp.week_start = h.week_start and sp.product_key = ?1
    left join chain_prices cp on cp.chain_id = substr(h.store_id, 1, instr(h.store_id, ':') - 1) and cp.week_start = h.week_start and cp.product_key = ?1
    where coalesce(sp.price, cp.price) is not null
    order by h.week_start, h.store_id`).bind(key, since, JSON.stringify(stores)).all<{ store_id: string; week_start: string; price: number; multi_buy: string | null }>()
  return json(c, results.map((r) => ({ ...r, multi_buy: r.multi_buy ? JSON.parse(r.multi_buy) : null })), 300)
})

// ── 貨架價（階段 6） ─────────────────────────────────────────────────────────
const SHELF_COLS = 'ci.chain_id, ci.product_id, ci.product_key, ci.name_listed, ci.shelf_price, ci.shelf_price_unit, ci.shelf_unit_price, ci.shelf_unit_price_unit, ci.shelf_size, ci.shelf_at, p.display_name, p.brand, p.size, p.category_id, p.image_url'
interface ShelfRow { chain_id: string; product_id: string; product_key: string; name_listed: string | null; shelf_price: number; shelf_price_unit: string | null; shelf_unit_price: number | null; shelf_unit_price_unit: string | null; shelf_size: string | null; shelf_at: string | null; display_name: string | null; brand: string | null; size: string | null; category_id: string | null; image_url: string | null }
const chainOf = (storeId: string) => storeId.slice(0, storeId.indexOf(':'))
const storesOf = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter((s) => STORE_ID.test(s)).slice(0, 5)
/** 每家問的店各複製一份（同連鎖同價）；App 的 catalog 列是按店來的 */
function fanOut(rows: ShelfRow[], stores: string[]) {
  const out = []
  for (const r of rows) for (const st of stores) if (chainOf(st) === r.chain_id) out.push({
    store_id: st, product_id: r.product_id, product_key: r.product_key, name: r.name_listed ?? r.display_name ?? r.product_key.replace(/_/g, ' '), brand: r.brand,
    size: r.shelf_size ?? r.size, price: r.shelf_price, price_unit: r.shelf_price_unit ?? 'each', unit_price: r.shelf_unit_price, unit_price_unit: r.shelf_unit_price_unit,
    category_id: r.category_id, image_url: r.chain_id === 'woolworths' ? r.image_url : null, seen_at: r.shelf_at,
  })
  return out
}
const likeSafe = (w: string) => w.replace(/[\\%_]/g, (m) => '\\' + m)

api.get('/catalog', async (c) => {
  const stores = storesOf(c.req.query('stores'))
  const keys = (c.req.query('keys') ?? '').split(',').map((s) => s.trim()).filter((k) => KEY.test(k)).slice(0, 300)
  if (!stores.length || !keys.length) return c.json([], 200, { 'cache-control': 'no-store' })
  const chains = [...new Set(stores.map(chainOf))]
  const { results } = await c.env.DB.prepare(`select ${SHELF_COLS} from chain_items ci left join products p on p.key = ci.product_key where ci.shelf_price is not null and ci.chain_id in (select value from json_each(?1)) and ci.product_key in (select value from json_each(?2))`)
    .bind(JSON.stringify(chains), JSON.stringify(keys)).all<ShelfRow>()
  return c.json(fanOut(results, stores), 200, { 'cache-control': 'public, max-age=300' })
})

api.get('/catalog/search', async (c) => {
  const stores = storesOf(c.req.query('stores'))
  const words = (c.req.query('words') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((w) => w.length >= 2 && w.length <= 40).slice(0, 4)
  const l2 = c.req.query('l2') ?? ''
  const limit = Math.max(1, Math.min(1000, Number(c.req.query('limit') ?? 300) || 300))
  if (!stores.length || !words.length) return c.json([], 200, { 'cache-control': 'no-store' })
  if (l2 && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(l2)) return c.json({ error: 'l2 不對' }, 400)
  const chains = [...new Set(stores.map(chainOf))]
  const conds = words.map((_, i) => `lower(coalesce(ci.name_listed, p.display_name)) like ?${i + 3} escape '\\'`)
  const sql = `select ${SHELF_COLS} from chain_items ci left join products p on p.key = ci.product_key where ci.shelf_price is not null and ci.chain_id in (select value from json_each(?1)) and ${conds.join(' and ')}` + (l2 ? ` and p.category_id like ?${words.length + 3} escape '\\'` : '') + ` limit ?2`
  const binds: (string | number)[] = [JSON.stringify(chains), limit, ...words.map((w) => `%${likeSafe(w)}%`)]
  if (l2) binds.push(`${likeSafe(l2)}/%`)
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<ShelfRow>()
  return c.json(fanOut(results, stores), 200, { 'cache-control': 'public, max-age=300' })
})

api.get('/catalog/hint', async (c) => {
  const pid = (c.req.query('product_id') ?? '').trim(), store = c.req.query('store') ?? ''
  if (!pid || pid.length > 40 || !STORE_ID.test(store)) return c.json(null, 200, { 'cache-control': 'no-store' })
  const group = chainOf(store) === 'woolworths' ? ['woolworths'] : ['newworld', 'paknsave']
  const row = await c.env.DB.prepare('select ci.product_key as key, p.category_id from chain_items ci left join products p on p.key = ci.product_key where ci.product_id = ?1 and ci.chain_id in (select value from json_each(?2)) order by p.category_id is null limit 1')
    .bind(pid, JSON.stringify(group)).first<{ key: string; category_id: string | null }>()
  return c.json(row ?? null, 200, { 'cache-control': 'no-store' })
})

// ── 食譜照片（階段 6 第 5 塊：recipes-weekly.ts 上傳到 R2 recipes/<week>/<name>，取代 Supabase Storage）──
api.get('/recipes/img/:week/:name', async (c) => {
  const week = c.req.param('week'), name = c.req.param('name')
  if (!/^\d{4}-\d\d-\d\d$/.test(week) || !/^[a-z0-9-]{1,120}\.jpg$/i.test(name)) return c.json({ error: 'not found' }, 404)
  const obj = await c.env.DATA.get(`recipes/${week}/${name}`)
  if (!obj) return c.json({ error: 'not found' }, 404)
  return new Response(obj.body, { status: 200, headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', etag: obj.httpEtag } })
})

export default api
