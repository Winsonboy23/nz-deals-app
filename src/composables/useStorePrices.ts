// 各店「現在多少錢」（store_prices）：
//  - 後端週一批次幫登入者的清單先查好（Phase 2b §9b）
//  - 點「一站」缺什麼就即時送單（RPC request_prices），Mac mini 上的 price-worker 幾秒內去問，這裡每 2 秒盯狀態，好了就重讀（2026-09-10）
// 這週一換價之前查的當過期，不用、會重問。同一組（店 × 商品）2 分鐘內不重送。
import { ref, shallowRef } from 'vue'
import { supabase } from '../lib/supabase'
import { useSiteSettings } from './useSiteSettings'
import type { StorePrice } from '../lib/types'
import { nzMonday } from '../lib/week'

const COLS = 'store_id,product_id,product_key,available,price,price_unit,was_price,is_special,club_only,multi_buy,unit_price,unit_price_unit,name,fetched_at'
/** `${store_id}|${product_key}` → 這家店這樣商品的價（同 key 多個編號時取有賣且最便宜的） */
const byStoreKey = shallowRef<Map<string, StorePrice>>(new Map())
const loading = ref(false)
/** 正在問的（店|key） */
const pending = ref<Set<string>>(new Set())
/** 我的單前面還有幾張（0 = 正在做或沒在排） */
const queueAhead = ref(0)
/** 用名字配過但沒配上的（連鎖群|key）→ 'none'（找不到 · 可能沒賣）| 'review'（待人工確認）。沒編號又沒判過的會送去即時配對。 */
const nameState = ref<Map<string, 'none' | 'review'>>(new Map())
const NAME_RETRY_DAYS = 7
let lastSig = ''
let lastStores: string[] = []
let lastKeys: string[] = []
/** 送過的（店|key）→ 時間，2 分鐘內不重送 */
const tried = new Map<string, number>()
/** key → product_ids 列（chain, product_id） */
const idsOf = new Map<string, Array<{ chain: string; product_id: string }>>()
/** 追蹤中的單：id → { pairs, since } */
const tracking = new Map<string, { pairs: string[]; since: number }>()
let polling = false
const RETRY_MS = 2 * 60 * 1000
const GIVE_UP_MS = 90 * 1000   // 常駐程式閒 30 分鐘會關瀏覽器，第一個人要多等 20–30 秒開瀏覽器

const dealOf = (p: StorePrice) => (p.multi_buy && p.multi_buy.qty > 0 ? p.multi_buy.total / p.multi_buy.qty : Number(p.price))
const nzDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' })
/** 這週一（NZ）之後查的才算數 */
const fresh = (p: StorePrice) => nzDate.format(new Date(p.fetched_at)) >= nzMonday()

function deviceId(): string {
  try {
    let id = localStorage.getItem('nzd:device')
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
      localStorage.setItem('nzd:device', id)
    }
    return id
  } catch {
    return 'anon'
  }
}

/** 抓 storeIds × keys 的現價。同樣的組合不重抓（force 例外）。 */
async function load(storeIds: string[], keys: string[], force = false): Promise<void> {
  const sig = `${[...storeIds].sort().join(',')}#${[...keys].sort().join(',')}`
  if (sig === lastSig && !force) return
  lastSig = sig
  lastStores = [...storeIds]
  lastKeys = [...keys]
  if (!storeIds.length || !keys.length) {
    byStoreKey.value = new Map()
    return
  }
  loading.value = true
  try {
    const map = new Map<string, StorePrice>()
    for (let i = 0; i < keys.length; i += 100) {
      const { data, error } = await supabase.from('store_prices').select(COLS).in('store_id', storeIds).in('product_key', keys.slice(i, i + 100))
      if (error) return   // 表還沒建或斷線：當作沒有，UI 維持「價格未知」
      for (const raw of (data ?? []) as unknown as StorePrice[]) {
        if (!raw.product_key || !fresh(raw)) continue
        const k = `${raw.store_id}|${raw.product_key}`
        const cur = map.get(k)
        const row: StorePrice = { ...raw, price: raw.price != null ? Number(raw.price) : null, was_price: raw.was_price != null ? Number(raw.was_price) : null, unit_price: raw.unit_price != null ? Number(raw.unit_price) : null }
        if (!cur || (row.available && (!cur.available || dealOf(row) < dealOf(cur)))) map.set(k, row)
      }
    }
    if (sig === lastSig) byStoreKey.value = map
  } finally {
    loading.value = false
  }
}

function priceAt(storeId: string, key: string | null): StorePrice | undefined {
  return key ? byStoreKey.value.get(`${storeId}|${key}`) : undefined
}
const isPending = (storeId: string, key: string | null) => !!key && pending.value.has(`${storeId}|${key}`)
const groupOf = (storeId: string) => (storeId.startsWith('woolworths:') ? 'woolworths' : 'foodstuffs')
/** 這家連鎖用名字配過的結果（沒有 = 還沒配過或已配上） */
const nameStateAt = (storeId: string, key: string | null): 'none' | 'review' | undefined => (key ? nameState.value.get(`${groupOf(storeId)}|${key}`) : undefined)

/** name_matches：這些 key 在各連鎖群配過沒（none / review 才記；matched 的編號已經在 product_ids 裡）。 */
async function loadNameState(keys: string[]): Promise<void> {
  const next = new Map(nameState.value)
  const cutoff = Date.now() - NAME_RETRY_DAYS * 86400000
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await supabase.from('name_matches').select('chain,product_key,status,searched_at').in('product_key', keys.slice(i, i + 100))
    if (error) return
    for (const r of (data ?? []) as Array<{ chain: string; product_key: string; status: string; searched_at: string }>) {
      const k = `${r.chain}|${r.product_key}`
      if ((r.status === 'none' || r.status === 'review') && new Date(r.searched_at).getTime() > cutoff) next.set(k, r.status)
      else next.delete(k)
    }
  }
  nameState.value = next
}

