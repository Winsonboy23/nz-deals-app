// /api/me/*（docs/stage4-contract.md §3，2026-10-26）：登入者自己的資料。每條都 requireUser，每條寫入都帶 user_id（取代 RLS 的那條線）。
// 回的形狀跟 App 現在從 Supabase 拿的一樣（useSync / useCards / usePush / aiRecipe.ts / account.ts），App 端只換資料來源不改欄位名。
//
//   GET    /api/me/sync                 { stores, list: { id, share_token, items }, watches }（沒清單就先建一份）
//   PUT    /api/me/stores               { ids } ≤ 3 → 整組取代
//   PUT    /api/me/list/items           { items: ListItem[] } → 整組取代（upsert 每個 id、刪不在裡面的）
//   POST   /api/me/list/share           → { share_token }（沒有就產生 16 碼 hex）
//   PUT    /api/me/watches/:key   DELETE /api/me/watches/:key
//   PUT    /api/me/push                 { endpoint, keys } → upsert + users.notify_push = 1
//   DELETE /api/me/push                 { endpoint } → 刪 + users.notify_push = 0
//   GET    /api/me/cards   POST /api/me/cards   PATCH /api/me/cards/:id { position }   DELETE /api/me/cards/:id
//   GET    /api/me/ai-recipes   GET /api/me/ai-recipes/:id   DELETE /api/me/ai-recipes/:id
//   PATCH  /api/me                      { lang?, island? }
//   DELETE /api/me                      刪帳號（cascade）+ 清 cookie
//
// 公開的 GET /api/lists/:token 在 `publicLists`（另一個 Hono app，index.ts 掛在 /api），不在 /api/me 底下。
import { Hono } from 'hono'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from './env'
import { requireUser, destroySession } from './session'

type App = Hono<{ Bindings: Env }>
type C = Context<{ Bindings: Env }>

const STORE_ID = /^[a-z]+:[A-Za-z0-9-]{1,64}$/
const KEY = /^[a-z0-9_.-]{1,160}$/i
const ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_STORES = 3
const MAX_ITEMS = 500
const BATCH = 100

// ── 形狀（§3）─────────────────────────────────────────────────────────────────
export interface ListItem { id: string; product_key: string | null; free_text: string | null; qty: number; checked: boolean; source: string | null; position: number; price: number | null; checked_at: string | null }
export interface LoyaltyCard { id: string; chain: string; label: string | null; code: string; format: string; position: number }
export interface AiRecipeRow { id: string; created_at: string; title: string; cuisine: string | null; serves: number | null; minutes: number | null; kcal: number | null; difficulty: string | null; ingredients: unknown[]; steps: string[]; tip: string | null; image_url: string | null; image_credit: unknown | null }

interface ItemRow { id: string; product_key: string | null; free_text: string | null; qty: number | null; checked: number | null; source: string | null; position: number | null; price: number | null; checked_at: string | null }
const ITEM_COLS = 'id, product_key, free_text, qty, checked, source, position, price, checked_at'
const toItem = (r: ItemRow): ListItem => ({ id: r.id, product_key: r.product_key, free_text: r.free_text, qty: Number(r.qty ?? 1), checked: !!r.checked, source: r.source, position: Number(r.position ?? 0), price: r.price, checked_at: r.checked_at })

interface CardRow { id: string; chain: string; label: string | null; number: string; format: string | null; position: number | null }
const CARD_COLS = 'id, chain, label, number, format, position'
const toCard = (r: CardRow): LoyaltyCard => ({ id: r.id, chain: r.chain, label: r.label, code: r.number, format: r.format ?? 'CODE128', position: Number(r.position ?? 0) })

interface RecipeRow { id: string; created_at: string; payload: string }
/** D1 ai_recipes 只有 payload（整道 JSON），攤平成 App 讀 Supabase 時的那幾欄 */
function toRecipe(r: RecipeRow): AiRecipeRow {
  let p: Record<string, unknown> = {}
  try { p = (JSON.parse(r.payload) ?? {}) as Record<string, unknown> } catch { /* 壞掉的 payload 當空 */ }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    id: r.id,
    created_at: r.created_at,
    title: str(p.title) ?? '',
    cuisine: str(p.cuisine),
    serves: num(p.serves),
    minutes: num(p.minutes),
    kcal: num(p.kcal),
    difficulty: str(p.difficulty),
    ingredients: Array.isArray(p.ingredients) ? p.ingredients : [],
    steps: Array.isArray(p.steps) ? (p.steps as unknown[]).filter((s): s is string => typeof s === 'string') : [],
    tip: str(p.tip),
    image_url: str(p.image_url),
    image_credit: p.image_credit ?? null,
  }
}

// ── 小工具 ───────────────────────────────────────────────────────────────────
const bad = (c: C, msg: string) => c.json({ error: 'bad_request', message: msg }, 400)
const noStore = { 'cache-control': 'no-store' } as const

