// /ingest/*：Mac mini 的爬蟲把抓到的東西送進 D1（docs/national-plan.md §3「爬蟲與 price-worker」、§6 階段 2，2026-10-25）。
// Bearer token 在 index.ts 的中介層驗過才進得來。每批最多 1,000 列、全部 upsert、重送同一批結果一樣。
//
//   POST /ingest/run/start                 {kind, started_at} → {id}
//   POST /ingest/run/:id/store             {store?, ok, rows, requests, seconds, added, changed, removed, suspect, error, slices, badges, tree}
//   POST /ingest/run/:id/finish            {finished_at, stores_total, stores_ok, stores_failed, rows, requests, report}
//   POST /ingest/products | chain-items | chain-prices | store-prices | store-specials | store-items   {rows:[…]} → {upserted}
//   POST /ingest/snapshot/:store/:week     重建 R2 快照 → {rows, bytes}
//   POST /ingest/prune                     {keep_weeks} 刪舊週（D1 三張價格表 + R2 快照留 2 週；price_changes 留 30 天）
//   POST /ingest/price-changes             {rows:[…]} 變動記錄（階段 6 第 1 塊，爬蟲每店比對出的新上架／改價／下架；≤ 1,000 列）
//   階段 5（docs/stage5-contract.md §3）：
//   POST /ingest/product-dict | family-dict | taxonomy-map   {rows:[…]} → {upserted}（family-dict 同時套到 products / families）
//   GET  /ingest/taxonomy-map              全部列
//   GET  /ingest/product-dict | family-dict ?after=&limit=   字典整份分頁讀（階段 6 第 2 塊，爬蟲 loadDict / loadFamilies 改讀這裡）
//   階段 6 第 3 塊（抓完後處理改讀 D1）：
//   GET  /ingest/products?after=&limit=        {rows:[{key, display_name, category_id, family_key}], next}（familyPass）
//   GET  /ingest/chain-items?chain=&after=&limit=   {rows:[chain_items ＋ products 的名字分類], next}（recat 用 category_path）
//   GET  /ingest/item?chains=a,b&product_id=   一個編號在這群連鎖的列（decide_pair 要兩邊的名字規格）
//   GET  /ingest/specials-stores?week=         這週有 store_specials 的店（回填分類後逐店重建快照）
//   階段 6 第 5 塊（報告信、每週食譜改讀寫 D1）：
//   GET  /ingest/report?started_at=&week=     報告信要的全部：待審數、心跳、24h 查價次數、24h 變動記錄、上一次抓取時間、分類數量變動、本週食譜待審、最新一次抓取（含每店）
//   GET  /ingest/recipes?week=&source=&id=    食譜列（含未上架；data 解成物件）
//   POST /ingest/recipes {rows}               upsert
//   POST /ingest/recipes/:id/data {data, require_unreviewed?, require_no_baby?}   只換 data（寶寶支線補寫用的守門）
//   POST /ingest/recipes/prune {week, keep_ids}   刪這週還沒人碰過的 AI 食譜（不在 keep_ids 裡的）
//   PUT  /ingest/recipes/image/:week/:name    JPEG 原始 bytes → R2 recipes/<week>/<name> → {url}（公開 GET /api/recipes/img/<week>/<name>）
//   階段 6 第 6 塊（停雙寫，weekly 不再碰 Supabase）：
//   GET  /ingest/last-runs?limit=6            最近幾次抓取的 report.trees 與每店 badges / tree（保命比對用）
//   GET  /ingest/catalog-age                  每家店上次翻貨架的時間 [{id, catalog_at}]
//   POST /ingest/catalog-done/:store          翻完貨架：stores.catalog_at = now
//   POST /ingest/admin-jobs/claim          {kinds?, limit?} → {jobs}（pending → running）
//   POST /ingest/admin-jobs/:id/result     {status: done|failed, log?}
//   POST /ingest/health                    {at?, load, top, chrome, orphan, mem_free_mb}
import { Hono } from 'hono'
import type { Env } from './env'
import { writeSnapshot } from './snapshot'

type Row = Record<string, unknown>
interface Spec {
  table: string
  cols: string[]
  pk: string[]
  /** 新值是 null 就留舊值（coalesce），例如 products.family_key 是後端 GPT 定的，爬蟲送 null 不能把它洗掉 */
  keep?: string[]
}

const PRICE_COLS = ['product_key', 'week_start', 'price', 'regular_price', 'member_price', 'multi_buy', 'badges', 'price_unit', 'unit_price', 'unit_price_unit', 'promo_type']
const SPECS: Record<string, Spec> = {
  // is_food 也 keep：階段 6 的後處理只送 {key, display_name, family_key} 或 {…, category_id} 這種部分列，不帶 is_food（not null）就留舊值；新列沒帶就 default 1（coalesce 到 null 會撞 not null，所以 upsertSql 另外處理）
  'products': { table: 'products', cols: ['key', 'display_name', 'brand', 'size', 'category_id', 'family_key', 'is_food', 'image_url'], pk: ['key'], keep: ['brand', 'size', 'category_id', 'family_key', 'image_url', 'is_food'] },
  // 階段 6：貨架價也在這張表（docs/national-plan.md §2.2）。特價那次不帶 shelf_*（送 null），coalesce 留舊值；翻貨架那次帶
  'chain-items': { table: 'chain_items', cols: ['chain_id', 'product_id', 'product_key', 'name_listed', 'url', 'seen_at', 'shelf_price', 'shelf_price_unit', 'shelf_unit_price', 'shelf_unit_price_unit', 'shelf_size', 'shelf_at', 'category_path'], pk: ['chain_id', 'product_id'], keep: ['name_listed', 'url', 'shelf_price', 'shelf_price_unit', 'shelf_unit_price', 'shelf_unit_price_unit', 'shelf_size', 'shelf_at', 'category_path'] },
  'chain-prices': { table: 'chain_prices', cols: ['chain_id', ...PRICE_COLS], pk: ['chain_id', 'product_key', 'week_start'] },
  'store-prices': { table: 'store_prices', cols: ['store_id', ...PRICE_COLS], pk: ['store_id', 'product_key', 'week_start'] },
  'store-specials': { table: 'store_specials', cols: ['store_id', 'week_start', 'product_keys'], pk: ['store_id', 'week_start'] },
  'store-items': { table: 'store_items', cols: ['store_id', 'product_key', 'seen_at'], pk: ['store_id', 'product_key'] },
  // 階段 5：三本字典（= Supabase product_dict / family_dict / taxonomy_map）
  'product-dict': { table: 'product_dict', cols: ['dict_key', 'product_key', 'matched_to', 'confidence', 'source', 'updated_at'], pk: ['dict_key'] },
  'family-dict': { table: 'family_dict', cols: ['product_key', 'family_key', 'name_en', 'name_zh', 'confidence', 'source', 'cat2', 'updated_at'], pk: ['product_key'] },
  'taxonomy-map': { table: 'taxonomy_map', cols: ['level', 'ww_path', 'fs_path', 'ww_key', 'status', 'score', 'note', 'updated_at'], pk: ['level', 'ww_path'] },
}
const MAX_ROWS = 1000
const BATCH = 100                       // 一次 D1 batch 幾條 statement
const STORE_ID = /^[a-z]+:[A-Za-z0-9-]{1,64}$/
const WEEK = /^\d{4}-\d\d-\d\d$/