/** key → 各家編號（product_ids 表，公開讀）。查過的記在記憶體（force = 重抓，配對完要更新）。 */
async function resolveIds(keys: string[], force = false): Promise<void> {
  const need = force ? keys : keys.filter((k) => !idsOf.has(k))
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100)
    const { data, error } = await supabase.from('product_ids').select('chain,product_id,product_key').in('product_key', chunk)
    if (error) return
    for (const k of chunk) idsOf.set(k, [])
    for (const r of (data ?? []) as Array<{ chain: string; product_id: string; product_key: string }>) idsOf.get(r.product_key)!.push({ chain: r.chain, product_id: r.product_id })
  }
}
const chainGroup = (storeId: string) => (storeId.startsWith('woolworths:') ? ['woolworths'] : ['newworld', 'paknsave'])

/** 點「一站」時：這些（店, key）沒價格 → 送單去問。有編號的送編號；沒編號、也還沒用名字配過的，送 key 讓後端用名字配（規則）。 */
async function request(pairs: Array<{ storeId: string; key: string }>): Promise<void> {
  if (!useSiteSettings().livePrices.value) return   // 後台把即時查價關掉了
  const now = Date.now()
  const todo = pairs.filter(({ storeId, key }) => {
    const id = `${storeId}|${key}`
    return !pending.value.has(id) && !nameStateAt(storeId, key) && (tried.get(id) ?? 0) < now - RETRY_MS
  })
  if (!todo.length) return
  for (const { storeId, key } of todo) tried.set(`${storeId}|${key}`, now)
  const keys = [...new Set(todo.map((p) => p.key))]
  await Promise.all([resolveIds(keys), loadNameState(keys)])
  const byStore = new Map<string, { ids: Set<string>; keys: Set<string>; pairs: string[] }>()
  for (const { storeId, key } of todo) {
    const ids = (idsOf.get(key) ?? []).filter((r) => chainGroup(storeId).includes(r.chain)).map((r) => r.product_id)
    const pairId = `${storeId}|${key}`
    if (!ids.length && nameStateAt(storeId, key)) continue   // 最近用名字配過、沒配上：畫面直接顯示結果
    const b = byStore.get(storeId) ?? { ids: new Set<string>(), keys: new Set<string>(), pairs: [] }
    if (ids.length) for (const id of ids) b.ids.add(id)
    else b.keys.add(key)
    b.pairs.push(pairId)
    byStore.set(storeId, b)
  }
  if (!byStore.size) return
  const items = [...byStore.entries()].map(([store_id, b]) => ({ store_id, product_ids: [...b.ids], product_keys: [...b.keys] }))
  const nextPending = new Set(pending.value)
  for (const b of byStore.values()) for (const p of b.pairs) nextPending.add(p)
  pending.value = nextPending
  const { data, error } = await supabase.rpc('request_prices', { p_caller: `d:${deviceId()}`, p_items: items })
  if (error || !Array.isArray(data)) {   // 額度滿了／後端沒開：當作沒問到
    if (error && /paused/.test(error.message)) useSiteSettings().livePrices.value = false   // 剛被後台關掉
    const back = new Set(pending.value)
    for (const b of byStore.values()) for (const p of b.pairs) back.delete(p)
    pending.value = back
    return
  }
  const stores = [...byStore.keys()]
  ;(data as string[]).forEach((id, i) => {
    const b = byStore.get(stores[i]!)
    if (b) tracking.set(id, { pairs: b.pairs, since: now })
  })
  void poll()
}

/** 每 2 秒問一次單的狀態；done / failed / 等超過 60 秒 → 拿掉轉圈，done 的重讀價格。 */
async function poll(): Promise<void> {
  if (polling) return
  polling = true
  try {
    while (tracking.size) {
      await new Promise((r) => setTimeout(r, 2000))
      const ids = [...tracking.keys()]
      const { data, error } = await supabase.rpc('price_request_status', { p_ids: ids })
      const now = Date.now()
      const finished: string[] = []
      let anyDone = false
      let ahead = 0
      const rows = error ? [] : ((data ?? []) as Array<{ id: string; status: string; ahead: number }>)
      const seen = new Set(rows.map((r) => r.id))
      for (const r of rows) {
        if (r.status === 'done') { finished.push(r.id); anyDone = true }
        else if (r.status === 'failed') finished.push(r.id)
        else ahead = Math.max(ahead, r.ahead ?? 0)
      }
      for (const [id, t] of tracking) if (now - t.since > GIVE_UP_MS || (!seen.has(id) && !error)) finished.push(id)
      queueAhead.value = ahead
      if (anyDone) {   // 先把結果讀進來，再拿掉轉圈，畫面不會閃一下「未知」。配對可能新增了編號 → 編號和配對狀態也重抓
        const doneKeys = [...new Set(finished.flatMap((id) => (tracking.get(id)?.pairs ?? []).map((p) => p.split('|')[1]!)))]
        await Promise.all([resolveIds(doneKeys, true), loadNameState(doneKeys)])
        await load(lastStores, lastKeys, true)
      }
      if (finished.length) {
        const next = new Set(pending.value)
        for (const id of finished) { for (const p of tracking.get(id)?.pairs ?? []) next.delete(p); tracking.delete(id) }
        pending.value = next
      }
    }
    await load(lastStores, lastKeys, true)   // 全部做完再讀一次，保險
  } finally {
    polling = false
    queueAhead.value = 0
  }
}

export function useStorePrices() {
  return { load, priceAt, isPending, nameStateAt, request, loading, pending, queueAhead, byStoreKey }
}
