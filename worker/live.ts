// 即時查價的 App 端（全國版階段 4，docs/stage4-contract.md §5 App 端）。掛在 /api；只註冊自己的路徑，不要 all('*')，不然會把 api.ts 的公開讀取全吃掉。
//
//   POST /api/price-requests                 要登入。送單（規則照 Supabase request_prices：開關、每人 200／天、全站 price_daily_cap、併單）→ { ids }
//   GET  /api/price-requests/status?ids=     [{ id, status, error, ahead }]
//   GET  /api/live-prices?stores=&keys=      live_prices 列（Supabase store_prices 的形狀）
//   GET  /api/name-matches?keys=             [{ chain, product_key, status, searched_at }]
//   GET  /api/chain-items?keys=              [{ chain, product_id, product_key }]（= Supabase product_ids）
//   GET  /api/chain-items?ids=               同上，用超市編號查（給 price-worker，階段 4 契約 §10）；keys 和 ids 可以一起給
//   GET  /api/chain-items/by-id?product_id=&chains=   [{ chain, product_key }]
//   GET  /api/search-results?ids=&term=      [{ store_id, candidates }]
//   GET  /api/products/search?zh=&limit=     [{ key, family_key, family_name_zh }]
//   POST /api/adopt-product                  公開。使用者採用搜到的候選 → products / chain_items / live_prices（規則照 Supabase adopt_product，沒有 catalog 那段）
//
// D1 的 price_requests 沒有 error 欄：失敗原因存在 result（JSON {error}），status 端點讀回來。
import { Hono } from 'hono'
import type { Env } from './env'
import { requireUser } from './session'

const live = new Hono<{ Bindings: Env }>()

const STORE_ID = /^[a-z]+:[A-Za-z0-9-]{1,64}$/
const KEY = /^[a-z0-9_.-]{1,200}$/i
const ADOPT_KEY = /^[a-z0-9_.]{3,120}$/
const CHAINS = ['woolworths', 'newworld', 'paknsave']
const NON_FOOD_L1 = ['beer-wine-and-cider', 'household-and-cleaning', 'pets', 'health-and-body', 'baby-and-toddler']
const NO_STORE = { 'cache-control': 'no-store' }

const now = () => new Date().toISOString()
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const DAY = 86400000
const chainOf = (storeId: string) => storeId.slice(0, storeId.indexOf(':'))
/** New World 和 PAK'nSAVE 共用編號 */
const chainGroup = (chain: string) => (chain === 'woolworths' ? ['woolworths'] : ['newworld', 'paknsave'])

/** 逗號分隔的網址參數 → 字串陣列（去空、去重） */
function list(raw: string | undefined, re: RegExp, max: number): string[] {
  return [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter((s) => s && re.test(s)))].slice(0, max)
}
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const parse = <T>(s: string | null, fallback: T): T => { if (s == null) return fallback; try { return JSON.parse(s) as T } catch { return fallback } }

async function settings(env: Env, keys: string[]): Promise<Record<string, string>> {
  try {
    const { results } = await env.DB.prepare('select key, value from settings where key in (select value from json_each(?))').bind(JSON.stringify(keys)).all<{ key: string; value: string | null }>()
    return Object.fromEntries(results.map((x) => [x.key, x.value ?? '']))
  } catch {
    return {}
  }
}

// ── 送單 ─────────────────────────────────────────────────────────────────────
interface ReqItem { store_id?: unknown; product_ids?: unknown; product_keys?: unknown; queries?: unknown }
interface OpenRow { id: string; items: string; queries: string | null }
interface Items { product_ids: string[]; product_keys: string[] }
const superset = (big: string[], small: string[]) => small.every((x) => big.includes(x))

