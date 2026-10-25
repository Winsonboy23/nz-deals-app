// KiteWise Worker API（Hono）。全國版階段 0 骨架（docs/national-plan.md §1、§3，2026-10-25）。
//
// 只有 wrangler.jsonc 的 run_worker_first 列的四組路徑會進來：/api/*、/auth/*、/ingest/*、/admin/*。
// 其他路徑由 static assets 直接出檔，不經過這裡。
//
// 現在真的有功能的：GET /api/specials/:store（Supabase 快取代理，10-25 以前就有，原樣搬進來）、GET /api/health、
// /ingest/*（階段 2，worker/ingest.ts：爬蟲寫 D1 + 重建 R2 快照，Bearer token 沒帶就 401）。/auth、/admin 先回 501，之後的階段再填。
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'
import ingest from './ingest'
import api from './api'
import auth from './auth'
import me, { publicLists } from './me'
import { HTTPException } from 'hono/http-exception'
import ai from './ai'
import live from './live'
import { snapshotKey } from './snapshot'
import { nzMonday } from './week'

export type { Env }

const app = new Hono<{ Bindings: Env }>()

// 本機開發 vite 在 5173、Worker 在 8787，跨來源要 CORS；正式站同網域用不到。舊網址（Zeabur／co.nz）之後導過來也先放行。
const ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://kitewise.nz', 'https://www.kitewise.nz', 'https://kitewise.co.nz', 'https://www.kitewise.co.nz', 'https://nz-deals.zeabur.app']
// credentials: true → 階段 4 的 cookie 登入要讓本機 vite（5173）帶 cookie 打 8787
app.use('/api/*', cors({ origin: ORIGINS, credentials: true }))
app.use('/auth/*', cors({ origin: ORIGINS, credentials: true }))

// ── /api 公開 ────────────────────────────────────────────────────────────────

/** 健康檢查：D1 和 R2 綁定有沒有通。不快取。 */
app.get('/api/health', async (c) => {
  const out: Record<string, unknown> = { ok: true, now: new Date().toISOString() }
  try {
    const row = await c.env.DB.prepare('select count(*) as n from sqlite_master where type = ?').bind('table').first<{ n: number }>()
    out.d1_tables = row?.n ?? 0
  } catch (e) {
    out.ok = false
    out.d1_error = String(e)
  }
  try {
    const list = await c.env.DATA.list({ limit: 1 })
    out.r2 = list.truncated ? 'many' : list.objects.length
  } catch (e) {
    out.ok = false
    out.r2_error = String(e)
  }
  return c.json(out, out.ok ? 200 : 500, { 'cache-control': 'no-store' })
})

/**
 * 特價資料的快取代理（2026-10-25）。
 * 為什麼：App 每個使用者都直接向 Supabase 整包下載三家店的特價（一家店兩三千筆），爬蟲一跑完又重抓，
 * Supabase 免費方案一個月 5 GB 的傳出流量（Egress）被吃光。改成 App 向這裡要，這裡每個版本只跟 Supabase 拿一次，
 * 之後都從 Cloudflare 邊緣快取送出（靜態流量不計費）。
 *
 * GET /api/specials/<store_id>?v=<stores.last_fetched_at>&select=<PostgREST select>
 *   - v 是爬蟲最後抓取時間：爬蟲一跑完 App 帶的 v 就變，等於自動換新；同一個 v 在同一個節點只會打 Supabase 一次。
 *   - select 由 App 決定（跟它直接打 Supabase 時一樣），這裡只轉送，不解讀。
 *   回應：{ week: "YYYY-MM-DD" | null, rows: [...] }，rows 是 PostgREST 原樣的列。
 * 階段 3 會改成讀 R2 快照 specials/<store>/<week>.json。
 */
const PAGE = 1000
/** 快取多久：key 帶 v，版本變就自動換，所以可以放很久；設 7 天是怕有人帶舊 v 一直打。 */
const CACHE_SECONDS = 7 * 24 * 3600
const STORE_ID = /^[a-z]+:[A-Za-z0-9-]{1,64}$/
const SELECT_OK = /^[A-Za-z0-9_,()*.]{1,600}$/