/** JS 值 → SQLite 值：undefined → null、布林 → 0/1、物件／陣列 → JSON 字串 */
function sqlVal(v: unknown): string | number | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function upsertSql(s: Spec) {
  const set = s.cols.filter((c) => !s.pk.includes(c)).map((c) => (s.keep?.includes(c) ? `${c} = coalesce(excluded.${c}, ${s.table}.${c})` : `${c} = excluded.${c}`))
  return `insert into ${s.table} (${s.cols.join(', ')}) values (${s.cols.map(() => '?').join(', ')}) on conflict (${s.pk.join(', ')}) do update set ${set.join(', ')}`
}

async function upsertRows(env: Env, s: Spec, rows: Row[]) {
  const stmt = env.DB.prepare(upsertSql(s))
  for (let i = 0; i < rows.length; i += BATCH) {
    await env.DB.batch(rows.slice(i, i + BATCH).map((r) => stmt.bind(...s.cols.map((c) => (s.table === 'products' && c === 'is_food' && r[c] == null) ? 1 : sqlVal(r[c])))))   // products.is_food not null：沒帶當 1（已有的列 keep 留舊值）
  }
  return rows.length
}

async function readRows(c: { req: { json: () => Promise<unknown> } }): Promise<Row[] | string> {
  let body: unknown
  try { body = await c.req.json() } catch { return 'body 不是 JSON' }
  const rows = (body as { rows?: unknown })?.rows
  if (!Array.isArray(rows) || rows.length === 0) return 'rows 要是非空陣列'
  if (rows.length > MAX_ROWS) return `一批最多 ${MAX_ROWS} 列`
  if (rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) return '每一列要是物件'
  return rows as Row[]
}

const now = () => new Date().toISOString()

const ingest = new Hono<{ Bindings: Env }>()

// ── 批次 upsert ──────────────────────────────────────────────────────────────
ingest.post('/:kind{products|chain-items|chain-prices|store-prices|store-specials|store-items|product-dict|family-dict|taxonomy-map}', async (c) => {
  const kind = c.req.param('kind')
  const spec = SPECS[kind]
  const rows = await readRows(c)
  if (typeof rows === 'string') return c.json({ error: rows }, 400)
  const bad = rows.findIndex((r) => spec.pk.some((k) => r[k] === undefined || r[k] === null || r[k] === ''))
  if (bad >= 0) return c.json({ error: `第 ${bad} 列缺主鍵 ${spec.pk.join('+')}` }, 400)
  const upserted = await upsertRows(c.env, spec, rows)
  if (kind === 'family-dict') {   // 字典是正本，products.family_key / families 是套用結果：一起改
    const fams = new Map<string, Row>()
    for (const r of rows) if (typeof r.family_key === 'string') fams.set(r.family_key, r)
    const famStmt = c.env.DB.prepare('insert into families (key, name_en, name_zh) values (?, ?, ?) on conflict (key) do update set name_en = coalesce(excluded.name_en, families.name_en), name_zh = coalesce(excluded.name_zh, families.name_zh)')
    const prodStmt = c.env.DB.prepare('update products set family_key = ? where key = ?')
    const stmts = [...[...fams.values()].map((r) => famStmt.bind(r.family_key, sqlVal(r.name_en), sqlVal(r.name_zh))), ...rows.map((r) => prodStmt.bind(r.family_key, r.product_key))]
    for (let i = 0; i < stmts.length; i += BATCH) await c.env.DB.batch(stmts.slice(i, i + BATCH))
  }
  return c.json({ upserted })
})

// 階段 6 第 2 塊：字典正本改 D1，爬蟲開工先整份讀回來。用主鍵分頁（?after=<上一頁最後的主鍵>&limit=5000），全部回完 next 是 null。
ingest.get('/product-dict', async (c) => {
  const after = c.req.query('after') ?? '', limit = Math.max(1, Math.min(10000, Number(c.req.query('limit') ?? 5000) || 5000))
  const { results } = await c.env.DB.prepare('select dict_key, product_key, matched_to, confidence, source, updated_at from product_dict where dict_key > ? order by dict_key limit ?').bind(after, limit).all<{ dict_key: string }>()
  return c.json({ rows: results, next: results.length === limit ? results[results.length - 1].dict_key : null })
})
ingest.get('/family-dict', async (c) => {
  const after = c.req.query('after') ?? '', limit = Math.max(1, Math.min(10000, Number(c.req.query('limit') ?? 5000) || 5000))
  const { results } = await c.env.DB.prepare('select product_key, family_key, name_en, name_zh, confidence, source, cat2, updated_at from family_dict where product_key > ? order by product_key limit ?').bind(after, limit).all<{ product_key: string }>()
  return c.json({ rows: results, next: results.length === limit ? results[results.length - 1].product_key : null })
})