live.post('/price-requests', async (c) => {
  const user = await requireUser(c)
  const cfg = await settings(c.env, ['live_prices', 'price_daily_cap'])
  if (cfg.live_prices === 'off') return c.json({ error: 'paused' }, 503)
  const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null
  const items = Array.isArray(body?.items) ? (body!.items as ReqItem[]) : null
  if (!items || !items.length || items.length > 5) return c.json({ error: 'bad_items' }, 400)

  const since = ago(DAY)
  const mine = await c.env.DB.prepare('select count(*) as n from price_requests where user_id = ? and created_at > ?').bind(user.id, since).first<{ n: number }>()
  if ((mine?.n ?? 0) >= 200) return c.json({ error: 'rate_limited' }, 429)
  const cap = Number(cfg.price_daily_cap) > 0 ? Number(cfg.price_daily_cap) : 5000
  const total = await c.env.DB.prepare('select count(*) as n from price_requests where created_at > ?').bind(since).first<{ n: number }>()
  if ((total?.n ?? 0) >= cap) return c.json({ error: 'busy' }, 429)

  const out: Array<string | null> = []
  for (const it of items) {
    const sid = typeof it?.store_id === 'string' ? it.store_id : ''
    const ids = [...new Set(strs(it?.product_ids).filter((x) => x.length >= 1 && x.length <= 40))]
    const keys = [...new Set(strs(it?.product_keys).filter((x) => x.length >= 1 && x.length <= 200))]
    const qs = [...new Set(strs(it?.queries).map((x) => x.trim()).filter((x) => x.length >= 1 && x.length <= 60))].slice(0, 5)
    if (!sid || !STORE_ID.test(sid) || (!ids.length && !keys.length && !qs.length) || ids.length > 300 || keys.length > 50) { out.push(null); continue }
    const store = await c.env.DB.prepare('select 1 as ok from stores where id = ?').bind(sid).first<{ ok: number }>()
    if (!store) { out.push(null); continue }
    // 併單：同店、還沒做完、5 分鐘內、既有單包含這次要的全部
    const { results: open } = await c.env.DB.prepare("select id, items, queries from price_requests where store_id = ? and status in ('pending', 'running') and created_at > ? order by created_at")
      .bind(sid, ago(5 * 60 * 1000)).all<OpenRow>()
    const hit = open.find((r) => {
      const have = parse<Partial<Items>>(r.items, {})
      return superset(have.product_ids ?? [], ids) && superset(have.product_keys ?? [], keys) && superset(parse<string[]>(r.queries, []), qs)
    })
    if (hit) { out.push(hit.id); continue }
    const id = crypto.randomUUID()
    await c.env.DB.prepare("insert into price_requests (id, user_id, store_id, items, queries, status, created_at) values (?, ?, ?, ?, ?, 'pending', ?)")
      .bind(id, user.id, sid, JSON.stringify({ product_ids: ids, product_keys: keys } satisfies Items), qs.length ? JSON.stringify(qs) : null, now()).run()
    out.push(id)
  }
  return c.json({ ids: out }, 200, NO_STORE)
})

live.get('/price-requests/status', async (c) => {
  const ids = list(c.req.query('ids'), /^[A-Za-z0-9-]{1,64}$/, 50)
  if (!ids.length) return c.json([], 200, NO_STORE)
  const { results } = await c.env.DB.prepare(`
    select r.id, r.status, r.result,
      case when r.status = 'pending' then (select count(*) from price_requests q where q.status in ('pending', 'running') and q.created_at < r.created_at) else 0 end as ahead
    from price_requests r join json_each(?) k on k.value = r.id`).bind(JSON.stringify(ids)).all<{ id: string; status: string; result: string | null; ahead: number }>()
  return c.json(results.map((r) => ({ id: r.id, status: r.status, error: parse<{ error?: string }>(r.result, {}).error ?? null, ahead: r.ahead })), 200, NO_STORE)
})

// ── 公開讀 ───────────────────────────────────────────────────────────────────
interface LiveRow {
  store_id: string; product_id: string; product_key: string | null; available: number; price: number | null; price_unit: string | null; was_price: number | null
  is_special: number | null; club_only: number | null; multi_buy: string | null; unit_price: number | null; unit_price_unit: string | null; name: string | null; fetched_at: string; source: string
}
live.get('/live-prices', async (c) => {
  const stores = list(c.req.query('stores'), STORE_ID, 5)
  const keys = list(c.req.query('keys'), KEY, 100)
  if (!stores.length || !keys.length) return c.json([], 200, NO_STORE)
  const { results } = await c.env.DB.prepare('select * from live_prices where store_id in (select value from json_each(?1)) and product_key in (select value from json_each(?2))')
    .bind(JSON.stringify(stores), JSON.stringify(keys)).all<LiveRow>()
  return c.json(results.map((r) => ({ ...r, available: !!r.available, is_special: !!r.is_special, club_only: !!r.club_only, multi_buy: parse(r.multi_buy, null) })), 200, NO_STORE)
})

live.get('/name-matches', async (c) => {
  const keys = list(c.req.query('keys'), KEY, 200)
  if (!keys.length) return c.json([], 200, NO_STORE)
  const { results } = await c.env.DB.prepare('select chain_id as chain, product_key, status, searched_at from name_matches where product_key in (select value from json_each(?))').bind(JSON.stringify(keys)).all()
  return c.json(results, 200, NO_STORE)
})

