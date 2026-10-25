// /admin/*：後台（全國版階段 5，docs/stage5-contract.md，2026-10-26）。
//
// 兩道門：Cloudflare Access 在邊緣擋（沒通過連 HTML 都拿不到）→ 這裡再驗 Access 的 JWT（Cf-Access-Jwt-Assertion）、
// email 要在 admins 表。wrangler.jsonc 沒設 ACCESS_TEAM_DOMAIN / ACCESS_AUD（本機 wrangler dev）就退回 kw_session + admins。
//
//   GET  /admin, /admin/                 App 的 index.html（App 一開就跳 #/admin）
//   GET  /admin/api/me                   {admin, email, via}
//   /admin/api/review/*  /family/*  /runs  /jobs  /live  /taxonomy/*  /recipes  /users  /settings   見契約 §2
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env } from './env'
import { getUser } from './session'
import { nzMonday } from './week'

type Vars = { adminEmail: string; adminVia: 'access' | 'session' }
const admin = new Hono<{ Bindings: Env; Variables: Vars }>()

const now = () => new Date().toISOString()
const KEY = /^[a-z0-9_.-]{1,160}$/i
const parseJson = <T>(s: unknown, fallback: T): T => { if (typeof s !== 'string') return (s as T) ?? fallback; try { return JSON.parse(s) as T } catch { return fallback } }
const sqlVal = (v: unknown): string | number | null => {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}
const str = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.length <= max ? v : null)

// ── Access JWT ───────────────────────────────────────────────────────────────
// jose 的 JWKS 物件自己會快取公鑰；按 team domain 各留一份（模組層級，同一個 isolate 共用）
const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
async function accessEmail(env: Env, token: string | undefined): Promise<string | null> {
  const team = env.ACCESS_TEAM_DOMAIN, aud = env.ACCESS_AUD
  if (!team || !aud || !token) return null
  let jwks = jwksByTeam.get(team)
  if (!jwks) { jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)); jwksByTeam.set(team, jwks) }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: aud })
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : null
  } catch {
    return null
  }
}

/** 後台 index.html：給 Access 通過的人。no-store，App 的 JS 自己有 hash 檔名。 */
admin.get('/', async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString(), { headers: { accept: 'text/html' } }))
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
})

/** 守門：Access 有設就只認 Access 的 JWT；沒設（本機）才看 kw_session。email 要在 admins。 */
admin.use('/api/*', async (c, next) => {
  const accessOn = !!(c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD)
  let email: string | null = null
  let via: Vars['adminVia'] = 'access'
  if (accessOn) {
    email = await accessEmail(c.env, c.req.header('cf-access-jwt-assertion') ?? getCookie(c, 'CF_Authorization'))
  } else {
    const u = await getUser(c as unknown as Parameters<typeof getUser>[0])   // Variables 多了 adminEmail，型別對不上 session.ts 的 Context
    email = u?.email?.toLowerCase() ?? null
    via = 'session'
  }
  if (!email) return c.json({ error: 'admin_required' }, 401, { 'cache-control': 'no-store' })
  const row = await c.env.DB.prepare('select 1 as ok from admins where lower(email) = ?').bind(email).first()
  if (!row) return c.json({ error: 'admin_required', email }, 401, { 'cache-control': 'no-store' })
  c.set('adminEmail', email)
  c.set('adminVia', via)
  c.header('cache-control', 'no-store')
  await next()
})

admin.get('/api/me', (c) => c.json({ admin: true, email: c.get('adminEmail'), via: c.get('adminVia') }))

// ── 待審：跨店配對 ──────────────────────────────────────────────────────────
interface Side { store_id: string; product_id: string; name: string | null; brand: string | null; size: string | null; price: number | null; price_unit: string | null; was_price: number | null; unit_price: number | null; unit_price_unit: string | null; promo_type: string | null; club_only: boolean; category_id: string | null; image_url: string | null }

