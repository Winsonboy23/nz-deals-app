// 一站 v2（一站式購物改版規格 §4.1）：某家店沒有清單裡「同一款」時，找那家店「同一種食材」的替代品。
// 資料：catalog 表（試點 11 家整個貨架、只有食品、每週翻一次、公開讀）＋ 這週的特價（比 catalog 新，同一個商品優先用特價的價）。
// 順序：① 同類 family_key（products 表）→ ② 一個都沒有才用清洗過的品名關鍵字（ilike），而且分類前兩層要一樣。
// 查詢都批次（一次 in(...) 多個 key、多家店）；候選放記憶體（店 + 清單 key），切店或清單變了只補缺的，那家特價重抓過才重算那家。
import { shallowRef } from 'vue'
import { supabase } from '../lib/supabase'
import { catLevel } from '../lib/format'
import { cleanWords, coverage, searchWords } from '../lib/nameClean'
import { unitRate, type Need } from '../lib/size'
import type { Special } from '../lib/types'
import type { StoreData } from './useSpecials'

export interface Sub {
  store_id: string
  product_id: string
  product_key: string | null
  name: string
  brand: string | null
  size: string | null
  price: number
  price_unit: string
  unit_price: number | null
  unit_price_unit: string | null
  category_id: string | null
  image_url: string | null
  /** catalog 翻到的時間；這週特價來的是 null */
  seen_at: string | null
  fromSpecial: boolean
  via: 'family' | 'keyword'
  /** 跟清單是同一個 product_key：這家有賣同一款、只是沒特價（價格是 catalog 的貨架價） */
  same: boolean
}

interface ProductRow {
  key: string
  display_name: string
  category_id: string | null
  family_key: string | null
}
interface CatalogRow {
  store_id: string
  product_id: string
  product_key: string | null
  name: string
  brand: string | null
  size: string | null
  price: number
  price_unit: string
  unit_price: number | null
  unit_price_unit: string | null
  category_id: string | null
  image_url: string | null
  seen_at: string | null
}
/** 清單裡要找替代品的一項：key、名字、參考商品的品牌（去掉品牌再比字） */
export interface CatalogItem {
  key: string
  name: string
  brand?: string | null
}

const CAT_COLS = 'store_id,product_id,product_key,name,brand,size,price,price_unit,unit_price,unit_price_unit,category_id,image_url,seen_at'
const CHUNK = 100

/** key → products 列（null = products 表裡沒有） */
const products = new Map<string, ProductRow | null>()
/** family_key → 同類所有 key */
const families = new Map<string, string[]>()
/** 同一個 key 在任何一家 catalog 的一列：清單這項本週哪家都沒特價時，拿它的規格算需要量 */
const sameRow = new Map<string, CatalogRow>()
/** `${storeId}|${key}` → 這家店的候選（過濾過，還沒排序；空陣列 = 找過、沒有） */
const cands = shallowRef<Map<string, Sub[]>>(new Map())
/** 每家店算候選時的特價版本；特價重抓過（週或 last_fetched_at 變了）就把那家的候選丟掉重算 */
const storeVer = new Map<string, string>()

const num = (v: unknown) => (v == null ? null : Number(v))
function fromCatalog(r: CatalogRow, via: Sub['via'], listKey: string): Sub {
  return {
    store_id: r.store_id, product_id: r.product_id, product_key: r.product_key, name: r.name, brand: r.brand, size: r.size,
    price: Number(r.price), price_unit: r.price_unit, unit_price: num(r.unit_price), unit_price_unit: r.unit_price_unit,
    category_id: r.category_id, image_url: r.image_url, seen_at: r.seen_at, fromSpecial: false, via, same: r.product_key === listKey,
  }
}
function fromSpecial(s: Special, via: Sub['via'], listKey: string): Sub {
  return {
    store_id: s.store_id, product_id: s.product_id, product_key: s.product_key, name: s.name, brand: s.brand, size: s.size,
    price: s.price, price_unit: s.price_unit, unit_price: s.unit_price, unit_price_unit: s.unit_price_unit,
    category_id: s.category_id, image_url: s.image_url, seen_at: null, fromSpecial: true, via, same: s.product_key === listKey,
  }
}
/** catalog 那一列這週剛好在這家特價 → 用特價的價（比 catalog 新） */
function overlay(d: StoreData, r: CatalogRow, via: Sub['via'], listKey: string): Sub {
  const sp = d.rows.find((s) => s.product_id === r.product_id)
  return sp ? fromSpecial(sp, via, listKey) : fromCatalog(r, via, listKey)
}