ingest.get('/products', async (c) => {
  const after = c.req.query('after') ?? '', limit = Math.max(1, Math.min(10000, Number(c.req.query('limit') ?? 5000) || 5000))
  const { results } = await c.env.DB.prepare('select key, display_name, category_id, family_key from products where key > ? order by key limit ?').bind(after, limit).all<{ key: string }>()
  return c.json({ rows: results, next: results.length === limit ? results[results.length - 1].key : null })
})
const ITEM_COLS = 'ci.chain_id, ci.product_id, ci.product_key, ci.name_listed, ci.category_path, ci.shelf_size, ci.shelf_price, ci.shelf_price_unit, p.display_name, p.brand, p.size, p.category_id'
ingest.get('/chain-items', async (c) => {
  const chain = c.req.query('chain') ?? ''
  if (!CHAINS.includes(chain)) return c.json({ error: 'chain 要是 newworld / paknsave / woolworths' }, 400)
  const after = c.req.query('after') ?? '', limit = Math.max(1, Math.min(10000, Number(c.req.query('limit') ?? 5000) || 5000))
  const { results } = await c.env.DB.prepare(`select ${ITEM_COLS} from chain_items ci left join products p on p.key = ci.product_key where ci.chain_id = ? and ci.product_id > ? order by ci.product_id limit ?`).bind(chain, after, limit).all<{ product_id: string }>()
  return c.json({ rows: results, next: results.length === limit ? results[results.length - 1].product_id : null })
})
ingest.get('/item', async (c) => {
  const pid = (c.req.query('product_id') ?? '').trim()
  const chains = (c.req.query('chains') ?? '').split(',').map((x) => x.trim()).filter((x) => CHAINS.includes(x))
  if (!pid || pid.length > 40 || !chains.length) return c.json({ error: 'product_id / chains 不對' }, 400)
  const row = await c.env.DB.prepare(`select ${ITEM_COLS} from chain_items ci left join products p on p.key = ci.product_key where ci.product_id = ? and ci.chain_id in (select value from json_each(?)) order by ci.seen_at desc limit 1`).bind(pid, JSON.stringify(chains)).first()
  return c.json(row ?? null)
})
ingest.get('/specials-stores', async (c) => {
  const week = c.req.query('week') ?? ''
  if (!WEEK.test(week)) return c.json({ error: 'week 要是 YYYY-MM-DD' }, 400)
  const { results } = await c.env.DB.prepare('select store_id from store_specials where week_start = ? order by store_id').bind(week).all<{ store_id: string }>()
  return c.json(results.map((r) => r.store_id))
})

// ── 報告信（階段 6 第 5 塊）────────────────────────────────────────────────
ingest.get('/report', async (c) => {
  const startedAt = c.req.query('started_at') || now()
  const week = c.req.query('week') ?? ''
  const since = new Date(Date.now() - 86400000).toISOString()
  const [pairs, names, hb, live, changes, prev, trees, latest] = await c.env.DB.batch([
    c.env.DB.prepare("select count(*) as n from product_dict where source = 'ai' and matched_to is not null and confidence < 0.8"),
    c.env.DB.prepare("select count(*) as n from name_matches where status = 'review'"),
    c.env.DB.prepare("select at, info from heartbeats where name = 'price-worker'"),
    c.env.DB.prepare('select count(*) as n from price_requests where created_at > ?').bind(since),
    c.env.DB.prepare('select at, chain, kind, name, store_id, old_text, new_text from price_changes where at > ? order by at desc limit 5000').bind(since),
    c.env.DB.prepare("select started_at from crawl_runs where kind in ('daily', 'hourly', 'weekly') and started_at < ? and stores_ok > 1 order by started_at desc limit 1").bind(startedAt),
    c.env.DB.prepare('select report from crawl_runs where started_at > ? and report is not null').bind(since),
    c.env.DB.prepare('select * from crawl_runs where stores_ok > 1 order by started_at desc limit 1'),
  ])
  const n = (r: D1Result) => Number((r.results[0] as { n?: number } | undefined)?.n ?? 0)
  const beat = hb.results[0] as { at: string; info: string | null } | undefined
  const treeChanges = (trees.results as { report: string }[]).flatMap((r) => { const rep = parseJson<{ treeChanges?: unknown[] }>(r.report, {}); return Array.isArray(rep.treeChanges) ? rep.treeChanges : [] })
  let recipes: { pending: number; baby: number } | null = null
  if (WEEK.test(week)) {
    const r = await c.env.DB.prepare("select count(*) as n, sum(json_extract(data, '$.baby_branch') is not null) as baby from recipes where week_start = ? and source = 'ai' and published = 0 and reviewed = 0").bind(week).first<{ n: number; baby: number | null }>()
    recipes = { pending: Number(r?.n ?? 0), baby: Number(r?.baby ?? 0) }
  }
  const run = latest.results[0] as Record<string, unknown> | undefined
  let latestRun: unknown = null
  if (run) {
    const { results: cs } = await c.env.DB.prepare('select cs.*, s.name as store_name from crawl_stores cs left join stores s on s.id = cs.store_id where cs.run_id = ?').bind(run.id as string).all<Record<string, unknown>>()
    latestRun = { run: { ...run, report: parseJson<unknown>(run.report as string, null) }, stores: cs.map((r) => ({ ...r, ok: !!r.ok, suspect: !!r.suspect, ms: r.seconds == null ? null : Math.round(Number(r.seconds) * 1000) })) }
  }
  return c.json({
    pairs: n(pairs), names: n(names), heartbeat: beat ? { at: beat.at, info: parseJson<unknown>(beat.info, null) } : null, liveReqs: n(live),
    changes: changes.results, prevAt: (prev.results[0] as { started_at?: string } | undefined)?.started_at ?? null, treeChanges, recipes, latestRun,
  })
})

// ── 食譜（階段 6 第 5 塊：recipes-weekly.ts 的讀寫）────────────────────────────
const recipeRow = (r: { id: string; week_start: string | null; source: string; published: number; reviewed: number; data: string; updated_at: string | null }) =>
  ({ id: r.id, week_start: r.week_start, source: r.source, published: !!r.published, reviewed: !!r.reviewed, data: parseJson<unknown>(r.data, null), updated_at: r.updated_at })