admin.get('/api/review/pairs', async (c) => {
  const { results: pairs } = await c.env.DB.prepare(
    "select dict_key, product_key, matched_to, confidence from product_dict where source = 'ai' and matched_to is not null and confidence < 0.8 order by confidence limit 50",
  ).all<{ dict_key: string; product_key: string; matched_to: string; confidence: number | null }>()
  if (!pairs.length) return c.json([])
  const ids = [...new Set(pairs.flatMap((p) => [p.dict_key.split('|')[1], p.matched_to]).filter(Boolean))]
  const keys = [...new Set(pairs.map((p) => p.product_key))]
  const week = nzMonday()
  const [items, prods, prices] = await c.env.DB.batch([
    c.env.DB.prepare('select chain_id, product_id, product_key, name_listed, url from chain_items where product_id in (select value from json_each(?))').bind(JSON.stringify(ids)),
    c.env.DB.prepare('select key, display_name, brand, size, category_id, image_url from products where key in (select value from json_each(?))').bind(JSON.stringify(keys)),
    c.env.DB.prepare('select chain_id, product_key, price, price_unit, regular_price, unit_price, unit_price_unit, promo_type, member_price from chain_prices where week_start = ? and product_key in (select value from json_each(?))').bind(week, JSON.stringify(keys)),
  ])
  type Item = { chain_id: string; product_id: string; product_key: string; name_listed: string | null; url: string | null }
  type Prod = { key: string; display_name: string; brand: string | null; size: string | null; category_id: string | null; image_url: string | null }
  type Price = { chain_id: string; product_key: string; price: number; price_unit: string | null; regular_price: number | null; unit_price: number | null; unit_price_unit: string | null; promo_type: string | null; member_price: number | null }
  const itemBy = new Map((items.results as Item[]).map((r) => [`${r.chain_id === 'woolworths' ? 'w' : 'f'}|${r.product_id}`, r]))
  const prodBy = new Map((prods.results as Prod[]).map((p) => [p.key, p]))
  const priceBy = new Map((prices.results as Price[]).map((p) => [`${p.chain_id}|${p.product_key}`, p]))
  const side = (group: 'f' | 'w', productId: string, key: string): Side | null => {
    const it = itemBy.get(`${group}|${productId}`)
    const p = prodBy.get(it?.product_key ?? key)
    if (!it && !p) return null
    const pr = group === 'w' ? priceBy.get(`woolworths|${key}`) : priceBy.get(`newworld|${key}`) ?? priceBy.get(`paknsave|${key}`)
    return {
      store_id: group === 'w' ? 'woolworths:?' : 'newworld:?', product_id: productId,
      name: it?.name_listed ?? p?.display_name ?? null, brand: p?.brand ?? null, size: p?.size ?? null,
      price: pr?.price ?? null, price_unit: pr?.price_unit ?? 'each', was_price: pr?.regular_price ?? null,
      unit_price: pr?.unit_price ?? null, unit_price_unit: pr?.unit_price_unit ?? null, promo_type: pr?.promo_type ?? null,
      club_only: pr?.member_price != null, category_id: p?.category_id ?? null, image_url: group === 'w' ? p?.image_url ?? null : null,
    }
  }
  return c.json(pairs.map((p) => {
    const aid = p.dict_key.split('|')[1] ?? ''
    return { dict_key: p.dict_key, product_key: p.product_key, confidence: Number(p.confidence ?? 0), matched_to: p.matched_to, display_name: prodBy.get(p.product_key)?.display_name ?? null, a: side('f', aid, p.product_key), b: side('w', p.matched_to, p.product_key) }
  }))
})

const JOB_KINDS = ['refetch_store', 'prices', 'notify_test', 'decide_pair', 'recat_week', 'family_apply', 'restart_worker']
async function insertJobs(c: { env: Env; get: (k: 'adminEmail') => string }, rows: { kind: string; payload?: unknown }[]): Promise<string[]> {
  const ids: string[] = []
  const stmt = c.env.DB.prepare("insert into admin_jobs (id, kind, payload, status, created_by, created_at) values (?, ?, ?, 'pending', ?, ?)")
  const stmts = rows.map((r) => { const id = crypto.randomUUID(); ids.push(id); return stmt.bind(id, r.kind, sqlVal(r.payload ?? {}), c.get('adminEmail'), now()) })
  if (stmts.length) await c.env.DB.batch(stmts)
  return ids
}

