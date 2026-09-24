import { computed, ref, watch } from 'vue'
import { readCache, writeCache } from '../lib/cache'
import { costFor, rankPrice } from '../lib/compare'
import { estimate, needed, packBigger, type Estimate, type Need } from '../lib/size'
import type { Offer, Special, Store, StorePrice } from '../lib/types'
import { useSpecials } from './useSpecials'
import { useStorePrices } from './useStorePrices'
import { useCatalog, type Sub } from './useCatalog'

export interface ListItem {
  id: string
  /** null for free-text items that never matched a special */
  key: string | null
  name: string
  qty: number
  checked: boolean
  /** 沒特價的自由項，使用者自己填的價格（選填）；算進「最省」總價，標「自己填的」 */
  price?: number | null
}

/** 最省模式的一列：offer = 特價；shelf = 後端查到的現價（多半是原價，也可能是我們沒抓到的促銷）。兩者取一。 */
export interface SplitLine { item: ListItem; offer?: Offer; shelf?: StorePrice; total: number }
export interface SplitBucket {
  store: Store
  lines: SplitLine[]
  subtotal: number
}

/**
 * 一站裡一家店的一項（一站 v2，2026-09-24）。畫面分組：
 *  有 = special（這家特價）/ own（自己填的價）/ shelf（後端查到的現價）/ sub（替代品，估算，算進總價）
 *  沒有 = none（這家沒賣或名字配不到，而且也找不到替代品）
 *  不確定 = needCount（有替代品但單位對不上、猜不到個數）/ pending（查詢中）/ review（找到類似的待確認）/ unknown（查不到價格）/ free（自由輸入沒配對）
 */
export type OsState = 'special' | 'own' | 'shelf' | 'sub' | 'needCount' | 'none' | 'review' | 'pending' | 'unknown' | 'free'
export interface OsLine {
  item: ListItem
  state: OsState
  special: Special | null
  total: number
  own?: boolean
  shelf?: StorePrice
  /** 即時查價的狀態（有替代品時也照記，拿來決定要不要再去問）：這家沒賣 / 正在問 / 用名字配過沒配上（none 找不到、review 待人工確認） */
  notSold?: boolean
  pending?: boolean
  nameState?: 'none' | 'review'
  /** 替代品（這家沒有同一款時，同一種食材裡每單位最便宜的） */
  sub?: Sub
  est?: Estimate
  /** 單位對不上時要買幾個替代品（使用者填的，或從品名猜的） */
  count?: number
  /** 價格是估的（替代品），總價前面要加「約」 */
  estimated?: boolean
  /** 實際要買的一包比需要量大 → AI 食譜「剩下的做成明天的菜」提示 */
  bigPack?: boolean
}
export interface OneStopCard {
  store: Store
  /** 「有」的項數（含替代品） */
  known: number
  /** 其中幾樣是替代品 */
  subs: number
  /** 不確定的項數（查詢中、待確認、查不到、自由輸入、要填數量） */
  missing: number
  /** 沒有同一款、也沒替代品 */
  notSold: number
  total: number
  /** 正在即時問的項數（有替代品的也算） */
  pending: number
  /** 有替代品或不確定的 → 總價前面加「約」 */
  approx: boolean
  lines: OsLine[]
}

const items = ref<ListItem[]>(readCache<ListItem[]>('list') ?? [])
watch(items, (v) => writeCache('list', v), { deep: true })

const { groups, activeStores } = useSpecials()
const storePrices = useStorePrices()
const catalog = useCatalog()
/** 清單 key × 你的店 → 抓後端查到的現價（登入者才會有，訪客回空） */
watch(
  () => [activeStores.value.map((d) => d.store.id), items.value.map((i) => i.key).filter((k): k is string => !!k)] as const,
  ([stores, keys]) => void storePrices.load([...stores], [...new Set(keys)]),
  { immediate: true },
)

/** 替代品候選（useCatalog）：清單頁打開過才開始查（wantSubs），之後店或清單變了只補缺的。 */
const subsWanted = ref(false)
watch(
  () => (subsWanted.value ? activeStores.value.map((d) => `${d.store.id}@${d.week}@${d.fetchedAt}`).join(',') + '#' + [...new Set(items.value.map((i) => i.key))].join(',') : ''),
  (sig) => {
    if (!sig) return
    const seen = new Set<string>()
    const list = items.value.filter((i): i is ListItem & { key: string } => !!i.key && !seen.has(i.key) && !!seen.add(i.key))
    void catalog.load(activeStores.value, list.map((i) => ({ key: i.key, name: i.name, brand: groups.value.get(i.key)?.best.special.brand ?? null })))
  },
  { immediate: true },
)
function wantSubs(): void {
  subsWanted.value = true
}
/** 單位對不上時使用者填的「買幾個替代品」。不記住：只放記憶體，重新整理就沒了（規格 §4.2）。key = 店|清單項|替代品編號；0 = 清空了。 */
const subCounts = ref<Map<string, number>>(new Map())
const countKey = (storeId: string, itemId: string, productId: string) => `${storeId}|${itemId}|${productId}`
function setSubCount(storeId: string, itemId: string, productId: string, n: number): void {
  const next = new Map(subCounts.value)
  next.set(countKey(storeId, itemId, productId), Number.isFinite(n) && n > 0 ? Math.min(99, Math.round(n * 100) / 100) : 0)
  subCounts.value = next
}
/** 清單一項需要多少：參考商品 = 它這週的特價，沒有就 catalog 裡同一款，再沒有就 products 的名字 */
function needOf(item: ListItem): Need {
  const ref = item.key ? groups.value.get(item.key)?.best.special ?? catalog.refOf(item.key) : null
  return needed(item, ref)
}

