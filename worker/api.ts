// /api/*（公開讀，階段 3，2026-10-25；docs/national-plan.md §3）：App 開 ?src=d1 之後改向這裡拿資料，不再直接讀 Supabase。
// 回的形狀照 App 原本從 Supabase 拿到的（欄位名一樣），前端只換資料來源不改畫面。
//
//   GET  /api/stores                    stores（App 的 Store 形狀：online_shopping、store_id 由 id 拆）
//   GET  /api/categories                categories {id, level, parent_id, name}
//   GET  /api/taxonomy-zh               [{name, zh}]（從 categories.name_zh 來）
//   GET  /api/settings                  [{key, value}]
//   GET  /api/recipes                   published 的食譜 {id, week_start, reviewed, data}
//   POST /api/products {keys?, families?}   products（含同類名字），最多 500 個
//   GET  /api/history/:key?stores=a,b   近 8 週這個商品在這幾家店的價格 {store_id, week_start, price, multi_buy}
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
api.post('/products', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { keys?: unknown; families?: unknown } | null
  const keys = Array.isArray(b?.keys) ? (b!.keys as unknown[]).filter((k): k is string => typeof k === 'string' && KEY.test(k)).slice(0, 500) : []
  const fams = Array.isArray(b?.families) ? (b!.families as unknown[]).filter((k): k is string => typeof k === 'string' && KEY.test(k)).slice(0, 500) : []
  if (!keys.length && !fams.length) return c.json({ error: 'keys 或 families 至少一個' }, 400)
  const out: unknown[] = []
  if (keys.length) {
    const { results } = await c.env.DB.prepare(`select ${PRODUCT_COLS} from products p join json_each(?) k on k.value = p.key left join families f on f.key = p.family_key`).bind(JSON.stringify(keys)).all()
    out.push(...results)
  }
  if (fams.length) {
    const { results } = await c.env.DB.prepare(`select ${PRODUCT_COLS} from products p join json_each(?) k on k.value = p.family_key left join families f on f.key = p.family_key`).bind(JSON.stringify(fams)).all()
    out.push(...results)
  }
  return c.json(out.map((r) => ({ ...(r as { is_food: number }), is_food: !!(r as { is_food: number }).is_food })), 200, { 'cache-control': 'no-store' })
})

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

export default api
