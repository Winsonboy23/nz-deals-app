import { computed, ref, watch } from 'vue'
import { readCache, writeCache } from '../lib/cache'
import { dealPrice } from '../lib/compare'
import type { Offer, Special, Store, StorePrice } from '../lib/types'
import { useSpecials } from './useSpecials'
import { useStorePrices } from './useStorePrices'

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

export interface SplitBucket {
  store: Store
  lines: Array<{ item: ListItem; offer: Offer; total: number }>
  subtotal: number
}

export interface OneStopCard {
  store: Store
  known: number
  /** 價格未知（沒特價、沒查到現價、也沒自己填） */
  missing: number
  /** 這家店沒賣（後端查價時接口沒回） */
  notSold: number
  total: number
  /** 正在即時問的項數 */
  pending: number
  /** own = 價格是使用者自己填的；shelf = 後端查到的現價（多半是原價，也可能是我們沒抓到的促銷）；pending = 正在問 */
  lines: Array<{ item: ListItem; special: Special | null; total: number; own?: boolean; shelf?: StorePrice; notSold?: boolean; pending?: boolean }>
}

const items = ref<ListItem[]>(readCache<ListItem[]>('list') ?? [])
watch(items, (v) => writeCache('list', v), { deep: true })

const { groups, activeStores } = useSpecials()
const storePrices = useStorePrices()
/** 清單 key × 你的店 → 抓後端查到的現價（登入者才會有，訪客回空） */
watch(
  () => [activeStores.value.map((d) => d.store.id), items.value.map((i) => i.key).filter((k): k is string => !!k)] as const,
  ([stores, keys]) => void storePrices.load([...stores], [...new Set(keys)]),
  { immediate: true },
)

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
    const g = item.key ? groups.value.get(item.key) : undefined
    if (!g) {
      unmatched.push(item)
      if (item.price) othersTotal += item.price * item.qty
      continue
    }
    const offer = g.best
    const line = { item, offer, total: dealPrice(offer.special) * item.qty }
    total += line.total
    const b = map.get(offer.store.id)
    if (b) {
      b.lines.push(line)
      b.subtotal += line.total
    } else {
      map.set(offer.store.id, { store: offer.store, lines: [line], subtotal: line.total })
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
 * One card per store. We only hold specials, so an item a store has no special for is
 * "no special this week · price unknown" — never "more expensive".
 */
const oneStop = computed<OneStopCard[]>(() => {
  const cards: OneStopCard[] = []
  for (const d of activeStores.value) {
    const lines: OneStopCard['lines'] = []
    let known = 0
    let missing = 0
    let notSold = 0
    let pendingN = 0
    let total = 0
    for (const item of items.value) {
      const g = item.key ? groups.value.get(item.key) : undefined
      const offer = g?.offers.find((o) => o.store.id === d.store.id)
      if (offer) {
        known += 1
        const t = dealPrice(offer.special) * item.qty
        total += t
        lines.push({ item, special: offer.special, total: t })
      } else if (item.price) {
        // 自己填的價格：每家都算已知
        known += 1
        const t = item.price * item.qty
        total += t
        lines.push({ item, special: null, total: t, own: true })
      } else {
        // 沒特價：看後端週一有沒有查到這家店的現價（Phase 2b §9b）
        const sp = storePrices.priceAt(d.store.id, item.key)
        if (sp?.available && sp.price != null) {
          known += 1
          const t = (sp.multi_buy && sp.multi_buy.qty > 0 ? sp.multi_buy.total / sp.multi_buy.qty : sp.price) * item.qty
          total += t
          lines.push({ item, special: null, total: t, shelf: sp })
        } else if (sp && !sp.available) {
          notSold += 1
          lines.push({ item, special: null, total: 0, notSold: true })
        } else if (storePrices.isPending(d.store.id, item.key)) {
          pendingN += 1
          lines.push({ item, special: null, total: 0, pending: true })
        } else {
          missing += 1
          lines.push({ item, special: null, total: 0 })
        }
      }
    }
    // 有特價的在前、自己填的、查到現價的、正在問的、價格未知的、這家沒賣的墊底
    const rank = (l: OneStopCard['lines'][number]) => (l.special ? 0 : l.own ? 1 : l.shelf ? 2 : l.pending ? 3 : l.notSold ? 5 : 4)
    lines.sort((a, b) => rank(a) - rank(b))
    cards.push({ store: d.store, known, missing: missing + pendingN, notSold, pending: pendingN, total, lines })
  }
  return cards.sort((a, b) => b.known - a.known || a.total - b.total)
})

/** 一站裡「沒價格、也問不了的還沒判定」的（店, key）→ 切到一站時送去即時問（useStorePrices.request 會自己過濾沒編號、問過的）。 */
const oneStopMissing = computed<Array<{ storeId: string; key: string }>>(() => {
  const out: Array<{ storeId: string; key: string }> = []
  for (const c of oneStop.value) for (const l of c.lines) if (l.item.key && !l.special && !l.own && !l.shelf && !l.notSold && !l.pending && !storePrices.hasNoId(c.store.id, l.item.key)) out.push({ storeId: c.store.id, key: l.item.key })
  return out
})

const oneStopFrom = computed(() => (oneStop.value.length ? oneStop.value[0].total : 0))

export function useList() {
  return {
    items,
    add,
    addFreeText,
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
  }
}
