// 自由輸入配對（一站式購物改版規格 §4.3）用的純函式：候選去重、排序、送去超市網站搜的字。
// 查資料、送單、採用在 composables/useFreeText.ts；這個檔只 import 型別，tests/freetext.test.ts 才能直接用 node 跑。
import type { Special } from './types'

/** 一筆找到的商品（本週特價、catalog 貨架、或 Mac mini 去超市網站搜到的） */
export interface CandRow {
  store_id: string
  product_id: string
  /** 特價的 product_key、catalog 的 product_key（字典裡有才有）；網站搜到的是 null */
  key: string | null
  name: string
  brand: string | null
  size: string | null
  price: number | null
  price_unit: string | null
  category_id: string | null
  image_url: string | null
  /** 跟打的字有多像（越大越像） */
  score: number
  from: 'special' | 'catalog' | 'search'
  /** 網站搜尋回來的順序（同分同價時照網站的順序） */
  order?: number
  /** 中文查到的同類（family_key）：面板上同一類最多列兩個 */
  group?: string
}

/** 去重後的一個候選：同一個 key，或同一個連鎖群的同一個編號 */
export interface Cand {
  id: string
  /** 已知的 product_key（特價或 catalog 來的）；null = 要用規則 key 新建 */
  key: string | null
  /** 有這週的特價列：key 一定已經在 products 表，直接用 */
  fromSpecial: boolean
  /** 採用時拿哪一列去 adopt_product（特價列 → 有價的最便宜 → 第一列） */
  rep: CandRow
  rows: CandRow[]
  /** 你選的店裡有幾家有 */
  stores: string[]
  minPrice: number | null
  minUnit: string | null
  score: number
  order: number
  group?: string
}

/** New World 和 PAK'nSAVE 共用商品編號，同編號就是同一樣 */
export const chainGroup = (storeId: string) => (storeId.startsWith('woolworths:') ? 'woolworths' : 'foodstuffs')

/** 同一個 key 併在一起；沒 key 的照「連鎖群 + 編號」併（先處理有 key 的，沒 key 的同編號才併得進去） */
export function mergeCands(rows: CandRow[]): Cand[] {
  const byId = new Map<string, Cand>()
  const alias = new Map<string, string>()
  const sorted = [...rows].sort((a, b) => Number(!a.key) - Number(!b.key))
  for (const r of sorted) {
    const pid = `${chainGroup(r.store_id)}|${r.product_id}`
    const id = r.key ?? alias.get(pid) ?? pid
    alias.set(pid, id)
    let c = byId.get(id)
    if (!c) {
      c = { id, key: r.key, fromSpecial: false, rep: r, rows: [], stores: [], minPrice: null, minUnit: null, score: r.score, order: r.order ?? 0, group: r.group }
      byId.set(id, c)
    }
    c.rows.push(r)
    if (!c.key && r.key) c.key = r.key
    if (r.from === 'special' && r.key) c.fromSpecial = true
    if (!c.stores.includes(r.store_id)) c.stores.push(r.store_id)
    if (r.price != null && (c.minPrice == null || r.price < c.minPrice)) {
      c.minPrice = r.price
      c.minUnit = r.price_unit
    }
    c.score = Math.max(c.score, r.score)
    c.order = Math.min(c.order, r.order ?? 0)
  }
  for (const c of byId.values()) {
    const priced = c.rows.filter((r) => r.price != null).sort((a, b) => (a.price as number) - (b.price as number))
    c.rep = c.rows.find((r) => r.from === 'special' && r.key) ?? priced[0] ?? c.rows[0]
  }
  return [...byId.values()]
}

/** 幾家有的份量：一家 0.15 分。像不像差不多時，幾家都有的排前面；但不會讓「Avocado Oil 兩家有」排到「Avocado ea」前面 */
export const STORE_WEIGHT = 0.15

