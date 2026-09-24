// 自由輸入也要配對（一站式購物改版規格 §4.3，2026-09-24）。清單頁輸入框打的字、或清單裡還沒配對的項按「配對」：
//  ① 查自家資料（訪客也查）：你選的店這週的特價、catalog 整個貨架；打中文就查 products.family_name_zh（「豬五花」→ 五花肉那幾類）
//  ② 自家資料都沒有、有登入、打的是英文 → 請 Mac mini 去你選的店的網站搜（request_prices 的 queries，結果在 search_results）
//  候選 1 個直接採用；多個開面板讓人點一次；0 個就照原樣當自由輸入。
// 採用：特價來的 key 一定在 products → 直接 assignKey；其他先看 product_ids 有沒有這個編號（有就沿用那把 key），
// 沒有才叫 adopt_product 補 products / product_ids（list_items.product_key 有外鍵，key 不在 products 裡 useSync 會把整批清單的 key 清掉）。
import { computed, ref, watch, type Ref } from 'vue'
import { supabase } from '../lib/supabase'
import { chainOf, displayName } from '../lib/format'
import { MIN_SCORE, matchScore, parseQuery, type Query } from '../lib/search'
import { cleanWords, searchWords } from '../lib/nameClean'
import { ruleKey } from '../lib/ruleKey'
import { candSpecial, catTightness, chainGroup, isCjk, likeSafe, mergeCands, rankCands, remoteTerm, tightness, type Cand, type CandRow } from '../lib/freeText'
import type { Special } from '../lib/types'
import { useList } from './useList'
import { useSpecials } from './useSpecials'
import { useStores } from './useStores'
import { useAuth } from './useAuth'
import { useSiteSettings } from './useSiteSettings'
import { deviceId } from './useStorePrices'
import { t } from './useI18n'

export interface Picker {
  itemId: string
  /** 使用者打的字 */
  text: string
  /** 最多 6 個，排好了 */
  cands: Cand[]
  /** 從超市網站搜到的（不是自家資料） */
  remote: boolean
  cjk: boolean
}

const MAX_SHOW = 6
/** Mac mini 閒太久會關瀏覽器，第一張單要多等 20–30 秒開瀏覽器（同 useStorePrices） */
const GIVE_UP_MS = 90_000
/** 同一個字 2 分鐘內不重送，直接用上次的結果 */
const RETRY_MS = 2 * 60_000
/** adopt_product 收的 key（帶小數規格的 1.5l、1.6kg 會被擋，見回報） */
const KEY_RE = /^[a-z0-9_]{3,120}$/
const CAT_COLS = 'store_id,product_id,product_key,name,brand,size,price,price_unit,category_id,image_url'

const { items, addFreeText, assignKey } = useList()
const { activeStores, loading: specialsLoading } = useSpecials()
const { selectedStores, loading: storesLoading } = useStores()
const { isIn } = useAuth()
const { livePrices } = useSiteSettings()

const pickers = ref<Picker[]>([])
/** 正在採用的候選（面板上那列轉圈、其他列不能點） */
const busy = ref<string | null>(null)
/** 正在配對的清單項（「搜尋中…」）／配過了沒結果的（「查不到 · 自由輸入」，只記在這次打開 App） */
const searching = ref<Set<string>>(new Set())
const notFound = ref<Set<string>>(new Set())
/** 輸入框下面的一行提示（「已配對：…」），4 秒後消失 */
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
/** 送去網站搜過的字（小寫）→ 那次的結果 */
const recentRemote = new Map<string, { at: number; done: Promise<Cand[]> }>()

const itemOf = (id: string) => items.value.find((i) => i.id === id)
/** 還在清單裡、還沒配對：結果回來時才繼續 */
const stillFree = (id: string) => {
  const i = itemOf(id)
  return !!i && !i.key
}
/** 面板一次開一個；清單項被刪或已經配好的跳過 */
const picker = computed(() => pickers.value.find((p) => stillFree(p.itemId)) ?? null)

function setFlag(set: Ref<Set<string>>, id: string, on: boolean): void {
  if (set.value.has(id) === on) return
  const next = new Set(set.value)
  if (on) next.add(id)
  else next.delete(id)
  set.value = next
}
function flash(msg: string): void {
  notice.value = msg
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 4000)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** App 剛打開就打字：等店和這週特價拿到（最多 15 秒），不然會當成自家資料沒有 */
function ready(ms = 15_000): Promise<void> {
  const ok = () => !storesLoading.value && (!selectedStores.value.length || !specialsLoading.value)
  if (ok()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      stop()
      clearTimeout(timer)
      resolve()
    }
    const stop = watch(ok, (v) => v && done())
    const timer = setTimeout(done, ms)
  })
}