type RecipeDb = Parameters<typeof recipeRow>[0]
ingest.get('/recipes', async (c) => {
  const week = c.req.query('week'), source = c.req.query('source'), id = c.req.query('id')
  const conds: string[] = [], binds: string[] = []
  if (id) { conds.push('id = ?'); binds.push(id) }
  if (week) { if (!WEEK.test(week)) return c.json({ error: 'week 不對' }, 400); conds.push('week_start = ?'); binds.push(week) }
  if (source) { conds.push('source = ?'); binds.push(source) }
  const { results } = await c.env.DB.prepare('select id, week_start, source, published, reviewed, data, updated_at from recipes' + (conds.length ? ' where ' + conds.join(' and ') : '') + ' order by id').bind(...binds).all<RecipeDb>()
  return c.json(results.map(recipeRow))
})
ingest.post('/recipes', async (c) => {
  const rows = await readRows(c)
  if (typeof rows === 'string') return c.json({ error: rows }, 400)
  const bad = rows.findIndex((r) => typeof r.id !== 'string' || !r.data || typeof r.data !== 'object')
  if (bad >= 0) return c.json({ error: `第 ${bad} 列缺 id 或 data` }, 400)
  const stmt = c.env.DB.prepare('insert into recipes (id, week_start, source, published, reviewed, data, updated_at) values (?, ?, ?, ?, ?, ?, ?) on conflict (id) do update set week_start = excluded.week_start, source = excluded.source, published = excluded.published, reviewed = excluded.reviewed, data = excluded.data, updated_at = excluded.updated_at')
  const t = now()
  for (let i = 0; i < rows.length; i += BATCH) await c.env.DB.batch(rows.slice(i, i + BATCH).map((r) => stmt.bind(r.id, sqlVal(r.week_start), (r.source as string) ?? 'ai', r.published ? 1 : 0, r.reviewed ? 1 : 0, JSON.stringify(r.data), (r.updated_at as string) ?? t)))
  return c.json({ upserted: rows.length })
})
ingest.post('/recipes/:id/data', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { data?: unknown; require_unreviewed?: boolean; require_no_baby?: boolean } | null
  if (!b?.data || typeof b.data !== 'object') return c.json({ error: 'data 要是物件' }, 400)
  let sql = 'update recipes set data = ?, updated_at = ? where id = ?'
  if (b.require_unreviewed) sql += ' and published = 0 and reviewed = 0'
  if (b.require_no_baby) sql += " and json_extract(data, '$.baby_branch') is null"
  const r = await c.env.DB.prepare(sql).bind(JSON.stringify(b.data), now(), c.req.param('id')).run()
  return c.json({ changed: r.meta.changes })
})
ingest.post('/recipes/prune', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { week?: string; keep_ids?: unknown }
  if (!b.week || !WEEK.test(b.week)) return c.json({ error: 'week 不對' }, 400)
  const keep = strList(b.keep_ids)
  const r = await c.env.DB.prepare("delete from recipes where week_start = ? and source = 'ai' and published = 0 and reviewed = 0 and id not in (select value from json_each(?))").bind(b.week, JSON.stringify(keep)).run()
  return c.json({ deleted: r.meta.changes })
})
ingest.put('/recipes/image/:week/:name', async (c) => {
  const week = c.req.param('week'), name = c.req.param('name')
  if (!WEEK.test(week) || !/^[a-z0-9-]{1,120}\.jpg$/i.test(name)) return c.json({ error: 'week / name 不對' }, 400)
  const body = await c.req.arrayBuffer()
  if (!body.byteLength || body.byteLength > 5 * 1024 * 1024) return c.json({ error: '圖要在 5 MB 內' }, 400)
  const key = `recipes/${week}/${name}`
  await c.env.DATA.put(key, body, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } })
  return c.json({ key, url: `${new URL(c.req.url).origin}/api/recipes/img/${week}/${name}`, bytes: body.byteLength })
})

// ── 停雙寫（階段 6 第 6 塊）：weekly 開頭要的上一次數字 ────────────────────────
ingest.get('/last-runs', async (c) => {
  const limit = Math.max(1, Math.min(20, Number(c.req.query('limit') ?? 6) || 6))
  const { results: runs } = await c.env.DB.prepare('select id, kind, started_at, report from crawl_runs order by started_at desc limit ?').bind(limit).all<{ id: string; kind: string; started_at: string; report: string | null }>()
  if (!runs.length) return c.json({ runs: [], stores: [] })
  const { results: stores } = await c.env.DB.prepare('select run_id, store_id, ok, badges, tree from crawl_stores where run_id in (select value from json_each(?))').bind(JSON.stringify(runs.map((r) => r.id))).all<{ run_id: string; store_id: string; ok: number; badges: string | null; tree: string | null }>()
  return c.json({
    runs: runs.map((r) => { const rep = parseJson<{ trees?: unknown }>(r.report, {}); return { id: r.id, kind: r.kind, started_at: r.started_at, trees: rep.trees ?? null } }),
    stores: stores.map((s) => ({ run_id: s.run_id, store_id: s.store_id, ok: !!s.ok, badges: parseJson<unknown>(s.badges, null), tree: parseJson<unknown>(s.tree, null) })),
  })
})
ingest.get('/catalog-age', async (c) => {
  const { results } = await c.env.DB.prepare('select id, catalog_at from stores').all<{ id: string; catalog_at: string | null }>()
  return c.json(results)
})
ingest.post('/catalog-done/:store', async (c) => {
  const storeId = c.req.param('store')
  if (!STORE_ID.test(storeId)) return c.json({ error: 'store 不對' }, 400)
  const r = await c.env.DB.prepare('update stores set catalog_at = ? where id = ?').bind(now(), storeId).run()
  return c.json({ ok: true, changed: r.meta.changes })
})

ingest.get('/taxonomy-map', async (c) => {
  const { results } = await c.env.DB.prepare('select level, ww_path, fs_path, ww_key, status, score, note, updated_at from taxonomy_map order by level, ww_path').all()
  return c.json(results)
})

// ── 派工單（後台插、Mac mini 領）──────────────────────────────────────────────
ingest.post('/admin-jobs/claim', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { kinds?: unknown; limit?: number }
  const kinds = Array.isArray(b.kinds) ? b.kinds.filter((k): k is string => typeof k === 'string').slice(0, 20) : []
  const limit = Math.max(1, Math.min(50, Number(b.limit ?? 10) || 10))
  const sql = kinds.length
    ? "update admin_jobs set status = 'running', started_at = ?1 where id in (select id from admin_jobs where status = 'pending' and kind in (select value from json_each(?2)) order by created_at limit ?3) returning id, kind, payload, created_at"
    : "update admin_jobs set status = 'running', started_at = ?1 where id in (select id from admin_jobs where status = 'pending' order by created_at limit ?3) returning id, kind, payload, created_at"
  const stmt = c.env.DB.prepare(sql)
  const { results } = await (kinds.length ? stmt.bind(now(), JSON.stringify(kinds), limit) : stmt.bind(now(), null, limit)).all<{ id: string; kind: string; payload: string | null; created_at: string }>()
  return c.json({ jobs: results.map((j) => ({ ...j, payload: parseJson<unknown>(j.payload, {}) })) })
})
ingest.post('/admin-jobs/:id/result', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { status?: string; log?: unknown }
  if (b.status !== 'done' && b.status !== 'failed') return c.json({ error: "status 要是 'done' 或 'failed'" }, 400)
  const r = await c.env.DB.prepare('update admin_jobs set status = ?, finished_at = ?, result = ? where id = ?').bind(b.status, now(), typeof b.log === 'string' ? b.log.slice(0, 2000) : sqlVal(b.log), c.req.param('id')).run()
  if (!r.meta.changes) return c.json({ error: 'job 不存在' }, 404)
  return c.json({ ok: true })
})