/** uuid：登入後清單會存進資料庫（list_items.id）。 */
function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`
}

function add(key: string, name: string): void {
  const found = items.value.find((i) => i.key === key)
  if (found) {
    found.qty += 1
    return
  }
  items.value = [...items.value, { id: newId(), key, name, qty: 1, checked: false }]
}

function addFreeText(text: string): void {
  const name = text.trim()
  if (!name) return
  items.value = [...items.value, { id: newId(), key: null, name, qty: 1, checked: false }]
}

/** 自由輸入配對到商品後（規格 §4.3）：這一項從 key=null 變成一般商品，之後照一般商品比價。
 *  清單裡已經有同一個 key → 件數併過去、這項刪掉。自己填的價格清掉（那是給沒配對的項用的，留著會蓋過真的價格）。 */
function assignKey(id: string, key: string, name: string): void {
  const i = items.value.find((x) => x.id === id)
  if (!i) return
  const dup = items.value.find((x) => x.key === key && x.id !== id)
  if (dup) {
    dup.qty += i.qty
    remove(id)
    return
  }
  i.key = key
  i.name = name.trim() || i.name
  i.price = null
}

function remove(id: string): void {
  items.value = items.value.filter((i) => i.id !== id)
}

/** 一鍵清空。登入的話 useSync 會跟著把帳號裡的清單刪光。 */
function clear(): void {
  items.value = []
}

function setQty(id: string, qty: number): void {
  const i = items.value.find((x) => x.id === id)
  if (!i) return
  if (qty <= 0) return remove(id)
  i.qty = qty
}

function rename(id: string, name: string): void {
  const i = items.value.find((x) => x.id === id)
  const n = name.trim()
  if (i && n) i.name = n
}
function setPrice(id: string, price: number | null): void {
  const i = items.value.find((x) => x.id === id)
  if (i) i.price = price != null && Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null
}

function toggle(id: string): void {
  const i = items.value.find((x) => x.id === id)
  if (i) i.checked = !i.checked
}

function has(key: string): boolean {
  return items.value.some((i) => i.key === key)
}

/** Every item goes to whichever of your stores is cheapest for it. 沒配對到的放最後一張「其他」卡，自己填了價格的算進總價。 */
const split = computed<{ buckets: SplitBucket[]; unmatched: ListItem[]; total: number; othersTotal: number }>(() => {
  const map = new Map<string, SplitBucket>()
  const unmatched: ListItem[] = []
  let total = 0
  let othersTotal = 0
  for (const item of items.value) {
    // 最便宜的來源：特價（groups）或後端查到的現價（store_prices，2026-09-11 起也算進最省）
    const g = item.key ? groups.value.get(item.key) : undefined
    // 挑店用單件價（rankPrice）；算總價用 costFor——買到湊件數才算湊件價（2026-09-15）
    let best: { store: Store; offer?: Offer; shelf?: StorePrice; price: number; total: number } | null = g
      ? { store: g.best.store, offer: g.best, price: rankPrice(g.best.special), total: costFor(g.best.special, item.qty) }
      : null
    if (item.key) {
      for (const d of activeStores.value) {
        const sp = storePrices.priceAt(d.store.id, item.key)
        if (!sp?.available || sp.price == null) continue
        const p = rankPrice({ price: sp.price })
        if (!best || p < best.price) best = { store: d.store, shelf: sp, price: p, total: costFor({ price: sp.price, multi_buy: sp.multi_buy, price_unit: sp.price_unit, name: sp.name }, item.qty) }
      }
    }
    if (!best) {
      unmatched.push(item)
      if (item.price) othersTotal += item.price * item.qty
      continue
    }
    const line: SplitLine = { item, offer: best.offer, shelf: best.offer ? undefined : best.shelf, total: best.total }
    total += line.total
    const b = map.get(best.store.id)
    if (b) {
      b.lines.push(line)
      b.subtotal += line.total
    } else {
      map.set(best.store.id, { store: best.store, lines: [line], subtotal: line.total })
    }
  }
  return {
    buckets: [...map.values()].sort((a, b) => b.subtotal - a.subtotal),
    unmatched,
    total: total + othersTotal,
    othersTotal,
  }
})

/**
 * One card per store. We only hold specials, so an item a store has no special for is never "more expensive".
 * 一站 v2（2026-09-24）：特價 → 自己填的 → 查到的現價 → 替代品（同一種食材，估算價算進總價）→ 沒有／不確定。
 */
const HAVE: ReadonlySet<OsState> = new Set(['special', 'own', 'shelf', 'sub'])
const RANK: Record<OsState, number> = { special: 0, own: 1, shelf: 2, sub: 3, needCount: 4, pending: 5, review: 6, unknown: 7, free: 8, none: 9 }
const oneStop = computed<OneStopCard[]>(() => {
  const cards: OneStopCard[] = []
  for (const d of activeStores.value) {
    const lines: OsLine[] = []
    for (const item of items.value) {
      const g = item.key ? groups.value.get(item.key) : undefined
      const offer = g?.offers.find((o) => o.store.id === d.store.id)
      if (offer) {
        lines.push({ item, state: 'special', special: offer.special, total: costFor(offer.special, item.qty), bigPack: packBigger(needOf(item), offer.special) })
        continue
      }
      if (item.price) {
        // 自己填的價格：每家都算已知
        lines.push({ item, state: 'own', special: null, total: item.price * item.qty, own: true })
        continue
      }
      // 沒特價：看後端有沒有查到這家店的現價（Phase 2b §9b）
      const sp = storePrices.priceAt(d.store.id, item.key)
      if (sp?.available && sp.price != null) {
        lines.push({ item, state: 'shelf', special: null, total: costFor({ price: sp.price, multi_buy: sp.multi_buy, price_unit: sp.price_unit, name: sp.name }, item.qty), shelf: sp })
        continue
      }
      const notSold = !!sp && !sp.available
      const pending = !notSold && storePrices.isPending(d.store.id, item.key)
      const nameState = notSold || pending ? undefined : storePrices.nameStateAt(d.store.id, item.key)
      const base = { item, special: null, total: 0, notSold: notSold || undefined, pending: pending || undefined, nameState }
      // 沒價格（不管是沒賣、找不到、待確認、還在問）→ 找這家的替代品
      const need = needOf(item)
      const sub = item.key ? catalog.subFor(d.store.id, item.key, need) : null
      if (sub) {
        const est = estimate(need, sub, item)
        if ('cost' in est) {
          lines.push({ ...base, state: 'sub', sub, est, total: est.cost, estimated: true, bigPack: packBigger(need, sub) })
          continue
        }
        // 單位對不上（要 1kg 酪梨、這家一顆一顆賣）：使用者填的個數，沒填就用從品名猜的
        const n = subCounts.value.get(countKey(d.store.id, item.id, sub.product_id)) ?? est.guess ?? 0
        if (n > 0) lines.push({ ...base, state: 'sub', sub, est, count: n, total: Math.round(n * sub.price * 100) / 100, estimated: true })
        else lines.push({ ...base, state: 'needCount', sub, est })
        continue
      }
      const state: OsState = !item.key ? 'free' : notSold || nameState === 'none' ? 'none' : nameState === 'review' ? 'review' : pending ? 'pending' : 'unknown'
      lines.push({ ...base, state })
    }
    lines.sort((a, b) => RANK[a.state] - RANK[b.state])
    const have = lines.filter((l) => HAVE.has(l.state))
    const subs = have.filter((l) => l.state === 'sub').length
    const none = lines.filter((l) => l.state === 'none').length
    const missing = lines.length - have.length - none
    cards.push({
      store: d.store,
      known: have.length,
      subs,
      missing,
      notSold: none,
      total: have.reduce((n, l) => n + l.total, 0),
      pending: lines.filter((l) => l.pending).length,
      approx: subs > 0 || missing > 0,
      lines,
    })
  }
  return cards.sort((a, b) => b.known - a.known || a.total - b.total)
})

/** 一站裡「沒價格、也問不了的還沒判定」的（店, key）→ 切到一站時送去即時問（useStorePrices.request 會自己過濾沒編號、問過的）。 */
const oneStopMissing = computed<Array<{ storeId: string; key: string }>>(() => {
  const out: Array<{ storeId: string; key: string }> = []
  for (const c of oneStop.value) for (const l of c.lines) if (l.item.key && !l.special && !l.own && !l.shelf && !l.notSold && !l.pending && !l.nameState) out.push({ storeId: c.store.id, key: l.item.key })
  return out
})

const oneStopFrom = computed(() => (oneStop.value.length ? oneStop.value[0].total : 0))

export function useList() {
  return {
    items,
    add,
    addFreeText,
    assignKey,
    remove,
    clear,
    setQty,
    rename,
    setPrice,
    toggle,
    has,
    split,
    oneStop,
    oneStopFrom,
    oneStopMissing,
    requestPrices: storePrices.request,
    priceQueueAhead: storePrices.queueAhead,
    wantSubs,
    setSubCount,
  }
}