export interface RankOpts {
  /** 自家資料用：只留分數到最好那個七成五的，不然打 milk 會先列三家都有的牛奶巧克力 */
  gate?: boolean
  /**
   * rel（英文、自家資料）：分數 ＋ 幾家有（一家 0.15）→ 價格。
   * score（中文）：先比分數（哪一類對得最準）→ 幾家有 → 價格。打豬五花時五花培根三家都有，照 rel 會排在五花肉前面。
   * site（超市網站搜到的）：幾家有 → 網站的順序 → 價格。網站已經照像不像排過；純照價格，打 toilet paper 第一個是 Pams 擦手紙。
   */
  sort?: 'rel' | 'score' | 'site'
  /** 同一組（group）最多列幾個：中文是同一類、網站搜到的是同一個連鎖群（不然六格全是紅超黃超、看不到綠超） */
  perGroup?: number
}
/** 2026-09-24 實測：照「幾家有」排第一，打 milk 前 6 個全是三家都有的調味奶、打 avocado 第 2 個是酪梨油，所以自家資料把幾家有折成分數（rel）。 */
export function rankCands(cands: Cand[], opts: RankOpts = {}): Cand[] {
  const best = Math.max(0, ...cands.map((c) => c.score))
  const kept = opts.gate ? cands.filter((c) => c.score >= best * 0.75) : [...cands]
  const rel = (c: Cand) => c.score + STORE_WEIGHT * c.stores.length
  const price = (a: Cand, b: Cand) => (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity)
  const sorts = {
    rel: (a: Cand, b: Cand) => rel(b) - rel(a) || price(a, b) || a.order - b.order,
    score: (a: Cand, b: Cand) => b.score - a.score || b.stores.length - a.stores.length || price(a, b) || a.order - b.order,
    site: (a: Cand, b: Cand) => b.stores.length - a.stores.length || a.order - b.order || price(a, b),
  }
  kept.sort(sorts[opts.sort ?? 'rel'])
  if (!opts.perGroup) return kept
  const n = new Map<string, number>()
  return kept.filter((c) => {
    if (!c.group) return true
    const k = (n.get(c.group) ?? 0) + 1
    n.set(c.group, k)
    return k <= opts.perGroup!
  })
}

const sing = (w: string) => (w.length <= 3 || /ss$/.test(w) ? w : /ies$/.test(w) ? w.slice(0, -3) + 'y' : /s$/.test(w) ? w.slice(0, -1) : w)
/** 品名裡有幾成是打的字（0–1）：打 milk 時「Milk Standard」比「Lime Milkshake Fresh Milk」緊。只算同一個字（單複數一樣），milk 不算對到 milkshake。 */
export function tightness(query: string[], name: string[]): number {
  if (!name.length) return 0
  const q = new Set(query.map(sing))
  return name.filter((w) => q.has(sing(w))).length / name.length
}

/** 分類第二、三層的字裡有幾成是打的字，取大的（fridge-deli-and-eggs/milk/fresh-milk 對 milk = 1；pantry/canned-foods-and-packets/coconut-cream-and-milk = 1/3） */
export function catTightness(query: string[], categoryId: string | null): number {
  const levels = (categoryId ?? '').split('/').slice(1, 3)
  return Math.max(0, ...levels.map((slug) => tightness(query, slug.split('-').filter((w) => w.length > 1 && w !== 'and'))))
}

/** 有中日韓字：超市網站只有英文，這種只查我們自己的資料（products.family_name_zh） */
export const isCjk = (text: string) => /[぀-ヿ㐀-鿿豈-﫿가-힯]/.test(text)

/** 自家牌（去別家網站搜要拿掉：在 New World 搜 woolworths milk 只會搜不到）。多 pams finest，同後端 SEARCH_BRAND_PHRASES。 */
const SEARCH_BRANDS = /\b(the odd bunch|odd bunch|signature range|pams finest|homebrand|gilmours|essentials|countdown|woolworths|select|macro|pams|value)\b/gi

/** 送去超市網站搜的字：去自家牌、空白收成一個、最多 60 字；去完什麼都不剩就用原本的字。其他照打的（free range 這種形容要留著）。 */
export function remoteTerm(text: string): string {
  const raw = text.replace(/\s+/g, ' ').trim()
  const cut = raw.replace(SEARCH_BRANDS, ' ').replace(/\s+/g, ' ').trim()
  return (cut.length >= 2 ? cut : raw).slice(0, 60).trim()
}

/** 拿去 ilike 的字不能帶 LIKE 萬用字元和 PostgREST 的保留符號 */
export const likeSafe = (w: string) => w.replace(/[%_*,()\\"]/g, '')

/** 候選的一列 → ProductThumb / displayName 用的 Special 形狀 */
export function candSpecial(r: CandRow): Special {
  return {
    store_id: r.store_id, product_id: r.product_id, product_key: r.key, family_key: null, family_name_en: null, family_name_zh: null,
    name: r.name, brand: r.brand, size: r.size, price: r.price ?? 0, price_unit: r.price_unit ?? 'each', was_price: null, unit_price: null,
    unit_price_unit: null, multi_buy: null, promo_type: null, club_only: false, category_id: r.category_id, image_url: r.image_url, product_url: null,
  }
}