async function fetchProducts(keys: string[]): Promise<void> {
  const need = keys.filter((k) => !products.has(k))
  for (let i = 0; i < need.length; i += CHUNK) {
    const chunk = need.slice(i, i + CHUNK)
    const { data, error } = await supabase.from('products').select('key,display_name,category_id,family_key').in('key', chunk)
    if (error) return
    for (const k of chunk) products.set(k, null)
    for (const r of (data ?? []) as ProductRow[]) products.set(r.key, r)
  }
}
async function fetchFamilies(fams: string[]): Promise<void> {
  const need = fams.filter((f) => !families.has(f))
  for (let i = 0; i < need.length; i += CHUNK) {
    const chunk = need.slice(i, i + CHUNK)
    const { data, error } = await supabase.from('products').select('key,family_key').in('family_key', chunk)
    if (error) return
    for (const f of chunk) families.set(f, [])
    for (const r of (data ?? []) as Array<{ key: string; family_key: string }>) families.get(r.family_key)?.push(r.key)
  }
}
async function fetchCatalog(storeIds: string[], keys: string[]): Promise<CatalogRow[]> {
  const out: CatalogRow[] = []
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data, error } = await supabase.from('catalog').select(CAT_COLS).in('store_id', storeIds).in('product_key', keys.slice(i, i + CHUNK)).limit(1000)
    if (error) break
    out.push(...((data ?? []) as CatalogRow[]))
  }
  return out
}

/** ② 關鍵字：清單品名清洗後前兩個有辨識度的字去 catalog 搜，再算「清單的字有幾成出現在候選裡」。
 *  分類前兩層要一樣（避免雞胸配到雞高湯）、≥ 0.6；清單這項沒分類就 ≥ 0.8。 */
async function byKeyword(item: CatalogItem, stores: StoreData[]): Promise<Map<string, Sub[]>> {
  const out = new Map<string, Sub[]>(stores.map((d) => [d.store.id, []]))
  const prod = products.get(item.key)
  const name = prod?.display_name ?? item.name
  const words = cleanWords(name, item.brand)
  const sw = searchWords(name, item.brand)
  if (!words.length || !sw.length) return out
  const l2 = catLevel(prod?.category_id ?? null, 2)
  const min = l2 ? 0.6 : 0.8
  const pass = (catId: string | null, candName: string, brand: string | null) => {
    const c2 = catLevel(catId, 2)
    if (l2 && c2 && c2 !== l2) return false
    const need = l2 && c2 ? min : 0.8
    return coverage(words, cleanWords(`${brand ?? ''} ${candName}`)) >= need
  }
  let q = supabase.from('catalog').select(CAT_COLS).in('store_id', stores.map((d) => d.store.id))
  if (l2) q = q.like('category_id', `${l2}/%`).or(sw.map((w) => `name.ilike.%${w}%`).join(','))
  else for (const w of sw) q = q.ilike('name', `%${w}%`)
  const { data } = await q.limit(l2 ? 600 : 30 * stores.length)
  for (const d of stores) {
    const list = out.get(d.store.id)!
    // 這週特價裡的（catalog 一週翻一次，新上的特價可能還沒進去）
    for (const s of d.rows) if (pass(s.category_id, s.name, s.brand)) list.push(fromSpecial(s, 'keyword', item.key))
    for (const r of (data ?? []) as CatalogRow[]) {
      if (r.store_id !== d.store.id || list.some((x) => x.product_id === r.product_id) || !pass(r.category_id, r.name, r.brand)) continue
      list.push(overlay(d, r, 'keyword', item.key))
    }
  }
  return out
}