admin.post('/api/review/pairs/decide', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { dict_key?: unknown; same?: unknown }
  const dictKey = str(b.dict_key, 200)
  if (!dictKey || typeof b.same !== 'boolean') return c.json({ error: 'dict_key / same 不對' }, 400)
  const [id] = await insertJobs(c, [{ kind: 'decide_pair', payload: { dict_key: dictKey, same: b.same } }])
  return c.json({ id })
})

// ── 待審：名字配對 ──────────────────────────────────────────────────────────
admin.get('/api/review/names', async (c) => {
  const { results } = await c.env.DB.prepare(
    "select n.chain_id as chain, n.product_key, n.status, n.candidates, n.term, n.searched_at, p.display_name from name_matches n left join products p on p.key = n.product_key where n.status in ('review', 'none') order by n.searched_at desc limit 200",
  ).all<{ chain: string; product_key: string; status: string; candidates: string | null; term: string | null; searched_at: string | null; display_name: string | null }>()
  return c.json(results.map((r) => ({ chain: r.chain, product_key: r.product_key, status: r.status, term: r.term ?? '', searched_at: r.searched_at, name: r.display_name ?? r.product_key.replace(/_/g, ' '), candidates: parseJson<unknown[]>(r.candidates, []) })))
})

const chainsOf = (chain: string) => (chain === 'woolworths' ? ['woolworths'] : ['newworld', 'paknsave'])
admin.post('/api/review/names/same', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { chain?: unknown; product_key?: unknown; product_id?: unknown }
  const chain = str(b.chain, 20), key = str(b.product_key, 160), pid = str(b.product_id, 40)
  if (!chain || !key || !pid || !KEY.test(key)) return c.json({ error: 'chain / product_key / product_id 不對' }, 400)
  const t = now()
  await c.env.DB.batch([
    ...chainsOf(chain).map((ch) => c.env.DB.prepare('insert into chain_items (chain_id, product_id, product_key, seen_at) values (?, ?, ?, ?) on conflict (chain_id, product_id) do update set product_key = excluded.product_key, seen_at = excluded.seen_at').bind(ch, pid, key, t)),
    c.env.DB.prepare("update name_matches set status = 'matched', candidate_product_id = ?, decided_by = 'manual' where chain_id = ? and product_key = ?").bind(pid, chain, key),
  ])
  return c.json({ ok: true })
})
admin.post('/api/review/names/none', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { chain?: unknown; product_key?: unknown }
  const chain = str(b.chain, 20), key = str(b.product_key, 160)
  if (!chain || !key) return c.json({ error: 'chain / product_key 不對' }, 400)
  await c.env.DB.prepare("update name_matches set status = 'none', decided_by = 'manual' where chain_id = ? and product_key = ?").bind(chain, key).run()
  return c.json({ ok: true })
})

// ── 同類（family_dict；Worker 直接套到 products / families，不派工）────────────
const FAM_COLS = 'f.product_key, f.family_key, f.name_en, f.name_zh, f.confidence, f.cat2, p.display_name'
admin.get('/api/family/low', async (c) => {
  const { results } = await c.env.DB.prepare(`select ${FAM_COLS} from family_dict f left join products p on p.key = f.product_key where f.confidence < 0.6 order by f.confidence limit 200`).all()
  return c.json(results)
})
admin.get('/api/family/big', async (c) => {
  const min = Math.max(2, Math.min(1000, Number(c.req.query('min') ?? 30) || 30))
  const { results } = await c.env.DB.prepare('select family_key, count(*) as n from family_dict group by family_key having n >= ? order by n desc limit 200').bind(min).all()
  return c.json(results)
})
admin.get('/api/family/:key/members', async (c) => {
  const key = c.req.param('key')
  if (!KEY.test(key)) return c.json({ error: 'key 不對' }, 400)
  const { results } = await c.env.DB.prepare(`select ${FAM_COLS} from family_dict f left join products p on p.key = f.product_key where f.family_key = ? limit 500`).bind(key).all()
  return c.json(results)
})
const familyUpsert = (env: Env, key: string, en: string | null, zh: string | null) =>
  env.DB.prepare('insert into families (key, name_en, name_zh) values (?, ?, ?) on conflict (key) do update set name_en = excluded.name_en, name_zh = excluded.name_zh').bind(key, en, zh)