async function readBody<T>(c: C): Promise<T | null> {
  try { return (await c.req.json()) as T } catch { return null }
}
const hex = (bytes: number) => { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, '0')).join('') }

/** 一人一份清單：沒有就建（name 用表的預設）。 */
async function getOrCreateList(env: Env, userId: string): Promise<{ id: string; share_token: string | null }> {
  const row = await env.DB.prepare('select id, share_token from lists where user_id = ? order by created_at limit 1').bind(userId).first<{ id: string; share_token: string | null }>()
  if (row) return row
  const id = crypto.randomUUID()
  await env.DB.prepare('insert into lists (id, user_id) values (?, ?)').bind(id, userId).run()
  return { id, share_token: null }
}

async function listItems(env: Env, listId: string): Promise<ListItem[]> {
  const { results } = await env.DB.prepare(`select ${ITEM_COLS} from list_items where list_id = ? order by position, id`).bind(listId).all<ItemRow>()
  return results.map(toItem)
}

/** index.ts 的 app.onError 把所有錯誤都當 500；requireUser 丟的 HTTPException(401) 要在這層先回它自己的 Response。 */
const passHttpException = (err: Error, _c: C) => {
  if (err instanceof HTTPException) return err.getResponse()
  throw err
}

// ── /api/me ──────────────────────────────────────────────────────────────────
const me: App = new Hono<{ Bindings: Env }>()
me.onError(passHttpException)

me.get('/sync', async (c) => {
  const user = await requireUser(c)
  const [stores, list, watches] = await Promise.all([
    c.env.DB.prepare('select store_id from user_stores where user_id = ? order by position, store_id').bind(user.id).all<{ store_id: string }>(),
    getOrCreateList(c.env, user.id),
    c.env.DB.prepare('select product_key from watches where user_id = ? order by created_at').bind(user.id).all<{ product_key: string }>(),
  ])
  const items = await listItems(c.env, list.id)
  return c.json({ stores: stores.results.map((r) => r.store_id), list: { id: list.id, share_token: list.share_token, items }, watches: watches.results.map((r) => r.product_key) }, 200, noStore)
})

me.put('/stores', async (c) => {
  const user = await requireUser(c)
  const b = await readBody<{ ids?: unknown }>(c)
  if (!b || !Array.isArray(b.ids)) return bad(c, 'ids 要是陣列')
  const ids = [...new Set((b.ids as unknown[]).filter((s): s is string => typeof s === 'string' && STORE_ID.test(s)))]
  if (ids.length > MAX_STORES) return bad(c, `最多 ${MAX_STORES} 間店`)
  await c.env.DB.batch([
    c.env.DB.prepare('delete from user_stores where user_id = ?').bind(user.id),
    ...ids.map((store_id, position) => c.env.DB.prepare('insert into user_stores (user_id, store_id, position) values (?, ?, ?)').bind(user.id, store_id, position)),
  ])
  return c.json({ ok: true }, 200, noStore)
})

me.put('/list/items', async (c) => {
  const user = await requireUser(c)
  const b = await readBody<{ items?: unknown }>(c)
  if (!b || !Array.isArray(b.items)) return bad(c, 'items 要是陣列')
  if (b.items.length > MAX_ITEMS) return bad(c, `一份清單最多 ${MAX_ITEMS} 項`)
  const items: ListItem[] = []
  for (const [i, raw] of (b.items as unknown[]).entries()) {
    const x = raw as Partial<Record<keyof ListItem, unknown>> | null
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !ID.test(x.id)) return bad(c, `第 ${i} 項缺 id`)
    const key = typeof x.product_key === 'string' && KEY.test(x.product_key) ? x.product_key : null
    const text = typeof x.free_text === 'string' ? x.free_text.slice(0, 500) : null
    if (!key && text === null) return bad(c, `第 ${i} 項 product_key 和 free_text 至少一個`)
    items.push({
      id: x.id,
      product_key: key,
      free_text: text,
      qty: typeof x.qty === 'number' && Number.isFinite(x.qty) ? x.qty : 1,
      checked: !!x.checked,
      source: typeof x.source === 'string' ? x.source.slice(0, 60) : null,
      position: typeof x.position === 'number' && Number.isFinite(x.position) ? x.position : i,
      price: typeof x.price === 'number' && Number.isFinite(x.price) ? x.price : null,
      checked_at: typeof x.checked_at === 'string' ? x.checked_at : null,
    })
  }
  const list = await getOrCreateList(c.env, user.id)
  // upsert：id 是全表主鍵，別人的 id 撞到了只更新「本來就在這份清單裡」的列（where 條件），不會把別人的項目搬過來
  const up = c.env.DB.prepare(
    'insert into list_items (id, list_id, product_key, free_text, qty, checked, source, position, price, checked_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'on conflict (id) do update set product_key = excluded.product_key, free_text = excluded.free_text, qty = excluded.qty, checked = excluded.checked, source = excluded.source, position = excluded.position, price = excluded.price, checked_at = excluded.checked_at ' +
    'where list_items.list_id = excluded.list_id',
  )
  for (let i = 0; i < items.length; i += BATCH) {
    await c.env.DB.batch(items.slice(i, i + BATCH).map((it) => up.bind(it.id, list.id, it.product_key, it.free_text, it.qty, it.checked ? 1 : 0, it.source, it.position, it.price, it.checked_at)))
  }
  // 不在這次清單裡的刪掉（json_each 繞過 100 個綁定參數上限）
  const del = await c.env.DB.prepare('delete from list_items where list_id = ? and id not in (select value from json_each(?))').bind(list.id, JSON.stringify(items.map((it) => it.id))).run()
  return c.json({ ok: true, count: items.length, removed: del.meta.changes }, 200, noStore)
})