// ── Mac mini 健康（ops/health.sh 每 10 分鐘一列；留 7 天）──────────────────────
ingest.post('/health', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { at?: string; load?: unknown; top?: unknown; chrome?: unknown; orphan?: unknown; mem_free_mb?: unknown }
  const at = typeof b.at === 'string' && b.at ? b.at : now()
  await c.env.DB.batch([
    c.env.DB.prepare('insert into health (at, load, top, chrome, orphan, mem_free_mb) values (?, ?, ?, ?, ?, ?) on conflict (at) do update set load = excluded.load, top = excluded.top, chrome = excluded.chrome, orphan = excluded.orphan, mem_free_mb = excluded.mem_free_mb').bind(at, sqlVal(Number(b.load)), sqlVal(b.top), sqlVal(b.chrome), sqlVal(b.orphan), sqlVal(b.mem_free_mb)),
    c.env.DB.prepare('delete from health where at < ?').bind(new Date(Date.now() - 7 * 86400000).toISOString()),
  ])
  return c.json({ ok: true })
})

// ── 一次抓取：開始／每店／結束 ──────────────────────────────────────────────
ingest.post('/run/start', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { kind?: string; started_at?: string }
  const id = crypto.randomUUID()
  await c.env.DB.prepare('insert into crawl_runs (id, kind, started_at) values (?, ?, ?)').bind(id, b.kind ?? 'daily', b.started_at ?? now()).run()
  return c.json({ id })
})

interface StoreMeta { id: string; chain_id: string; name: string; region?: string | null; island?: string | null; lat?: number | null; lng?: number | null; online?: boolean }
interface StoreReport {
  store?: StoreMeta; store_id?: string; ok: boolean; rows?: number; requests?: number; seconds?: number
  added?: number; changed?: number; removed?: number; suspect?: boolean; error?: string | null
  slices?: unknown; badges?: unknown; tree?: unknown
}

ingest.post('/run/:id/store', async (c) => {
  const runId = c.req.param('id')
  const b = (await c.req.json().catch(() => null)) as StoreReport | null
  const storeId = b?.store?.id ?? b?.store_id
  if (!b || !storeId || !STORE_ID.test(storeId)) return c.json({ error: 'store.id 或 store_id 不對' }, 400)
  const stmts: D1PreparedStatement[] = []
  if (b.store) {
    const s = b.store
    stmts.push(c.env.DB.prepare(
      'insert into stores (id, chain_id, name, region, island, lat, lng, online) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do update set chain_id = excluded.chain_id, name = excluded.name, region = coalesce(excluded.region, stores.region), island = coalesce(excluded.island, stores.island), lat = coalesce(excluded.lat, stores.lat), lng = coalesce(excluded.lng, stores.lng), online = excluded.online',
    ).bind(s.id, s.chain_id, s.name, s.region ?? null, s.island ?? null, s.lat ?? null, s.lng ?? null, s.online === false ? 0 : 1))
  }
  if (b.ok) stmts.push(c.env.DB.prepare('update stores set last_fetched_at = ? where id = ?').bind(now(), storeId))
  stmts.push(c.env.DB.prepare(
    'insert into crawl_stores (run_id, store_id, ok, rows, requests, seconds, added, changed, removed, suspect, error, slices, badges, tree) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (run_id, store_id) do update set ok = excluded.ok, rows = excluded.rows, requests = excluded.requests, seconds = excluded.seconds, added = excluded.added, changed = excluded.changed, removed = excluded.removed, suspect = excluded.suspect, error = excluded.error, slices = excluded.slices, badges = excluded.badges, tree = excluded.tree',
  ).bind(runId, storeId, b.ok ? 1 : 0, sqlVal(b.rows), sqlVal(b.requests), sqlVal(b.seconds), sqlVal(b.added), sqlVal(b.changed), sqlVal(b.removed), b.suspect ? 1 : 0, sqlVal(b.error), sqlVal(b.slices), sqlVal(b.badges), sqlVal(b.tree)))
  await c.env.DB.batch(stmts)
  return c.json({ ok: true })
})

ingest.post('/run/:id/finish', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { finished_at?: string; stores_total?: number; stores_ok?: number; stores_failed?: number; rows?: number; requests?: number; report?: unknown }
  const r = await c.env.DB.prepare('update crawl_runs set finished_at = ?, stores_total = ?, stores_ok = ?, stores_failed = ?, rows = ?, requests = ?, report = ? where id = ?')
    .bind(b.finished_at ?? now(), sqlVal(b.stores_total), sqlVal(b.stores_ok), sqlVal(b.stores_failed), sqlVal(b.rows), sqlVal(b.requests), sqlVal(b.report), c.req.param('id')).run()
  if (!r.meta.changes) return c.json({ error: 'run 不存在' }, 404)
  return c.json({ ok: true })
})

// ── 變動記錄（階段 6 第 1 塊）────────────────────────────────────────────────
const CHANGE_COLS = ['at', 'store_id', 'chain', 'product_id', 'product_key', 'name', 'kind', 'old_price', 'new_price', 'old_text', 'new_text', 'old_promo', 'new_promo']
ingest.post('/price-changes', async (c) => {
  const rows = await readRows(c)
  if (typeof rows === 'string') return c.json({ error: rows }, 400)
  const bad = rows.findIndex((r) => !r.at || !r.store_id || !r.product_id || !['added', 'changed', 'removed'].includes(String(r.kind)))
  if (bad >= 0) return c.json({ error: `第 ${bad} 列缺 at / store_id / product_id 或 kind 不對` }, 400)
  const stmt = c.env.DB.prepare(`insert into price_changes (${CHANGE_COLS.join(', ')}) values (${CHANGE_COLS.map(() => '?').join(', ')})`)
  for (let i = 0; i < rows.length; i += BATCH) await c.env.DB.batch(rows.slice(i, i + BATCH).map((r) => stmt.bind(...CHANGE_COLS.map((k) => sqlVal(k === 'chain' ? r.chain ?? String(r.store_id).split(':')[0] : r[k])))))
  return c.json({ inserted: rows.length })
})