async function familyNames(env: Env, key: string) {
  return env.DB.prepare('select name_en, name_zh from family_dict where family_key = ? limit 1').bind(key).first<{ name_en: string | null; name_zh: string | null }>()
}
admin.post('/api/family/rename', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { family_key?: unknown; name_en?: unknown; name_zh?: unknown }
  const fk = str(b.family_key, 160)
  const en = str(b.name_en, 200) || null, zh = str(b.name_zh, 200) || null
  if (!fk || !KEY.test(fk) || (!en && !zh)) return c.json({ error: 'family_key / 名字不對' }, 400)
  const { results } = await c.env.DB.prepare('select product_key from family_dict where family_key = ?').bind(fk).all<{ product_key: string }>()
  await c.env.DB.batch([
    c.env.DB.prepare("update family_dict set name_en = ?, name_zh = ?, source = 'manual', confidence = 1, updated_at = ? where family_key = ?").bind(en, zh, now(), fk),
    familyUpsert(c.env, fk, en, zh),
  ])
  return c.json({ keys: results.map((r) => r.product_key) })
})
admin.post('/api/family/move', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { product_key?: unknown; to?: unknown }
  const pk = str(b.product_key, 160), to = str(b.to, 160)
  if (!pk || !to || !KEY.test(pk) || !KEY.test(to)) return c.json({ error: 'product_key / to 不對' }, 400)
  const got = await familyNames(c.env, to)
  if (!got) return c.json({ error: 'target_missing' }, 404)
  await c.env.DB.batch([
    c.env.DB.prepare("update family_dict set family_key = ?, name_en = ?, name_zh = ?, source = 'manual', confidence = 1, updated_at = ? where product_key = ?").bind(to, got.name_en, got.name_zh, now(), pk),
    c.env.DB.prepare('update products set family_key = ? where key = ?').bind(to, pk),
    familyUpsert(c.env, to, got.name_en, got.name_zh),
  ])
  return c.json({ ok: true, name_en: got.name_en, name_zh: got.name_zh })
})
admin.post('/api/family/merge', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { from?: unknown; to?: unknown }
  const from = str(b.from, 160), to = str(b.to, 160)
  if (!from || !to || from === to || !KEY.test(from) || !KEY.test(to)) return c.json({ error: 'from / to 不對' }, 400)
  const got = await familyNames(c.env, to)
  if (!got) return c.json({ error: 'target_missing' }, 404)
  const { results } = await c.env.DB.prepare('select product_key from family_dict where family_key = ?').bind(from).all<{ product_key: string }>()
  await c.env.DB.batch([
    c.env.DB.prepare("update family_dict set family_key = ?, name_en = ?, name_zh = ?, source = 'manual', confidence = 1, updated_at = ? where family_key = ?").bind(to, got.name_en, got.name_zh, now(), from),
    c.env.DB.prepare('update products set family_key = ? where family_key = ?').bind(to, from),
    familyUpsert(c.env, to, got.name_en, got.name_zh),
  ])
  return c.json({ keys: results.map((r) => r.product_key) })
})