me.post('/list/share', async (c) => {
  const user = await requireUser(c)
  const list = await getOrCreateList(c.env, user.id)
  let token = list.share_token
  if (!token) {
    token = hex(8)
    await c.env.DB.prepare('update lists set share_token = ? where id = ? and user_id = ? and share_token is null').bind(token, list.id, user.id).run()
    token = (await c.env.DB.prepare('select share_token from lists where id = ?').bind(list.id).first<{ share_token: string }>())?.share_token ?? token
  }
  return c.json({ share_token: token }, 200, noStore)
})

me.put('/watches/:key', async (c) => {
  const user = await requireUser(c)
  const key = c.req.param('key')
  if (!KEY.test(key)) return bad(c, 'key 不對')
  await c.env.DB.prepare('insert or ignore into watches (user_id, product_key) values (?, ?)').bind(user.id, key).run()
  return c.json({ ok: true }, 200, noStore)
})
me.delete('/watches/:key', async (c) => {
  const user = await requireUser(c)
  const key = c.req.param('key')
  if (!KEY.test(key)) return bad(c, 'key 不對')
  await c.env.DB.prepare('delete from watches where user_id = ? and product_key = ?').bind(user.id, key).run()
  return c.json({ ok: true }, 200, noStore)
})

me.put('/push', async (c) => {
  const user = await requireUser(c)
  const b = await readBody<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>(c)
  const endpoint = typeof b?.endpoint === 'string' && /^https:\/\/.{1,1900}$/.test(b.endpoint) ? b.endpoint : null
  const keys = b?.keys && typeof b.keys.p256dh === 'string' && typeof b.keys.auth === 'string' ? { p256dh: b.keys.p256dh, auth: b.keys.auth } : null
  if (!endpoint || !keys) return bad(c, 'endpoint 和 keys {p256dh, auth} 都要')
  await c.env.DB.batch([
    // endpoint 是 PK；同一台裝置換人登入就把訂閱改到新的人名下
    c.env.DB.prepare('insert into push_subscriptions (endpoint, user_id, keys) values (?, ?, ?) on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys').bind(endpoint, user.id, JSON.stringify(keys)),
    c.env.DB.prepare('update users set notify_push = 1 where id = ?').bind(user.id),
  ])
  return c.json({ ok: true }, 200, noStore)
})
me.delete('/push', async (c) => {
  const user = await requireUser(c)
  const b = await readBody<{ endpoint?: unknown }>(c)
  const endpoint = typeof b?.endpoint === 'string' ? b.endpoint : null
  if (!endpoint) return bad(c, 'endpoint 要給')
  await c.env.DB.batch([
    c.env.DB.prepare('delete from push_subscriptions where endpoint = ? and user_id = ?').bind(endpoint, user.id),
    c.env.DB.prepare('update users set notify_push = 0 where id = ?').bind(user.id),
  ])
  return c.json({ ok: true }, 200, noStore)
})