interface CatRow {
  store_id: string
  product_id: string
  product_key: string | null
  name: string
  brand: string | null
  size: string | null
  price: number | null
  price_unit: string | null
  category_id: string | null
  image_url: string | null
}
const fromSpecial = (s: Special, score: number, group?: string): CandRow => ({
  store_id: s.store_id, product_id: s.product_id, key: s.product_key, name: s.name, brand: s.brand, size: s.size, price: s.price,
  price_unit: s.price_unit, category_id: s.category_id, image_url: s.image_url, score, from: 'special', group,
})
const fromCatalog = (r: CatRow, score: number, group?: string): CandRow => ({
  store_id: r.store_id, product_id: r.product_id, key: r.product_key, name: r.name, brand: r.brand, size: r.size, price: r.price != null ? Number(r.price) : null,
  price_unit: r.price_unit, category_id: r.category_id, image_url: r.image_url, score, from: 'catalog', group,
})

/**
 * 英文：品名（品牌＋品名＋規格）單字比對 ≥ 0.5 才算；再加兩個「緊不緊」：
 *  品名（去掉品牌、自家牌、規格、廢字）裡打的字佔幾成，最多 1 分（Avocado ea 比 Avocado Oil 緊）；
 *  分類第二、三層的字裡打的字佔幾成，最多半分（打 milk 時 Milk › Fresh Milk 的牛奶排在椰奶、巧克力前面）。rankCands 再把分數差太多的擋掉。
 */
function scorer(q: Query) {
  return (r: { brand: string | null; name: string; size: string | null; category_id?: string | null }) => {
    const s = matchScore(q, r)
    if (s < MIN_SCORE) return 0
    return s + tightness(q.words, cleanWords(r.name, r.brand)) + 0.5 * catTightness(q.words, r.category_id ?? null)
  }
}

async function enRows(text: string, storeIds: string[]): Promise<CandRow[]> {
  const q = parseQuery(text)
  if (!q) return []
  const score = scorer(q)
  const out: CandRow[] = []
  for (const d of activeStores.value) {
    for (const s of d.rows) {
      if (!s.product_key) continue
      const sc = score(s)
      if (sc) out.push(fromSpecial(s, sc))
    }
  }
  // catalog：清洗過的前兩個字都要在品名裡（跟 useCatalog.byKeyword 一樣），再用上面的分數過濾
  const words = searchWords(text).map(likeSafe).filter((w) => w.length >= 3)
  if (words.length) {
    let qb = supabase.from('catalog').select(CAT_COLS).in('store_id', storeIds)
    for (const w of words) qb = qb.ilike('name', `%${w}%`)
    const { data, error } = await qb.limit(1000)
    if (error) console.warn('[freetext] catalog', error.message)
    for (const r of (data ?? []) as CatRow[]) {
      const sc = score(r)
      if (sc) out.push(fromCatalog(r, sc))
    }
  }
  return out
}

/** family_name_zh 對到的同類 → 分數（對到的字佔同類名稱越多越高） */
async function zhFamilies(w: string): Promise<Map<string, number>> {
  const fams = new Map<string, number>()
  const { data } = await supabase.from('products').select('family_key,family_name_zh').ilike('family_name_zh', `%${w}%`).not('family_key', 'is', null).limit(500)
  for (const r of (data ?? []) as Array<{ family_key: string; family_name_zh: string }>) {
    const sc = 1 + 0.5 * Math.min(1, w.length / Math.max(1, r.family_name_zh.length))
    fams.set(r.family_key, Math.max(fams.get(r.family_key) ?? 0, sc))
  }
  return fams
}

/** 中文：products.family_name_zh → 那幾類的 key → 本週特價和 catalog 裡有這些 key 的商品。
 *  三個字以上的也拿「去掉第一個字」再查一次、分數打八折（同類名稱常省掉「豬／牛／雞」：豬五花只對得到「豬五花小方塊」，五花 才對得到五花肉）。 */
async function zhRows(text: string, storeIds: string[]): Promise<CandRow[]> {
  const w = likeSafe(text.replace(/\s+/g, ''))
  if (w.length < 1) return []
  const fams = await zhFamilies(w)
  if (w.length >= 3) for (const [f, sc] of await zhFamilies(w.slice(1))) if (!fams.has(f)) fams.set(f, sc * 0.8)
  if (!fams.size) return []
  const out: CandRow[] = []
  for (const d of activeStores.value) {
    for (const s of d.rows) {
      const sc = s.product_key && s.family_key ? fams.get(s.family_key) : undefined
      if (sc) out.push(fromSpecial(s, sc, s.family_key!))
    }
  }
  const { data } = await supabase.from('products').select('key,family_key').in('family_key', [...fams.keys()].slice(0, 50)).limit(1000)
  const famOf = new Map(((data ?? []) as Array<{ key: string; family_key: string }>).map((r) => [r.key, r.family_key]))
  const keys = [...famOf.keys()].slice(0, 300)
  for (let i = 0; i < keys.length; i += 100) {
    const { data: rows } = await supabase.from('catalog').select(CAT_COLS).in('store_id', storeIds).in('product_key', keys.slice(i, i + 100)).limit(1000)
    for (const r of (rows ?? []) as CatRow[]) {
      const fam = r.product_key ? famOf.get(r.product_key) : undefined
      const sc = fam ? fams.get(fam) : undefined
      if (sc) out.push(fromCatalog(r, sc, fam))
    }
  }
  return out
}