// ── 每週報告、派工單 ────────────────────────────────────────────────────────
const ms = (a: string | null, b: string | null) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null)
admin.get('/api/runs', async (c) => {
  const { results } = await c.env.DB.prepare('select * from crawl_runs order by started_at desc limit 20').all<Record<string, unknown>>()
  return c.json(results.map((r) => ({ ...r, ms: ms(r.started_at as string | null, r.finished_at as string | null), needs_review: null, report: parseJson<unknown>(r.report, null) })))
})
admin.get('/api/runs/:id/stores', async (c) => {
  const { results } = await c.env.DB.prepare('select * from crawl_stores where run_id = ? order by ok, store_id').bind(c.req.param('id')).all<Record<string, unknown>>()
  return c.json(results.map((r) => ({ ...r, ok: !!r.ok, suspect: !!r.suspect, ms: r.seconds == null ? null : Math.round(Number(r.seconds) * 1000), needs_review: null, items: r.rows })))
})
admin.get('/api/jobs', async (c) => {
  const kind = c.req.query('kind')
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') ?? 20) || 20))
  const sql = 'select id, kind, payload, status, result as log, created_at, started_at, finished_at as done_at from admin_jobs' + (kind ? ' where kind = ?' : '') + ' order by created_at desc limit ?'
  const stmt = kind ? c.env.DB.prepare(sql).bind(kind, limit) : c.env.DB.prepare(sql).bind(limit)
  const { results } = await stmt.all<Record<string, unknown>>()
  return c.json(results.map((r) => ({ ...r, payload: parseJson<unknown>(r.payload, null) })))
})
admin.post('/api/jobs', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { rows?: unknown }
  const rows = Array.isArray(b.rows) ? (b.rows as { kind?: unknown; payload?: unknown }[]) : []
  if (!rows.length || rows.length > 50 || rows.some((r) => typeof r?.kind !== 'string' || !JOB_KINDS.includes(r.kind))) return c.json({ error: 'rows 不對（kind 要是 ' + JOB_KINDS.join(' / ') + '）' }, 400)
  const ids = await insertJobs(c, rows as { kind: string; payload?: unknown }[])
  return c.json({ ids })
})

// ── 即時查價現況 ─────────────────────────────────────────────────────────────
admin.get('/api/live', async (c) => {
  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const [reqs, hb, hl, nc] = await c.env.DB.batch([
    c.env.DB.prepare('select id, store_id, items, status, result, created_at, done_at from price_requests where created_at >= ? order by created_at desc limit 500').bind(since),
    c.env.DB.prepare("select at, info from heartbeats where name = 'price-worker'"),
    c.env.DB.prepare('select at, load, top, chrome, orphan, mem_free_mb from health order by at desc limit 144'),
    c.env.DB.prepare('select status, count(*) as n from name_matches group by status'),
  ])
  type R = { id: string; store_id: string; items: string | null; status: string; result: string | null; created_at: string; done_at: string | null }
  const requests = (reqs.results as R[]).map((r) => {
    const it = parseJson<{ product_ids?: string[]; product_keys?: string[] }>(r.items, {})
    return { id: r.id, store_id: r.store_id, product_ids: it.product_ids ?? [], product_keys: it.product_keys ?? [], status: r.status, error: parseJson<{ error?: string }>(r.result, {}).error ?? null, created_at: r.created_at, done_at: r.done_at }
  })
  const beat = (hb.results as { at: string; info: string | null }[])[0]
  const counts: Record<string, number> = {}
  for (const r of nc.results as { status: string; n: number }[]) counts[r.status] = r.n
  return c.json({
    requests,
    heartbeat: beat ? { at: beat.at, info: parseJson<unknown>(beat.info, null) } : null,
    health: (hl.results as Record<string, unknown>[]).map((h) => ({ ...h, top: parseJson<unknown>(h.top, null) })),
    name_counts: { matched: counts.matched ?? 0, review: counts.review ?? 0, none: counts.none ?? 0 },
  })
})