// ── R2 快照 ──────────────────────────────────────────────────────────────────
ingest.post('/snapshot/:store/:week', async (c) => {
  const storeId = c.req.param('store'), week = c.req.param('week')
  if (!STORE_ID.test(storeId) || !WEEK.test(week)) return c.json({ error: 'store 或 week 格式不對' }, 400)
  const r = await writeSnapshot(c.env, storeId, week)
  if (!r) return c.json({ error: '這家店這週沒有 store_specials' }, 404)
  return c.json(r)
})

// ── 刪舊週 ───────────────────────────────────────────────────────────────────
ingest.post('/prune', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { keep_weeks?: number; snapshot_weeks?: number }
  const keep = Math.max(1, Math.min(52, Number(b.keep_weeks ?? 8)))
  const snapKeep = Math.max(1, Math.min(52, Number(b.snapshot_weeks ?? 2)))
  const cutoff = (weeks: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 7 * weeks); return d.toISOString().slice(0, 10) }
  const dbCut = cutoff(keep), r2Cut = cutoff(snapKeep)
  const res = await c.env.DB.batch([
    c.env.DB.prepare('delete from chain_prices where week_start < ?').bind(dbCut),
    c.env.DB.prepare('delete from store_prices where week_start < ?').bind(dbCut),
    c.env.DB.prepare('delete from store_specials where week_start < ?').bind(dbCut),
    c.env.DB.prepare('delete from price_changes where at < ?').bind(new Date(Date.now() - 30 * 86400000).toISOString()),   // 階段 6：變動記錄留 30 天
    c.env.DB.prepare('delete from ai_usage where day < ?').bind(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),   // AI 食譜次數只留 30 天（以前 weekly 對 Supabase 做的）
  ])
  let r2Deleted = 0
  let cursor: string | undefined
  do {
    const page = await c.env.DATA.list({ prefix: 'specials/', cursor })
    const old = page.objects.filter((o) => (o.key.match(/\/(\d{4}-\d\d-\d\d)\.json$/)?.[1] ?? '9999') < r2Cut).map((o) => o.key)
    if (old.length) { await c.env.DATA.delete(old); r2Deleted += old.length }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return c.json({ db_cutoff: dbCut, deleted: { chain_prices: res[0].meta.changes, store_prices: res[1].meta.changes, store_specials: res[2].meta.changes }, r2_cutoff: r2Cut, r2_deleted: r2Deleted })
})

// ═══ 階段 4（docs/stage4-contract.md §5 Mac mini 端）：即時查價領單／回填、心跳、開關、推播資料、週一批次目標 ═══
//
//   POST /ingest/price-requests/claim          {chain, limit?} → {requests:[{id, store_id, product_ids, product_keys, queries, created_at}]}（原子地 pending → running）
//   POST /ingest/price-requests/result         {ids, status, error?, live_prices?, search_results?, name_matches?, chain_items?} → 各表 upsert、單標 done/failed
//   POST /ingest/price-requests/reset-running  啟動時：running → pending → {reset}
//   GET  /ingest/price-requests/pending-count  {pending}
//   POST /ingest/heartbeat                     {name, info} → heartbeats upsert
//   GET  /ingest/settings                      {key: value}
//   GET  /ingest/push/digests?week=            一人一筆推播資料
//   POST /ingest/push/sent | /push/remove      記錄已推／刪失效訂閱
//   GET  /ingest/push/subscriptions            全部訂閱（測試推播）
//   GET  /ingest/price-targets                 週一批次要查的 [{store_id, product_ids, product_keys}]
//   POST /ingest/prune-requests                刪一天前 done／failed 的單（search_results 跟著 cascade）；claim 超過 10 分鐘還 running 的退回 pending
//
// price_requests.items 存 JSON {product_ids, product_keys}；D1 沒有 error 欄，失敗原因存 result（JSON {error}）。

const CHAINS = ['newworld', 'paknsave', 'woolworths']
const CHAIN_NAME: Record<string, string> = { newworld: 'New World', woolworths: 'Woolworths', paknsave: "PAK'nSAVE" }
const STAGE4_SPECS: Record<string, Spec> = {
  live_prices: { table: 'live_prices', cols: ['store_id', 'product_id', 'product_key', 'available', 'price', 'price_unit', 'was_price', 'is_special', 'club_only', 'multi_buy', 'unit_price', 'unit_price_unit', 'name', 'fetched_at', 'source'], pk: ['store_id', 'product_id'] },
  search_results: { table: 'search_results', cols: ['request_id', 'store_id', 'term', 'candidates', 'created_at'], pk: ['request_id', 'term'] },
  name_matches: { table: 'name_matches', cols: ['chain_id', 'product_key', 'status', 'candidate_product_id', 'score', 'candidates', 'searched_at'], pk: ['chain_id', 'product_key'] },
}
const parseJson = <T>(s: string | null | undefined, fallback: T): T => { if (s == null) return fallback; try { return JSON.parse(s) as T } catch { return fallback } }
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const chainOf = (storeId: string) => storeId.slice(0, storeId.indexOf(':'))

interface ReqRow { id: string; store_id: string; items: string; queries: string | null; created_at: string }
const flatten = (r: ReqRow) => {
  const it = parseJson<{ product_ids?: string[]; product_keys?: string[] }>(r.items, {})
  return { id: r.id, store_id: r.store_id, product_ids: strList(it.product_ids), product_keys: strList(it.product_keys), queries: strList(parseJson(r.queries, [])), created_at: r.created_at }
}