me.get('/cards', async (c) => {
  const user = await requireUser(c)
  const { results } = await c.env.DB.prepare(`select ${CARD_COLS} from loyalty_cards where user_id = ? order by position, created_at`).bind(user.id).all<CardRow>()
  return c.json(results.map(toCard), 200, noStore)
})
me.post('/cards', async (c) => {
  const user = await requireUser(c)
  const b = await readBody<{ chain?: unknown; label?: unknown; code?: unknown; format?: unknown }>(c)
  const chain = typeof b?.chain === 'string' && /^[a-z]{1,20}$/.test(b.chain) ? b.chain : null
  const code = typeof b?.code === 'string' && b.code.trim() && b.code.length <= 64 ? b.code.trim() : null
  const format = typeof b?.format === 'string' && /^[A-Z0-9]{1,16}$/.test(b.format) ? b.format : null
  const label = typeof b?.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 60) : null
  if (!chain || !code || !format) return bad(c, 'chain / code / format 都要')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('insert into loyalty_cards (id, user_id, chain, label, number, format, position) values (?, ?, ?, ?, ?, ?, (select coalesce(max(position), -1) + 1 from loyalty_cards where user_id = ?))')
    .bind(id, user.id, chain, label, code, format, user.id).run()
  const row = await c.env.DB.prepare(`select ${CARD_COLS} from loyalty_cards where id = ? and user_id = ?`).bind(id, user.id).first<CardRow>()
  if (!row) return c.json({ error: 'internal' }, 500)
  return c.json(toCard(row), 200, noStore)
})
me.patch('/cards/:id', async (c) => {
  const user = await requireUser(c)
  const id = c.req.param('id')
  const b = await readBody<{ position?: unknown }>(c)
  if (!ID.test(id)) return bad(c, 'id 不對')
  if (typeof b?.position !== 'number' || !Number.isInteger(b.position) || b.position < 0) return bad(c, 'position 要是非負整數')
  const r = await c.env.DB.prepare('update loyalty_cards set position = ? where id = ? and user_id = ?').bind(b.position, id, user.id).run()
  if (!r.meta.changes) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true }, 200, noStore)
})
me.delete('/cards/:id', async (c) => {
  const user = await requireUser(c)
  const id = c.req.param('id')
  if (!ID.test(id)) return bad(c, 'id 不對')
  await c.env.DB.prepare('delete from loyalty_cards where id = ? and user_id = ?').bind(id, user.id).run()
  return c.json({ ok: true }, 200, noStore)
})

me.get('/ai-recipes', async (c) => {
  const user = await requireUser(c)
  const { results } = await c.env.DB.prepare('select id, created_at, payload from ai_recipes where user_id = ? order by created_at desc limit 100').bind(user.id).all<RecipeRow>()
  return c.json(results.map(toRecipe), 200, noStore)
})
me.get('/ai-recipes/:id', async (c) => {
  const user = await requireUser(c)
  const id = c.req.param('id')
  if (!ID.test(id)) return bad(c, 'id 不對')
  const row = await c.env.DB.prepare('select id, created_at, payload from ai_recipes where id = ? and user_id = ?').bind(id, user.id).first<RecipeRow>()
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(toRecipe(row), 200, noStore)
})
me.delete('/ai-recipes/:id', async (c) => {
  const user = await requireUser(c)
  const id = c.req.param('id')
  if (!ID.test(id)) return bad(c, 'id 不對')
  await c.env.DB.prepare('delete from ai_recipes where id = ? and user_id = ?').bind(id, user.id).run()
  return c.json({ ok: true }, 200, noStore)
})

me.patch('/', async (c) => {
  const user = await requireUser(c)
  const b = await readBody<{ lang?: unknown; island?: unknown }>(c)
  if (!b) return bad(c, 'body 不是 JSON')
  const sets: string[] = [], vals: string[] = []
  if (b.lang !== undefined) {
    if (b.lang !== 'zh' && b.lang !== 'en') return bad(c, 'lang 只能 zh / en')
    sets.push('lang = ?'); vals.push(b.lang)
  }
  if (b.island !== undefined) {
    if (b.island !== 'NI' && b.island !== 'SI') return bad(c, 'island 只能 NI / SI')
    sets.push('island = ?'); vals.push(b.island)
  }
  if (!sets.length) return bad(c, 'lang 或 island 至少一個')
  await c.env.DB.prepare(`update users set ${sets.join(', ')} where id = ?`).bind(...vals, user.id).run()
  return c.json({ ok: true }, 200, noStore)
})

me.delete('/', async (c) => {
  const user = await requireUser(c)
  // users 一刪，sessions／user_stores／lists（→ list_items）／watches／push_subscriptions／notifications／ai_recipes／loyalty_cards 全 cascade
  await c.env.DB.prepare('delete from users where id = ?').bind(user.id).run()
  await destroySession(c)
  return c.json({ ok: true }, 200, noStore)
})

// ── 公開：分享清單 GET /api/lists/:token（index.ts 掛在 /api）────────────────
export const publicLists: App = new Hono<{ Bindings: Env }>()
publicLists.onError(passHttpException)
publicLists.get('/lists/:token', async (c) => {
  const token = c.req.param('token')
  if (!/^[a-f0-9]{16}$/i.test(token)) return c.json({ error: 'not_found' }, 404)
  const list = await c.env.DB.prepare('select id, name from lists where share_token = ?').bind(token).first<{ id: string; name: string }>()
  if (!list) return c.json({ error: 'not_found' }, 404)
  return c.json({ name: list.name, items: await listItems(c.env, list.id) }, 200, { 'cache-control': 'public, max-age=30' })
})

export default me