// ── 分類 ────────────────────────────────────────────────────────────────────
admin.get('/api/taxonomy/unmapped', async (c) => {
  const run = await c.env.DB.prepare('select started_at, report from crawl_runs order by started_at desc limit 1').first<{ started_at: string; report: string | null }>()
  const report = parseJson<{ unmappedCategories?: unknown[] }>(run?.report, {})
  return c.json({ run_at: run?.started_at ?? '', unmapped: Array.isArray(report.unmappedCategories) ? report.unmappedCategories : [] })
})
admin.post('/api/taxonomy/map', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { level?: unknown; ww_path?: unknown; fs_path?: unknown; note?: unknown }
  const level = Number(b.level), ww = str(b.ww_path, 300), fs = str(b.fs_path, 300)
  if (![1, 2, 3].includes(level) || !ww || !fs) return c.json({ error: 'level / ww_path / fs_path 不對' }, 400)
  await c.env.DB.prepare("insert into taxonomy_map (level, ww_path, fs_path, status, note, updated_at) values (?, ?, ?, 'manual', ?, ?) on conflict (level, ww_path) do update set fs_path = excluded.fs_path, status = 'manual', note = excluded.note, updated_at = excluded.updated_at").bind(level, ww, fs, str(b.note, 200), now()).run()
  return c.json({ ok: true })
})
admin.get('/api/taxonomy/manual', async (c) => {
  const { results } = await c.env.DB.prepare("select level, ww_path, fs_path, note, updated_at from taxonomy_map where status = 'manual' order by updated_at desc limit 100").all()
  return c.json(results)
})
admin.get('/api/taxonomy/zh', async (c) => {
  const { results } = await c.env.DB.prepare('select name, min(name_zh) as zh from categories group by name order by name').all<{ name: string; zh: string | null }>()
  return c.json(results.map((r) => ({ name: r.name, zh: r.zh ?? '' })))
})
admin.put('/api/taxonomy/zh', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; zh?: unknown }
  const name = str(b.name, 200), zh = str(b.zh, 200)
  if (!name || !zh) return c.json({ error: 'name / zh 不對' }, 400)
  const r = await c.env.DB.prepare('update categories set name_zh = ? where name = ?').bind(zh, name).run()
  return c.json({ ok: true, changed: r.meta.changes })
})

// ── 食譜 ────────────────────────────────────────────────────────────────────
admin.get('/api/recipes', async (c) => {
  const { results } = await c.env.DB.prepare('select id, week_start, source, published, reviewed, data from recipes order by week_start desc, id').all<{ id: string; week_start: string | null; source: string; published: number; reviewed: number; data: string }>()
  return c.json(results.map((r) => ({ id: r.id, week_start: r.week_start, source: r.source, published: !!r.published, reviewed: !!r.reviewed, data: parseJson<unknown>(r.data, {}) })))
})
admin.patch('/api/recipes/:id', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { published?: unknown; reviewed?: unknown; data?: unknown }
  const sets: string[] = [], vals: (string | number)[] = []
  if (typeof b.published === 'boolean') { sets.push('published = ?'); vals.push(b.published ? 1 : 0) }
  if (typeof b.reviewed === 'boolean') { sets.push('reviewed = ?'); vals.push(b.reviewed ? 1 : 0) }
  if (b.data && typeof b.data === 'object') { sets.push('data = ?'); vals.push(JSON.stringify(b.data)) }
  if (!sets.length) return c.json({ error: '沒有要改的欄位' }, 400)
  sets.push('updated_at = ?'); vals.push(now())
  const r = await c.env.DB.prepare(`update recipes set ${sets.join(', ')} where id = ?`).bind(...vals, c.req.param('id')).run()
  if (!r.meta.changes) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})
admin.post('/api/recipes/bulk', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { ids?: unknown; published?: unknown }
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string').slice(0, 500) : []
  if (!ids.length || typeof b.published !== 'boolean') return c.json({ error: 'ids / published 不對' }, 400)
  const r = await c.env.DB.prepare('update recipes set published = ?, updated_at = ? where id in (select value from json_each(?))').bind(b.published ? 1 : 0, now(), JSON.stringify(ids)).run()
  return c.json({ changed: r.meta.changes })
})
admin.delete('/api/recipes/:id', async (c) => {
  const r = await c.env.DB.prepare('delete from recipes where id = ?').bind(c.req.param('id')).run()
  if (!r.meta.changes) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})