live.get('/chain-items', async (c) => {
  const keys = list(c.req.query('keys'), KEY, 200)
  const ids = list(c.req.query('ids'), /^[A-Za-z0-9-]{1,40}$/, 300)
  if (!keys.length && !ids.length) return c.json([], 200, NO_STORE)
  const out: unknown[] = []
  if (keys.length) out.push(...(await c.env.DB.prepare('select chain_id as chain, product_id, product_key from chain_items where product_key in (select value from json_each(?))').bind(JSON.stringify(keys)).all()).results)
  if (ids.length) out.push(...(await c.env.DB.prepare('select chain_id as chain, product_id, product_key from chain_items where product_id in (select value from json_each(?))').bind(JSON.stringify(ids)).all()).results)
  return c.json(out, 200, NO_STORE)
})

live.get('/chain-items/by-id', async (c) => {
  const pid = (c.req.query('product_id') ?? '').trim()
  const chains = list(c.req.query('chains'), /^[a-z]{1,20}$/, 3).filter((x) => CHAINS.includes(x))
  if (!pid || pid.length > 40 || !chains.length) return c.json([], 200, NO_STORE)
  const { results } = await c.env.DB.prepare('select chain_id as chain, product_key from chain_items where product_id = ? and chain_id in (select value from json_each(?))').bind(pid, JSON.stringify(chains)).all()
  return c.json(results, 200, NO_STORE)
})

live.get('/search-results', async (c) => {
  const ids = list(c.req.query('ids'), /^[A-Za-z0-9-]{1,64}$/, 10)
  const term = (c.req.query('term') ?? '').trim()
  if (!ids.length || !term || term.length > 60) return c.json([], 200, NO_STORE)
  const { results } = await c.env.DB.prepare('select store_id, candidates from search_results where request_id in (select value from json_each(?)) and term = ?').bind(JSON.stringify(ids), term).all<{ store_id: string; candidates: string }>()
  return c.json(results.map((r) => ({ store_id: r.store_id, candidates: parse<unknown[]>(r.candidates, []) })), 200, NO_STORE)
})

live.get('/products/search', async (c) => {
  const zh = (c.req.query('zh') ?? '').trim().slice(0, 40)
  const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') ?? 500) || 500))
  if (!zh) return c.json([], 200, NO_STORE)
  const pat = '%' + zh.replace(/[\\%_]/g, (m) => '\\' + m) + '%'
  const { results } = await c.env.DB.prepare("select p.key, p.family_key, f.name_zh as family_name_zh from products p join families f on f.key = p.family_key where f.name_zh like ? escape '\\' limit ?").bind(pat, limit).all()
  return c.json(results, 200, { 'cache-control': 'public, max-age=300' })
})

// ── 採用搜到的候選 ──────────────────────────────────────────────────────────
interface Cand { product_id?: string; name?: string; brand?: string | null; size?: string | null; price?: number | null; price_unit?: string | null; was_price?: number | null; unit_price?: number | null; unit_price_unit?: string | null; promo_type?: string | null; club_only?: boolean | null }
/** 品牌＋品名＋規格（同爬蟲 client.ts 的 displayName：品名已含品牌／規格就不重複） */
function candName(e: Cand): string {
  const name = (e.name ?? '').trim(), brand = (e.brand ?? '').trim(), size = (e.size ?? '').trim()
  const parts = [brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? brand : '', name, size && !name.toLowerCase().includes(size.toLowerCase()) ? size : '']
  return parts.filter(Boolean).join(' ')
}
/** 一天內搜到這個編號的候選（最新一筆）：store 給了就限那家店，不然限那家連鎖 */
async function findCand(env: Env, pid: string, where: { store?: string; chain?: string }, needPrice: boolean): Promise<{ cand: Cand; at: string } | null> {
  const cond = where.store ? 'sr.store_id = ?2' : "sr.store_id like ?2 || ':%'"
  const row = await env.DB.prepare(`
    select e.value as cand, sr.created_at as at from search_results sr, json_each(sr.candidates) e
    where ${cond} and sr.created_at > ?3 and json_extract(e.value, '$.product_id') = ?1 ${needPrice ? "and json_extract(e.value, '$.price') is not null" : ''}
    order by sr.created_at desc limit 1`).bind(pid, where.store ?? where.chain, ago(DAY)).first<{ cand: string; at: string }>()
  if (!row) return null
  return { cand: parse<Cand>(row.cand, {}), at: row.at }
}

