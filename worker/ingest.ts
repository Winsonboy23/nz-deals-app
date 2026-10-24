// /ingest/*：Mac mini 的爬蟲把抓到的東西送進 D1（docs/national-plan.md §3「爬蟲與 price-worker」、§6 階段 2，2026-10-25）。
// Bearer token 在 index.ts 的中介層驗過才進得來。每批最多 1,000 列、全部 upsert、重送同一批結果一樣。
//
//   POST /ingest/run/start                 {kind, started_at} → {id}
//   POST /ingest/run/:id/store             {store?, ok, rows, requests, seconds, added, changed, removed, suspect, error, slices, badges, tree}
//   POST /ingest/run/:id/finish            {finished_at, stores_total, stores_ok, stores_failed, rows, requests, report}
//   POST /ingest/products | chain-items | chain-prices | store-prices | store-specials | store-items   {rows:[…]} → {upserted}
//   POST /ingest/snapshot/:store/:week     重建 R2 快照 → {rows, bytes}
//   POST /ingest/prune                     {keep_weeks} 刪舊週（D1 三張價格表 + R2 快照留 2 週）
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
  'products': { table: 'products', cols: ['key', 'display_name', 'brand', 'size', 'category_id', 'family_key', 'is_food', 'image_url'], pk: ['key'], keep: ['brand', 'size', 'category_id', 'family_key', 'image_url'] },
  'chain-items': { table: 'chain_items', cols: ['chain_id', 'product_id', 'product_key', 'name_listed', 'url', 'seen_at'], pk: ['chain_id', 'product_id'], keep: ['name_listed', 'url'] },
  'chain-prices': { table: 'chain_prices', cols: ['chain_id', ...PRICE_COLS], pk: ['chain_id', 'product_key', 'week_start'] },
  'store-prices': { table: 'store_prices', cols: ['store_id', ...PRICE_COLS], pk: ['store_id', 'product_key', 'week_start'] },
  'store-specials': { table: 'store_specials', cols: ['store_id', 'week_start', 'product_keys'], pk: ['store_id', 'week_start'] },
  'store-items': { table: 'store_items', cols: ['store_id', 'product_key', 'seen_at'], pk: ['store_id', 'product_key'] },
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
    await env.DB.batch(rows.slice(i, i + BATCH).map((r) => stmt.bind(...s.cols.map((c) => sqlVal(r[c])))))
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
ingest.post('/:kind{products|chain-items|chain-prices|store-prices|store-specials|store-items}', async (c) => {
  const spec = SPECS[c.req.param('kind')]
  const rows = await readRows(c)
  if (typeof rows === 'string') return c.json({ error: rows }, 400)
  const bad = rows.findIndex((r) => spec.pk.some((k) => r[k] === undefined || r[k] === null || r[k] === ''))
  if (bad >= 0) return c.json({ error: `第 ${bad} 列缺主鍵 ${spec.pk.join('+')}` }, 400)
  const upserted = await upsertRows(c.env, spec, rows)
  return c.json({ upserted })
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

export default ingest