async function compute(stores: StoreData[], items: CatalogItem[]): Promise<void> {
  const next = new Map(cands.value)
  for (const d of stores) {
    const ver = `${d.week}|${d.fetchedAt}`
    if (storeVer.get(d.store.id) === ver) continue
    for (const k of [...next.keys()]) if (k.startsWith(`${d.store.id}|`)) next.delete(k)
    storeVer.set(d.store.id, ver)
  }
  // 要算的（店, key）：這家這週沒有這一款的特價、也還沒算過
  const todo: Array<{ d: StoreData; item: CatalogItem }> = []
  for (const d of stores) {
    const onSpecial = new Set(d.rows.map((r) => r.product_key))
    for (const item of items) if (!onSpecial.has(item.key) && !next.has(`${d.store.id}|${item.key}`)) todo.push({ d, item })
  }
  if (!todo.length) {
    if (next.size !== cands.value.size) cands.value = next
    return
  }
  const keys = [...new Set(todo.map((p) => p.item.key))]
  await fetchProducts(keys)
  await fetchFamilies([...new Set(keys.map((k) => products.get(k)?.family_key).filter((f): f is string => !!f))])

  // ① 同類：同類所有 key（含它自己：這家有賣同一款、只是沒特價）在這幾家的 catalog，加這週這家同類的特價
  const membersOf = (key: string) => {
    const f = products.get(key)?.family_key
    return new Set([key, ...(f ? families.get(f) ?? [] : [])])
  }
  const allMembers = [...new Set(keys.flatMap((k) => [...membersOf(k)]))]
  const rows = await fetchCatalog([...new Set(todo.map((p) => p.d.store.id))], allMembers)
  const byStore = new Map<string, CatalogRow[]>()
  for (const r of rows) {
    if (r.product_key && !sameRow.has(r.product_key)) sameRow.set(r.product_key, r)
    const list = byStore.get(r.store_id)
    if (list) list.push(r)
    else byStore.set(r.store_id, [r])
  }
  const keyword = new Map<string, { item: CatalogItem; stores: StoreData[] }>()
  for (const { d, item } of todo) {
    const fam = products.get(item.key)?.family_key ?? null
    const members = membersOf(item.key)
    const list: Sub[] = []
    if (fam) for (const s of d.rows) if (s.family_key === fam) list.push(fromSpecial(s, 'family', item.key))
    for (const r of byStore.get(d.store.id) ?? []) {
      if (!r.product_key || !members.has(r.product_key) || list.some((x) => x.product_id === r.product_id)) continue
      list.push(overlay(d, r, 'family', item.key))
    }
    if (list.length) next.set(`${d.store.id}|${item.key}`, list)
    else {
      const k = keyword.get(item.key) ?? { item, stores: [] }
      k.stores.push(d)
      keyword.set(item.key, k)
    }
  }

  // ② 同類一個都沒有的才用關鍵字（一項一次查詢，這項缺的幾家店一起查）
  for (const { item, stores: ss } of keyword.values()) {
    const found = await byKeyword(item, ss)
    for (const d of ss) next.set(`${d.store.id}|${item.key}`, found.get(d.store.id) ?? [])
  }
  cands.value = next
}

let running = false
let queued: [StoreData[], CatalogItem[]] | null = null
/** 算這幾家 × 清單 key 的替代品候選。同時只跑一次，跑的時候又叫就排最新的那組，跑完再算。 */
async function load(stores: StoreData[], items: CatalogItem[]): Promise<void> {
  if (running) {
    queued = [stores, items]
    return
  }
  running = true
  try {
    await compute(stores, items)
  } catch (e) {
    console.warn('[catalog]', e)
  } finally {
    running = false
  }
  if (queued) {
    const q = queued
    queued = null
    await load(...q)
  }
}

/** 這家店這一項的替代品：同一款（沒特價、貨架價）優先；其次單位對得上需要量的、每單位最便宜；都對不上就挑最便宜的（要使用者填數量）。 */
function subFor(storeId: string, key: string, need: Need): Sub | null {
  const list = cands.value.get(`${storeId}|${key}`)
  if (!list?.length) return null
  const same = list.filter((s) => s.same)
  if (same.length) return same.reduce((a, b) => (b.price < a.price ? b : a))
  let best: { s: Sub; rate: number } | null = null
  for (const s of list) {
    const rate = unitRate(need.unit, s)
    if (rate != null && (!best || rate < best.rate || (rate === best.rate && s.price < best.s.price))) best = { s, rate }
  }
  if (best) return best.s
  return [...list].sort((a, b) => a.price - b.price)[0] ?? null
}

/** 清單這項本週哪家都沒特價時，拿來算需要量的參考：catalog 同一款的一列，沒有就 products 的名字。 */
function refOf(key: string): { name: string; size?: string | null; price_unit?: string | null } | null {
  const r = sameRow.get(key)
  if (r) return r
  const p = products.get(key)
  return p ? { name: p.display_name } : null
}

/** 給 ProductThumb / displayName 用的 Special 形狀 */
function asSpecial(s: Sub): Special {
  return {
    store_id: s.store_id, product_id: s.product_id, product_key: s.product_key, family_key: null, family_name_en: null, family_name_zh: null,
    name: s.name, brand: s.brand, size: s.size, price: s.price, price_unit: s.price_unit, was_price: null, unit_price: s.unit_price,
    unit_price_unit: s.unit_price_unit, multi_buy: null, promo_type: null, club_only: false, category_id: s.category_id, image_url: s.image_url, product_url: null,
  }
}

export function useCatalog() {
  return { load, subFor, refOf, asSpecial, cands }
}