ingest.post('/price-requests/claim', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { chain?: string; limit?: number }
  if (!b.chain || !CHAINS.includes(b.chain)) return c.json({ error: 'chain 要是 newworld / paknsave / woolworths' }, 400)
  const limit = Math.max(1, Math.min(100, Number(b.limit ?? 100) || 100))
  const { results } = await c.env.DB.prepare(
    "update price_requests set status = 'running', claimed_at = ?1 where id in (select id from price_requests where status = 'pending' and store_id like ?2 order by created_at limit ?3) returning id, store_id, items, queries, created_at",
  ).bind(now(), `${b.chain}:%`, limit).all<ReqRow>()
  return c.json({ requests: results.map(flatten) })
})

interface ResultBody {
  ids?: unknown; status?: string; error?: string
  live_prices?: Row[]; search_results?: Row[]; name_matches?: Row[]; chain_items?: Row[]
}
ingest.post('/price-requests/result', async (c) => {
  const b = (await c.req.json().catch(() => null)) as ResultBody | null
  if (!b || (b.status !== 'done' && b.status !== 'failed')) return c.json({ error: "status 要是 'done' 或 'failed'" }, 400)
  const ids = strList(b.ids)
  const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r)).slice(0, MAX_ROWS) : [])
  const t = now()
  const live = rowsOf(b.live_prices).map((r): Row => ({ ...r, available: r.available ?? true, fetched_at: r.fetched_at ?? t, source: r.source ?? 'live' }))
  const search = rowsOf(b.search_results).map((r): Row => ({ ...r, candidates: r.candidates ?? [], created_at: r.created_at ?? t }))
  const names = rowsOf(b.name_matches)
  const items = rowsOf(b.chain_items).filter((r) => r.chain_id && r.product_id && r.product_key)
  const upserted = {
    live_prices: await upsertRows(c.env, STAGE4_SPECS.live_prices, live.filter((r) => r.store_id && r.product_id)),
    search_results: await upsertRows(c.env, STAGE4_SPECS.search_results, search.filter((r) => r.request_id && r.store_id && r.term)),
    name_matches: await upsertRows(c.env, STAGE4_SPECS.name_matches, names.filter((r) => r.chain_id && r.product_key && r.status)),
    chain_items: 0,
  }
  if (items.length) {   // 已有不動（不讓編號改指到別的 key）
    const stmt = c.env.DB.prepare('insert into chain_items (chain_id, product_id, product_key, seen_at) values (?, ?, ?, ?) on conflict (chain_id, product_id) do nothing')
    for (let i = 0; i < items.length; i += BATCH) await c.env.DB.batch(items.slice(i, i + BATCH).map((r) => stmt.bind(r.chain_id, r.product_id, r.product_key, t)))
    upserted.chain_items = items.length
  }
  let changed = 0
  if (ids.length) {
    const result = b.status === 'failed' ? JSON.stringify({ error: String(b.error ?? '').slice(0, 500) }) : null
    const r = await c.env.DB.prepare('update price_requests set status = ?, done_at = ?, result = ? where id in (select value from json_each(?))').bind(b.status, t, result, JSON.stringify(ids)).run()
    changed = r.meta.changes
  }
  return c.json({ ok: true, requests: changed, upserted })
})

ingest.post('/price-requests/reset-running', async (c) => {
  const r = await c.env.DB.prepare("update price_requests set status = 'pending', claimed_at = null where status = 'running'").run()
  return c.json({ reset: r.meta.changes })
})

ingest.get('/price-requests/pending-count', async (c) => {
  const row = await c.env.DB.prepare("select count(*) as n from price_requests where status = 'pending'").first<{ n: number }>()
  return c.json({ pending: row?.n ?? 0 })
})

// heartbeats 不在 0001 / 0002（契約列了但 migration 沒建）：第一次寫的時候建，之後的 migration 用 create table if not exists 也不會撞
ingest.post('/heartbeat', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { name?: string; info?: unknown }
  if (!b.name || typeof b.name !== 'string' || b.name.length > 60) return c.json({ error: 'name 不對' }, 400)
  await c.env.DB.prepare('create table if not exists heartbeats (name text primary key, at text not null, info text)').run()
  await c.env.DB.prepare('insert into heartbeats (name, at, info) values (?, ?, ?) on conflict (name) do update set at = excluded.at, info = excluded.info').bind(b.name, now(), sqlVal(b.info)).run()
  return c.json({ ok: true })
})

ingest.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare('select key, value from settings').all<{ key: string; value: string | null }>()
  return c.json(Object.fromEntries(results.map((r) => [r.key, r.value])))
})