// ── 使用者（只看）────────────────────────────────────────────────────────────
admin.get('/api/users', async (c) => {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const [us, st, lc, wc, ps, nt, au, ar] = await c.env.DB.batch([
    c.env.DB.prepare('select id, email, created_at, last_sign_in_at, lang from users order by created_at'),
    c.env.DB.prepare('select us.user_id, s.name, us.store_id from user_stores us left join stores s on s.id = us.store_id order by us.position'),
    c.env.DB.prepare('select l.user_id, count(li.id) as n from lists l join list_items li on li.list_id = l.id group by l.user_id'),
    c.env.DB.prepare('select user_id, count(*) as n from watches group by user_id'),
    c.env.DB.prepare('select distinct user_id from push_subscriptions'),
    c.env.DB.prepare('select user_id, week_start, kind, payload, sent_at from notifications order by sent_at desc limit 50'),
    c.env.DB.prepare('select scope as caller, day, count from ai_usage where day >= ?').bind(since),
    c.env.DB.prepare('select id, user_id, created_at, payload from ai_recipes order by created_at desc limit 20'),
  ])
  const by = <T extends { user_id: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) (m.get(r.user_id) ?? m.set(r.user_id, []).get(r.user_id)!).push(r); return m }
  const storesBy = by(st.results as { user_id: string; name: string | null; store_id: string }[])
  const listBy = new Map((lc.results as { user_id: string; n: number }[]).map((r) => [r.user_id, r.n]))
  const watchBy = new Map((wc.results as { user_id: string; n: number }[]).map((r) => [r.user_id, r.n]))
  const pushed = new Set((ps.results as { user_id: string }[]).map((r) => r.user_id))
  const titleOf = (payload: unknown) => { const p = parseJson<{ title?: unknown }>(payload, {}); const t = p.title; return typeof t === 'string' ? t : t && typeof t === 'object' ? String((t as { zh?: string; en?: string }).zh ?? (t as { en?: string }).en ?? '') : '' }
  return c.json({
    users: (us.results as { id: string; email: string | null; created_at: string; last_sign_in_at: string | null; lang: string | null }[]).map((u) => ({
      ...u, pushed: pushed.has(u.id), stores: (storesBy.get(u.id) ?? []).map((s) => s.name ?? s.store_id), list_count: listBy.get(u.id) ?? 0, watch_count: watchBy.get(u.id) ?? 0,
    })),
    notifications: (nt.results as Record<string, unknown>[]).map((n) => ({ ...n, payload: parseJson<unknown>(n.payload, null) })),
    ai_usage: au.results,
    ai_recipes: (ar.results as { id: string; user_id: string; created_at: string; payload: string }[]).map((r) => ({ id: r.id, user_id: r.user_id, created_at: r.created_at, title: titleOf(r.payload) })),
  })
})

// ── 開關 ────────────────────────────────────────────────────────────────────
const SETTING_KEYS = ['live_prices', 'ai_recipes', 'ai_daily_cap', 'price_daily_cap', 'announce', 'recipe_weekly', 'migrate_host', 'facebook_login']
admin.get('/api/settings', async (c) => {
  const { results } = await c.env.DB.prepare('select key, value from settings').all()
  return c.json(results)
})
admin.put('/api/settings', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { rows?: unknown }
  const rows = Array.isArray(b.rows) ? (b.rows as { key?: unknown; value?: unknown }[]) : []
  if (!rows.length || rows.some((r) => typeof r?.key !== 'string' || !SETTING_KEYS.includes(r.key) || typeof r.value !== 'string' || r.value.length > 20000)) return c.json({ error: 'rows 不對（key 要是 ' + SETTING_KEYS.join(' / ') + '）' }, 400)
  const t = now()
  await c.env.DB.batch(rows.map((r) => c.env.DB.prepare('insert into settings (key, value, updated_at) values (?, ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at').bind(r.key as string, r.value as string, t)))
  return c.json({ ok: true })
})

admin.notFound((c) => c.json({ error: 'not found' }, 404))

export default admin