live.post('/adopt-product', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { chain?: unknown; product_id?: unknown; key?: unknown; name?: unknown; category_id?: unknown; store_id?: unknown } | null
  const chain = typeof b?.chain === 'string' ? b.chain : ''
  if (!CHAINS.includes(chain)) return c.json({ error: 'bad_chain' }, 400)
  const pid = typeof b?.product_id === 'string' ? b.product_id : ''
  if (pid.length < 1 || pid.length > 40) return c.json({ error: 'bad_product_id' }, 400)
  const key = typeof b?.key === 'string' ? b.key : ''
  if (!ADOPT_KEY.test(key)) return c.json({ error: 'bad_key' }, 400)
  const pname = typeof b?.name === 'string' ? b.name.trim() : ''
  if (pname.length < 1 || pname.length > 200) return c.json({ error: 'bad_name' }, 400)
  const storeId = typeof b?.store_id === 'string' && b.store_id ? b.store_id : null
  if (storeId) {
    if (!STORE_ID.test(storeId) || chainOf(storeId) !== chain) return c.json({ error: 'bad_store' }, 400)
    const s = await c.env.DB.prepare('select 1 as ok from stores where id = ?').bind(storeId).first()
    if (!s) return c.json({ error: 'bad_store' }, 400)
  }

  // 價格來源（名字也從這裡拿）：這家店一天內搜到、有價的候選 → 沒有就只拿這家連鎖任一筆當名字（不寫價）
  const priced = storeId ? await findCand(c.env, pid, { store: storeId }, true) : null
  const any = priced ?? (await findCand(c.env, pid, { chain }, false))
  if (!any) return c.json({ error: 'unknown_product' }, 400)   // 這家連鎖一天內沒搜到過這個編號
  const nm = (candName(any.cand) || pname).slice(0, 200)

  const catId = typeof b?.category_id === 'string' && b.category_id ? b.category_id : null
  const cat = catId ? await c.env.DB.prepare('select id from categories where id = ?').bind(catId).first<{ id: string }>() : null
  const isFood = cat ? !NON_FOOD_L1.includes(cat.id.split('/')[0]) : true

  // 編號已有的 key 優先（Foodstuffs 只有一家記過也沿用；同連鎖的先）
  const group = chainGroup(chain)
  const have = await c.env.DB.prepare('select product_key from chain_items where product_id = ?1 and chain_id in (select value from json_each(?2)) order by (chain_id = ?3) desc limit 1')
    .bind(pid, JSON.stringify(group), chain).first<{ product_key: string }>()
  const effKey = have?.product_key ?? key

  const stmts = [
    c.env.DB.prepare('insert into products (key, display_name, category_id, is_food) values (?, ?, ?, ?) on conflict (key) do nothing').bind(effKey, nm, cat?.id ?? null, isFood ? 1 : 0),
    ...group.map((ch) => c.env.DB.prepare('insert into chain_items (chain_id, product_id, product_key, name_listed, seen_at) values (?, ?, ?, ?, ?) on conflict (chain_id, product_id) do nothing').bind(ch, pid, effKey, nm, now())),
  ]
  if (storeId && priced) {
    const e = priced.cand
    stmts.push(c.env.DB.prepare(`
      insert into live_prices (store_id, product_id, product_key, available, price, price_unit, was_price, is_special, club_only, multi_buy, unit_price, unit_price_unit, name, fetched_at, source)
      values (?, ?, ?, 1, ?, ?, ?, ?, ?, null, ?, ?, ?, ?, 'user')
      on conflict (store_id, product_id) do update set
        product_key = excluded.product_key, available = 1, price = excluded.price, price_unit = excluded.price_unit, was_price = excluded.was_price,
        is_special = excluded.is_special, club_only = excluded.club_only, multi_buy = excluded.multi_buy, unit_price = excluded.unit_price,
        unit_price_unit = excluded.unit_price_unit, name = excluded.name, fetched_at = excluded.fetched_at, source = excluded.source
      where live_prices.fetched_at is null or live_prices.fetched_at <= excluded.fetched_at`)
      .bind(storeId, pid, effKey, e.price ?? null, e.price_unit ?? null, e.was_price ?? null, e.promo_type != null ? 1 : 0, e.club_only ? 1 : 0, e.unit_price ?? null, e.unit_price_unit ?? null, nm, priced.at))
  }
  await c.env.DB.batch(stmts)
  return c.json({ ok: true, key: effKey }, 200, NO_STORE)
})

export default live