// ── 推播 ─────────────────────────────────────────────────────────────────────
ingest.get('/push/digests', async (c) => {
  const week = c.req.query('week') ?? ''
  if (!WEEK.test(week)) return c.json({ error: 'week 要是 YYYY-MM-DD' }, 400)
  const { results: users } = await c.env.DB.prepare(`
    select u.id, u.lang from users u
    where exists (select 1 from push_subscriptions p where p.user_id = u.id)
      and not exists (select 1 from notifications n where n.user_id = u.id and n.week_start = ?1 and n.kind = 'weekly_digest')`).bind(week).all<{ id: string; lang: string | null }>()
  if (!users.length) return c.json([])
  const uids = JSON.stringify(users.map((u) => u.id))
  const [subs, stores, totals, hits] = await c.env.DB.batch([
    c.env.DB.prepare('select user_id, endpoint, keys from push_subscriptions where user_id in (select value from json_each(?1))').bind(uids),
    c.env.DB.prepare('select user_id, store_id from user_stores where user_id in (select value from json_each(?1)) order by position').bind(uids),
    c.env.DB.prepare(`
      select us.user_id, sum(json_array_length(ss.product_keys)) as total from user_stores us
      join store_specials ss on ss.store_id = us.store_id and ss.week_start = ?2
      where us.user_id in (select value from json_each(?1)) group by us.user_id`).bind(uids, week),
    // 關注的 key 在他的店這週有特價：店價優先、沒有就連鎖價
    c.env.DB.prepare(`
      select w.user_id, w.product_key, us.store_id, p.display_name as name, coalesce(sp.price, cp.price) as price, coalesce(sp.multi_buy, cp.multi_buy) as multi_buy
      from watches w
      join user_stores us on us.user_id = w.user_id
      join store_specials ss on ss.store_id = us.store_id and ss.week_start = ?2
      left join products p on p.key = w.product_key
      left join store_prices sp on sp.store_id = us.store_id and sp.week_start = ?2 and sp.product_key = w.product_key
      left join chain_prices cp on cp.chain_id = substr(us.store_id, 1, instr(us.store_id, ':') - 1) and cp.week_start = ?2 and cp.product_key = w.product_key
      where w.user_id in (select value from json_each(?1))
        and exists (select 1 from json_each(ss.product_keys) k where k.value = w.product_key)
        and coalesce(sp.price, cp.price) is not null`).bind(uids, week),
  ])
  type SubR = { user_id: string; endpoint: string; keys: string }
  type HitR = { user_id: string; product_key: string; store_id: string; name: string | null; price: number; multi_buy: string | null }
  const byUser = <T extends { user_id: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) (m.get(r.user_id) ?? m.set(r.user_id, []).get(r.user_id)!).push(r); return m }
  const subsBy = byUser(subs.results as SubR[])
  const storesBy = byUser(stores.results as { user_id: string; store_id: string }[])
  const totalBy = new Map((totals.results as { user_id: string; total: number | null }[]).map((r) => [r.user_id, Number(r.total ?? 0)]))
  const hitsBy = byUser(hits.results as HitR[])
  return c.json(users.map((u) => {
    const best = new Map<string, { name: string; price: number; store: string }>()
    for (const h of hitsBy.get(u.id) ?? []) {   // 每樣取最便宜的店；多件優惠算湊滿的平均價（同 notify.ts）
      const mb = parseJson<{ qty?: number; total?: number } | null>(h.multi_buy, null)
      const p = mb?.qty && mb.total ? mb.total / mb.qty : Number(h.price)
      const cur = best.get(h.product_key)
      if (!cur || p < cur.price) best.set(h.product_key, { name: h.name ?? h.product_key, price: p, store: CHAIN_NAME[chainOf(h.store_id)] ?? h.store_id })
    }
    return {
      user_id: u.id, lang: u.lang ?? 'zh',
      subs: (subsBy.get(u.id) ?? []).map((s) => ({ endpoint: s.endpoint, keys: parseJson<unknown>(s.keys, {}) })),
      stores: (storesBy.get(u.id) ?? []).map((s) => s.store_id),
      total: totalBy.get(u.id) ?? 0,
      hits: [...best.values()],
    }
  }))
})

ingest.post('/push/sent', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { user_id?: string; week_start?: string; kind?: string; payload?: unknown }
  if (!b.user_id || !b.week_start || !WEEK.test(b.week_start) || !b.kind) return c.json({ error: 'user_id / week_start / kind 不對' }, 400)
  await c.env.DB.prepare('insert into notifications (id, user_id, week_start, kind, payload, sent_at) values (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), b.user_id, b.week_start, b.kind, sqlVal(b.payload), now()).run()
  return c.json({ ok: true })
})

ingest.post('/push/remove', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { endpoint?: string }
  if (!b.endpoint || typeof b.endpoint !== 'string') return c.json({ error: 'endpoint 不對' }, 400)
  const r = await c.env.DB.prepare('delete from push_subscriptions where endpoint = ?').bind(b.endpoint).run()
  return c.json({ removed: r.meta.changes })
})

ingest.get('/push/subscriptions', async (c) => {
  const { results } = await c.env.DB.prepare('select p.user_id, p.endpoint, p.keys, u.lang from push_subscriptions p join users u on u.id = p.user_id').all<{ user_id: string; endpoint: string; keys: string; lang: string | null }>()
  return c.json(results.map((r) => ({ user_id: r.user_id, endpoint: r.endpoint, keys: parseJson<unknown>(r.keys, {}), lang: r.lang ?? 'zh' })))
})

// ── 週一批次查價的目標：每個人的清單 ∪ 關注 × 他的店；有編號的給 product_ids，沒編號的給 product_keys 讓 worker 用名字配 ──
ingest.get('/price-targets', async (c) => {
  const { results } = await c.env.DB.prepare(`
    with ks as (
      select l.user_id, li.product_key as key from list_items li join lists l on l.id = li.list_id where li.product_key is not null
      union
      select user_id, product_key from watches
    )
    select distinct us.store_id, ks.key from ks join user_stores us on us.user_id = ks.user_id`).all<{ store_id: string; key: string }>()
  if (!results.length) return c.json([])
  const keys = [...new Set(results.map((r) => r.key))]
  const idsBy = new Map<string, string[]>()   // `${chain}|${key}` → product_ids
  for (let i = 0; i < keys.length; i += 500) {
    const { results: rows } = await c.env.DB.prepare('select chain_id, product_id, product_key from chain_items where product_key in (select value from json_each(?))').bind(JSON.stringify(keys.slice(i, i + 500))).all<{ chain_id: string; product_id: string; product_key: string }>()
    for (const r of rows) { const k = `${r.chain_id}|${r.product_key}`; (idsBy.get(k) ?? idsBy.set(k, []).get(k)!).push(r.product_id) }
  }
  const group = (chain: string) => (chain === 'woolworths' ? ['woolworths'] : ['newworld', 'paknsave'])
  const byStore = new Map<string, { ids: Set<string>; keys: Set<string> }>()
  for (const r of results) {
    const s = byStore.get(r.store_id) ?? byStore.set(r.store_id, { ids: new Set(), keys: new Set() }).get(r.store_id)!
    const ids = group(chainOf(r.store_id)).flatMap((ch) => idsBy.get(`${ch}|${r.key}`) ?? [])
    if (ids.length) for (const id of ids) s.ids.add(id)
    else s.keys.add(r.key)
  }
  return c.json([...byStore.entries()].map(([store_id, s]) => ({ store_id, product_ids: [...s.ids], product_keys: [...s.keys] })))
})

ingest.post('/prune-requests', async (c) => {
  const cutoff = new Date(Date.now() - 86400000).toISOString()
  const stuck = new Date(Date.now() - 10 * 60000).toISOString()   // 領走後 result 沒送回來（worker 中途掛了）：退回 pending 讓下一輪重做
  const [del, reset] = await c.env.DB.batch([
    c.env.DB.prepare("delete from price_requests where status in ('done', 'failed') and created_at < ?").bind(cutoff),
    c.env.DB.prepare("update price_requests set status = 'pending', claimed_at = null where status = 'running' and claimed_at < ?").bind(stuck),
  ])
  return c.json({ cutoff, deleted: del.meta.changes, reset_stuck: reset.meta.changes })
})

export default ingest
