// 特價資料的快取代理（2026-10-25）。
// 為什麼：App 每個使用者都直接向 Supabase 整包下載三家店的特價（一家店兩三千筆），爬蟲一跑完又重抓，
// Supabase 免費方案一個月 5 GB 的傳出流量（Egress）被吃光。改成 App 向這裡要，這裡每個版本只跟 Supabase 拿一次，
// 之後都從 Cloudflare 邊緣快取送出（靜態流量不計費）。
//
// 路徑：GET /api/specials/<store_id>?v=<stores.last_fetched_at>&select=<PostgREST select>
//   - v 是爬蟲最後抓取時間：爬蟲一跑完 App 帶的 v 就變，等於自動換新；同一個 v 在同一個節點只會打 Supabase 一次。
//   - select 由 App 決定（跟它直接打 Supabase 時一樣），這裡只轉送，不解讀。
//   回應：{ week: "YYYY-MM-DD" | null, rows: [...] }，rows 是 PostgREST 原樣的列。
// 其他路徑由 wrangler.jsonc 的 assets 直接出靜態檔，不會進到這支程式（run_worker_first 只有 /api/*）。

const PAGE = 1000
/** 快取多久：key 帶 v，版本變就自動換，所以可以放很久；設 7 天是怕有人帶舊 v 一直打。 */
const CACHE_SECONDS = 7 * 24 * 3600
const STORE_ID = /^[a-z]+:[A-Za-z0-9-]{1,64}$/
const SELECT_OK = /^[A-Za-z0-9_,()*.]{1,600}$/

export default {
  /** @param {Request} request @param {{ SUPABASE_URL: string, SUPABASE_ANON_KEY: string }} env @param {ExecutionContext} ctx */
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const m = url.pathname.match(/^\/api\/specials\/([^/]+)$/)
    if (!m || request.method !== 'GET') return json({ error: 'not found' }, 404)
    const storeId = decodeURIComponent(m[1])
    const select = url.searchParams.get('select') ?? '*'
    if (!STORE_ID.test(storeId) || !SELECT_OK.test(select)) return json({ error: 'bad request' }, 400)

    // 邊緣快取：鑰匙就是完整網址（含 store、v、select）
    const cache = caches.default
    const cacheKey = new Request(url.toString(), { method: 'GET' })
    const hit = await cache.match(cacheKey)
    if (hit) {
      const res = new Response(hit.body, hit)
      res.headers.set('x-kw-cache', 'hit')
      return res
    }

    const data = await fromSupabase(env, storeId, select)
    if (!data.ok) return json({ error: data.error }, 502)   // 不快取錯誤，App 會退回直接打 Supabase

    const res = json(data.body, 200, {
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      'x-kw-cache': 'miss',
    })
    ctx.waitUntil(cache.put(cacheKey, res.clone()))
    return res
  },
}

/** 跟 App 原本 fetchStore 一樣的兩步：先問這家店最近一週是哪週，再把那週整包分頁拿完。 */
async function fromSupabase(env, storeId, select) {
  const base = `${env.SUPABASE_URL}/rest/v1/specials`
  const headers = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const d = new Date(today + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  const monday = d.toISOString().slice(0, 10)

  const headQ = new URLSearchParams({ select: 'week_start', store_id: `eq.${storeId}`, week_start: `lte.${monday}`, order: 'week_start.desc', limit: '1' })
  const head = await fetch(`${base}?${headQ}`, { headers })
  if (!head.ok) return { ok: false, error: `head ${head.status}` }
  const headRows = await head.json()
  const week = headRows[0]?.week_start ?? null
  if (!week) return { ok: true, body: { week: null, rows: [] } }

  const rows = []
  for (let off = 0; ; off += PAGE) {
    const q = new URLSearchParams({ select, store_id: `eq.${storeId}`, week_start: `eq.${week}`, offset: String(off), limit: String(PAGE) })
    const page = await fetch(`${base}?${q}`, { headers })
    if (!page.ok) return { ok: false, error: `page ${page.status}` }
    const got = await page.json()
    rows.push(...got)
    if (got.length < PAGE) break
  }
  return { ok: true, body: { week, rows } }
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } })
}