/** 每 2 秒問一次單的狀態，全部 done / failed 或等超過 90 秒為止；回 done 的單號 */
async function waitFor(ids: string[]): Promise<string[]> {
  const since = Date.now()
  const open = new Set(ids)
  const done: string[] = []
  while (open.size && Date.now() - since < GIVE_UP_MS) {
    await sleep(2000)
    const { data, error } = await supabase.rpc('price_request_status', { p_ids: [...open] })
    if (error) continue
    const rows = (data ?? []) as Array<{ id: string; status: string }>
    const seen = new Set(rows.map((r) => r.id))
    for (const r of rows) {
      if (r.status === 'done') done.push(r.id)
      if (r.status === 'done' || r.status === 'failed') open.delete(r.id)
    }
    for (const id of [...open]) if (!seen.has(id)) open.delete(id)   // 單被清掉了
  }
  return done
}

interface SearchCand {
  product_id: string
  name: string
  brand: string | null
  size: string | null
  price: number | null
  price_unit: string | null
  image_url: string | null
}
async function runRemote(term: string): Promise<Cand[]> {
  const stores = selectedStores.value.slice(0, 3)
  if (!stores.length) return []
  const { data, error } = await supabase.rpc('request_prices', { p_caller: `d:${deviceId()}`, p_items: stores.map((s) => ({ store_id: s.id, queries: [term] })) })
  if (error || !Array.isArray(data) || !data.length) {
    if (error && /paused/.test(error.message)) livePrices.value = false   // 剛被後台關掉
    return []
  }
  const done = await waitFor(data as string[])
  if (!done.length) return []
  const { data: res } = await supabase.from('search_results').select('store_id,candidates').in('request_id', done).eq('term', term)
  const q = parseQuery(term)
  const rows: CandRow[] = []
  for (const r of (res ?? []) as Array<{ store_id: string; candidates: SearchCand[] | null }>) {
    ;(r.candidates ?? []).forEach((c, i) =>
      rows.push({
        store_id: r.store_id, product_id: c.product_id, key: null, name: c.name, brand: c.brand, size: c.size, price: c.price != null ? Number(c.price) : null,
        price_unit: c.price_unit, category_id: null, image_url: c.image_url, score: q ? matchScore(q, c) + tightness(q.words, cleanWords(c.name, c.brand)) : 0, from: 'search', order: i,
        group: chainGroup(r.store_id),
      }),
    )
  }
  return mergeCands(rows)
}
function remoteCands(text: string): Promise<Cand[]> {
  const term = remoteTerm(text)
  const k = term.toLowerCase()
  const hit = recentRemote.get(k)
  if (hit && Date.now() - hit.at < RETRY_MS) return hit.done
  const done = runRemote(term).catch((e) => {
    console.warn('[freetext] remote', e)
    return [] as Cand[]
  })
  recentRemote.set(k, { at: Date.now(), done })
  return done
}

/** product_ids 裡這個編號已經有的 key（New World / PAK'nSAVE 共用編號，同連鎖的優先） */
async function idsKey(productId: string, storeId: string): Promise<string | null> {
  const chain = chainOf(storeId)
  const group = chainGroup(storeId) === 'woolworths' ? ['woolworths'] : ['newworld', 'paknsave']
  const { data } = await supabase.from('product_ids').select('chain,product_key').eq('product_id', productId).in('chain', group)
  const rows = (data ?? []) as Array<{ chain: string; product_key: string }>
  return (rows.find((r) => r.chain === chain) ?? rows[0])?.product_key ?? null
}
/** 網站搜到的商品在 catalog 有沒有（有的話它的 key 是字典的 key、分類也有） */
async function catalogHint(productId: string, storeId: string): Promise<{ key: string | null; category_id: string | null } | null> {
  const { data } = await supabase.from('catalog').select('store_id,product_key,category_id').eq('product_id', productId).limit(20)
  const rows = ((data ?? []) as Array<{ store_id: string; product_key: string | null; category_id: string | null }>).filter((r) => chainGroup(r.store_id) === chainGroup(storeId))
  const r = rows.find((x) => x.product_key) ?? rows[0]
  return r ? { key: r.product_key, category_id: r.category_id } : null
}