app.get('/api/specials/:store', async (c) => {
  const storeId = c.req.param('store')
  const select = c.req.query('select') ?? '*'
  if (!STORE_ID.test(storeId) || !SELECT_OK.test(select)) return c.json({ error: 'bad request' }, 400)

  // 階段 3（2026-10-25）：App 帶 src=d1 就讀 R2 快照（爬蟲雙寫時重建，worker/snapshot.ts），不碰 Supabase。
  // 哪一週：這家店 store_specials 裡 ≤ 這週一的最新一週。沒有就回空（這家店還沒進 D1）。快取 1 小時：快照跟 stores.last_fetched_at（App 帶的 v）同一次更新，但有幾秒的先後。
  if (c.req.query('src') === 'd1') {
    const wk = await c.env.DB.prepare('select max(week_start) as w from store_specials where store_id = ? and week_start <= ?').bind(storeId, nzMonday()).first<{ w: string | null }>()
    if (!wk?.w) return c.json({ week: null, rows: [] }, 200, { 'cache-control': 'public, max-age=300' })
    const obj = await c.env.DATA.get(snapshotKey(storeId, wk.w))
    if (!obj) return c.json({ week: wk.w, rows: [], error: 'snapshot missing' }, 200, { 'cache-control': 'no-store' })
    return new Response(obj.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-kw-source': 'r2' } })
  }

  // 邊緣快取：鑰匙就是完整網址（含 store、v、select）
  const cache = caches.default
  const cacheKey = new Request(c.req.url, { method: 'GET' })
  const hit = await cache.match(cacheKey)
  if (hit) {
    const res = new Response(hit.body, hit)
    res.headers.set('x-kw-cache', 'hit')
    return res
  }

  const data = await fromSupabase(c.env, storeId, select)
  if (!data.ok) return c.json({ error: data.error }, 502)   // 不快取錯誤，App 會退回直接打 Supabase

  const res = new Response(JSON.stringify(data.body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      'x-kw-cache': 'miss',
    },
  })
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
})

/** 跟 App 原本 fetchStore 一樣的兩步：先問這家店最近一週是哪週，再把那週整包分頁拿完。 */
async function fromSupabase(env: Env, storeId: string, select: string):
  Promise<{ ok: true; body: { week: string | null; rows: unknown[] } } | { ok: false; error: string }> {
  const base = `${env.SUPABASE_URL}/rest/v1/specials`
  const headers = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` }
  const monday = nzMonday()

  const headQ = new URLSearchParams({ select: 'week_start', store_id: `eq.${storeId}`, week_start: `lte.${monday}`, order: 'week_start.desc', limit: '1' })
  const head = await fetch(`${base}?${headQ}`, { headers })
  if (!head.ok) return { ok: false, error: `head ${head.status}` }
  const headRows = (await head.json()) as { week_start: string }[]
  const week = headRows[0]?.week_start ?? null
  if (!week) return { ok: true, body: { week: null, rows: [] } }

  const rows: unknown[] = []
  for (let off = 0; ; off += PAGE) {
    const q = new URLSearchParams({ select, store_id: `eq.${storeId}`, week_start: `eq.${week}`, offset: String(off), limit: String(PAGE) })
    const page = await fetch(`${base}?${q}`, { headers })
    if (!page.ok) return { ok: false, error: `page ${page.status}` }
    const got = (await page.json()) as unknown[]
    rows.push(...got)
    if (got.length < PAGE) break
  }
  return { ok: true, body: { week, rows } }
}

// ── /ingest 爬蟲與 price-worker（Bearer token）────────────────────────────────

app.use('/ingest/*', async (c, next) => {
  const token = c.env.INGEST_TOKEN
  const got = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!token || !got || !timingSafeEqual(got, token)) return c.json({ error: 'unauthorized' }, 401)
  await next()
})
app.route('/ingest', ingest)

/** 長度相同時逐字比，避免用 === 比 token 洩漏長度與前綴（常數時間）。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── 階段 4（docs/stage4-contract.md）：登入、使用者資料、AI 食譜、即時查價 ─────
// 掛載順序：/api/me 和 live／ai 的具體路徑先，/api 的公開讀取（api.ts）後；/admin 是階段 5
app.route('/auth', auth)
app.route('/api/me', me)
app.route('/api', publicLists)   // GET /api/lists/:token（分享清單，公開）
app.route('/api', ai)
app.route('/api', live)
app.all('/admin/*', (c) => c.json({ error: 'not implemented', stage: 5 }, 501))
app.route('/api', api)

app.notFound((c) => c.json({ error: 'not found' }, 404))
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()   // requireUser 丟的 401 {"error":"sign_in_required"} 等
  console.error(err)
  return c.json({ error: 'internal' }, 500)
})

export default app