/** 這個候選要掛哪把 key：特價的 key → product_ids 已有的 → adopt_product 新建（catalog 字典的 key，沒有就規則 key） */
async function keyFor(c: Cand): Promise<string | null> {
  if (c.fromSpecial && c.key) return c.key
  const r = c.rep
  const known = await idsKey(r.product_id, r.store_id)
  if (known) return known
  let pkey = c.key
  let cat = r.category_id
  if (!pkey && r.from === 'search') {
    const hint = await catalogHint(r.product_id, r.store_id)
    pkey = hint?.key ?? null
    cat = hint?.category_id ?? cat
  }
  pkey ??= ruleKey({ brand: r.brand, name: r.name, size: r.size, priceUnit: r.price_unit })
  if (!KEY_RE.test(pkey)) {
    console.warn('[freetext] adopt_product 不收這把 key：', pkey)
    return null
  }
  const { error } = await supabase.rpc('adopt_product', {
    p_chain: chainOf(r.store_id), p_product_id: r.product_id, p_key: pkey, p_name: displayName(candSpecial(r)), p_category_id: cat, p_store_id: r.store_id,
  })
  if (error) {
    console.warn('[freetext] adopt_product', error.message)
    return null
  }
  return (await idsKey(r.product_id, r.store_id)) ?? pkey
}

async function adopt(itemId: string, c: Cand, typed: string): Promise<boolean> {
  const key = await keyFor(c)
  if (!stillFree(itemId)) return false
  if (!key) {
    flash(t('list.matchFailed'))
    return false
  }
  const name = displayName(candSpecial(c.rep))
  assignKey(itemId, key, name)
  const it = itemOf(itemId)   // 清單裡本來就有這一樣的話，件數併過去、這項已經刪掉了
  if (it && it.name !== typed) it.typed = typed
  flash(t('list.matched', { name }))
  return true
}

/** 配對一個清單項（自由輸入）：自家資料 → （登入、英文）超市網站 → 1 個直接採用、多個開面板、0 個照原樣 */
async function match(itemId: string): Promise<void> {
  const item = itemOf(itemId)
  if (!item || item.key || searching.value.has(itemId)) return
  const text = item.name
  const cjk = isCjk(text)
  setFlag(notFound, itemId, false)
  setFlag(searching, itemId, true)
  try {
    await ready()
    const storeIds = selectedStores.value.map((s) => s.id)
    if (!storeIds.length) return
    let cands = rankCands(mergeCands(cjk ? await zhRows(text, storeIds) : await enRows(text, storeIds)), { gate: true, sort: cjk ? 'score' : 'rel', perGroup: cjk ? 2 : 0 })
    let remote = false
    if (!cands.length && !cjk && isIn.value && livePrices.value) {
      remote = true
      cands = rankCands(await remoteCands(text), { sort: 'site', perGroup: 4 })
    }
    if (!stillFree(itemId)) return
    if (!cands.length) {
      if (remote || cjk) setFlag(notFound, itemId, true)   // 訪客打英文、自家資料沒有：照舊當自由輸入，不標
      return
    }
    if (cands.length === 1) {
      await adopt(itemId, cands[0], text)
      return
    }
    pickers.value = [...pickers.value.filter((p) => p.itemId !== itemId), { itemId, text, cands: cands.slice(0, MAX_SHOW), remote, cjk }]
  } catch (e) {
    console.warn('[freetext]', e)
  } finally {
    setFlag(searching, itemId, false)
  }
}

/** 清單頁輸入框：先照舊加進清單（自由輸入，畫面上馬上看得到），再去配對 */
function addAndMatch(text: string): void {
  const id = addFreeText(text)
  if (id) void match(id)
}

async function choose(c: Cand): Promise<void> {
  const p = picker.value
  if (!p || busy.value) return
  busy.value = c.id
  try {
    await adopt(p.itemId, c, p.text)
  } finally {
    busy.value = null
    pickers.value = pickers.value.filter((x) => x !== p)
  }
}
/** 「都不是，照原樣記下」／關掉面板：這項維持自由輸入 */
function dismiss(): void {
  const p = picker.value
  if (p && !busy.value) pickers.value = pickers.value.filter((x) => x !== p)
}

/** 清單列要顯示的狀態 */
function statusOf(itemId: string): 'searching' | 'notFound' | 'notFoundZh' | null {
  if (searching.value.has(itemId)) return 'searching'
  if (!notFound.value.has(itemId)) return null
  return isCjk(itemOf(itemId)?.name ?? '') ? 'notFoundZh' : 'notFound'
}

export function useFreeText() {
  return { addAndMatch, match, picker, choose, dismiss, busy, statusOf, notice }
}
