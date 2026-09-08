import { computed, ref, shallowRef, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { readCache, writeCache } from '../lib/cache'
import { nzMonday, weeksBack } from '../lib/week'
import { buildGroup, discountDepth, toOffer } from '../lib/compare'
import { catLevel, isFood, isFresh } from '../lib/format'
import type { Group, MultiBuy, Offer, Special, Store } from '../lib/types'
import { useStores } from './useStores'
import { useSettings } from './useSettings'

const COL_LIST = [
  'store_id',
  'product_id',
  'product_key',
  'name',
  'brand',
  'size',
  'price',
  'price_unit',
  'was_price',
  'unit_price',
  'unit_price_unit',
  'multi_buy',
  'promo_type',
  'club_only',
  'category_id',
  'image_url',
  'product_url',
] as const
const COLS = COL_LIST.join(',')
/** 同類可比：順便帶 products.family_key。欄位還沒加的話 PostgREST 會報錯 → 退回 COLS（family_key 全 null）。 */
const COLS_FAMILY = COLS + ',products(family_key,family_name_en,family_name_zh)'
const PACK_COLS = [...COL_LIST, 'family_key', 'family_name_en', 'family_name_zh'] as const
const PAGE = 1000

// A week of specials is ~2,500 rows per store. Storing them as objects wastes about a third of
// localStorage on repeated key names, so the cache holds rows as plain value arrays.
interface Packed {
  week: string | null
  cols: string[]
  rows: unknown[][]
}
function pack(week: string | null, rows: Special[]): Packed {
  return {
    week,
    cols: [...PACK_COLS],
    rows: rows.map((r) => PACK_COLS.map((c) => (r as unknown as Record<string, unknown>)[c])),
  }
}
function unpack(p: Packed): Special[] {
  return p.rows.map((vals) => {
    const o: Record<string, unknown> = {}
    p.cols.forEach((c, i) => (o[c] = vals[i]))
    return o as unknown as Special
  })
}

export interface StoreData {
  store: Store
  week: string | null
  stale: boolean
  rows: Special[]
  error: string | null
}

const { selectedStores } = useStores()
const { foodOnly } = useSettings()

const byStore = shallowRef<Record<string, StoreData>>({})
const loading = ref(false)
const thisWeek = ref(nzMonday())

async function fetchStore(store: Store): Promise<StoreData> {
  const cacheKey = `sp:${store.id}:${thisWeek.value}:f5`   // :f4 = 同類 key 改成不帶分類之後；:f5 = Woolworths 分類改第三層對照（2026-09-08 回填）
  const cached = readCache<Packed>(cacheKey)
  if (cached?.cols) {
    return {
      store,
      week: cached.week,
      stale: !!cached.week && cached.week !== thisWeek.value,
      rows: unpack(cached),
      error: null,
    }
  }
  // This week if the store has it, otherwise that store's most recent week.
  const head = await supabase
    .from('specials')
    .select('week_start')
    .eq('store_id', store.id)
    .lte('week_start', thisWeek.value)
    .order('week_start', { ascending: false })
    .limit(1)
  if (head.error) return { store, week: null, stale: false, rows: [], error: head.error.message }
  const week = (head.data?.[0]?.week_start as string | undefined) ?? null
  if (!week) return { store, week: null, stale: false, rows: [], error: null }

  const rows: Special[] = []
  let cols: string = COLS_FAMILY
  for (let off = 0; ; off += PAGE) {
    let page = await supabase
      .from('specials')
      .select(cols)
      .eq('store_id', store.id)
      .eq('week_start', week)
      .range(off, off + PAGE - 1)
    if (page.error && cols === COLS_FAMILY) {
      cols = COLS
      page = await supabase.from('specials').select(cols).eq('store_id', store.id).eq('week_start', week).range(off, off + PAGE - 1)
    }
    if (page.error) return { store, week, stale: week !== thisWeek.value, rows, error: page.error.message }
    const got = (page.data ?? []) as unknown as Array<Special & { products?: { family_key: string | null; family_name_en: string | null; family_name_zh: string | null } | null }>
    for (const r of got) {
      const { products, ...rest } = r
      rows.push({ ...rest, family_key: products?.family_key ?? null, family_name_en: products?.family_name_en ?? null, family_name_zh: products?.family_name_zh ?? null } as Special)
    }
    if (got.length < PAGE) break
  }
  writeCache(cacheKey, pack(week, rows), 'sp:')
  return { store, week, stale: week !== thisWeek.value, rows, error: null }
}

async function load(): Promise<void> {
  const stores = selectedStores.value
  const next: Record<string, StoreData> = {}
  for (const s of stores) {
    const have = byStore.value[s.id]
    if (have) next[s.id] = have
  }
  byStore.value = next
  const missing = stores.filter((s) => !next[s.id])
  if (!missing.length) return
  loading.value = true
  const results = await Promise.all(missing.map(fetchStore))
  const merged = { ...byStore.value }
  for (const r of results) merged[r.store.id] = r
  byStore.value = merged
  loading.value = false
}

watch(selectedStores, () => void load(), { deep: true })

/** Stores that actually returned rows — the only ones that win a ✓ or count in a total. */
const activeStores = computed<StoreData[]>(() =>
  selectedStores.value
    .map((s) => byStore.value[s.id])
    .filter((d): d is StoreData => !!d && d.rows.length > 0),
)
const emptyStores = computed<StoreData[]>(() =>
  selectedStores.value
    .map((s) => byStore.value[s.id])
    .filter((d): d is StoreData => !!d && d.rows.length === 0),
)
const staleStores = computed<StoreData[]>(() => activeStores.value.filter((d) => d.stale))

const totalSpecials = computed(() =>
  activeStores.value.reduce((n, d) => n + d.rows.length, 0),
)

/** Every row of every active store, food-filtered. */
const rows = computed<Array<{ store: Store; special: Special }>>(() => {
  const out: Array<{ store: Store; special: Special }> = []
  for (const d of activeStores.value) {
    for (const s of d.rows) {
      if (foodOnly.value && !isFood(s.category_id)) continue
      out.push({ store: d.store, special: s })
    }
  }
  return out
})

/** product_key → the offers for it across active stores. */
const groups = computed<Map<string, Group>>(() => {
  const buckets = new Map<string, Offer[]>()
  for (const { store, special } of rows.value) {
    if (!special.product_key) continue
    const list = buckets.get(special.product_key)
    if (list) list.push(toOffer(store, special))
    else buckets.set(special.product_key, [toOffer(store, special)])
  }
  const out = new Map<string, Group>()
  for (const [key, offers] of buckets) out.set(key, buildGroup(key, offers))
  return out
})

/** family_key → 同類的 offers（跨店、跨商品）。同類可比用單價比（§8）。 */
const families = computed<Map<string, Offer[]>>(() => {
  const out = new Map<string, Offer[]>()
  for (const g of groups.value.values()) {
    for (const o of g.offers) {
      const f = o.special.family_key
      if (!f) continue
      const list = out.get(f)
      if (list) list.push(o)
      else out.set(f, [o])
    }
  }
  return out
})
/** 同類但不是同一樣的 offers，單價低的在前（沒單價的排後面）。 */
function familyOffers(special: Special, limit = 8): Offer[] {
  if (!special.family_key) return []
  // 同品牌的口味在商品頁另外一排（variantsOf），這裡只列別的牌子
  const list = (families.value.get(special.family_key) ?? []).filter((o) => o.special.product_key !== special.product_key && (!norm(special.brand) || norm(o.special.brand) !== norm(special.brand)))
  return list
    .sort((a, b) => {
      if (a.unit != null && b.unit != null && a.unitUnit === b.unitUnit) return a.unit - b.unit
      if (a.unit != null && b.unit == null) return -1
      if (a.unit == null && b.unit != null) return 1
      return a.deal - b.deal
    })
    .slice(0, limit)
}
/** 同品牌、同類、不同口味／規格的其他商品（Moccona 三種咖啡）。沒品牌就沒有。 */
const norm = (b: string | null | undefined) => (b ?? '').trim().toLowerCase()
function variantsOf(special: Special): Group[] {
  if (!special.family_key || !norm(special.brand)) return []
  const seen = new Set<string>()
  const out: Group[] = []
  for (const o of families.value.get(special.family_key) ?? []) {
    const k = o.special.product_key
    if (!k || k === special.product_key || seen.has(k) || norm(o.special.brand) !== norm(special.brand)) continue
    const g = groups.value.get(k)
    if (!g) continue
    seen.add(k)
    out.push(g)
  }
  return out.sort((a, b) => a.best.special.name.localeCompare(b.best.special.name))
}
/** 這週最划算，但「同品牌 + 同第二層分類」只留最划算的一個（Woolworths 起司、Moccona 咖啡、Angel Bay 漢堡排各一格），並附「還有幾款」。 */
const topDeduped = computed<Array<{ g: Group; variants: number }>>(() => {
  const keyOf = (g: Group) => { const sp = g.best.special; const b = norm(sp.brand); const c = catLevel(sp.category_id, 2); return b && c ? `${b}|${c}` : g.key }
  const count = new Map<string, number>()
  for (const g of top.value) { const k = keyOf(g); count.set(k, (count.get(k) ?? 0) + 1) }
  const seen = new Set<string>()
  const out: Array<{ g: Group; variants: number }> = []
  for (const g of top.value) {
    const k = keyOf(g)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ g, variants: count.get(k) ?? 1 })
  }
  return out
})

/** 某家店沒有這樣東西時，那家店最便宜的同類替代品（清單 One stop、搜尋用）。 */
function familyAlt(g: Group | undefined, storeId: string): Offer | null {
  if (!g) return null
  return familyOffers(g.best.special, 50).find((o) => o.store.id === storeId) ?? null
}

const comparable = computed<Group[]>(() =>
  [...groups.value.values()].filter((g) => g.offers.length >= 2),
)

/** Top deals: same item at 2+ stores, biggest price gap first, then deepest discount. */
const top = computed<Group[]>(() =>
  [...comparable.value].sort((a, b) => {
    const d = (b.payGap ?? 0) - (a.payGap ?? 0)
    if (Math.abs(d) > 0.0001) return d
    return discountDepth(b.best.special) - discountDepth(a.best.special)
  }),
)

export interface WhereToGo {
  cat: string
  store: Store
  wins: number
  total: number
}
/**
 * §10 首頁「這週去哪家」：兩家以上都有的商品，按第一層分類算哪家最常最便宜。
 * 少於 5 樣、或贏家不到一半的分類不講（不然是在瞎猜）。
 */
const whereToGo = computed<WhereToGo[]>(() => {
  const tally = new Map<string, { total: number; wins: Map<string, number> }>()
  for (const g of comparable.value) {
    const c1 = catLevel(g.best.special.category_id, 1)
    if (!c1) continue
    let t = tally.get(c1)
    if (!t) tally.set(c1, (t = { total: 0, wins: new Map() }))
    t.total += 1
    t.wins.set(g.best.store.id, (t.wins.get(g.best.store.id) ?? 0) + 1)
  }
  const out: WhereToGo[] = []
  for (const [cat, t] of tally) {
    if (t.total < 5) continue
    const [storeId, wins] = [...t.wins.entries()].sort((a, b) => b[1] - a[1])[0]
    const store = activeStores.value.find((d) => d.store.id === storeId)?.store
    if (!store || wins * 2 < t.total) continue
    out.push({ cat, store, wins, total: t.total })
  }
  return out.sort((a, b) => b.total - a.total).slice(0, 4)
})

export interface HistoryRow {
  store_id: string
  week_start: string
  price: number
  multi_buy: MultiBuy | null
}
const historyCache = new Map<string, Promise<HistoryRow[]>>()
/** Phase 4：近 8 週這個商品在你選的店的價格。同店同週可能多筆（不同包裝），畫面上取最便宜。 */
function history(key: string): Promise<HistoryRow[]> {
  const ids = selectedStores.value.map((s) => s.id)
  const cacheKey = `${key}|${ids.join(',')}|${thisWeek.value}`
  const cached = historyCache.get(cacheKey)
  if (cached) return cached
  const p = (async () => {
    const { data } = await supabase
      .from('specials')
      .select('store_id,week_start,price,multi_buy')
      .eq('product_key', key)
      .in('store_id', ids)
      .in('week_start', weeksBack(8, thisWeek.value))
    return (data ?? []) as HistoryRow[]
  })()
  historyCache.set(cacheKey, p)
  return p
}

/** Half price and 40%+ off. Needs a was-price, so PAK'nSAVE never appears. */
const deepDiscounts = computed(() =>
  rows.value
    .filter(({ special }) => discountDepth(special) >= 0.4)
    .sort((a, b) => discountDepth(b.special) - discountDepth(a.special)),
)

/** Fresh produce and meat, ranked by $/kg. */
const freshByKg = computed(() =>
  rows.value
    .filter(
      ({ special }) =>
        isFresh(special.category_id) &&
        special.unit_price != null &&
        (special.unit_price_unit ?? '').toLowerCase() === 'kg',
    )
    .sort((a, b) => (a.special.unit_price as number) - (b.special.unit_price as number)),
)

const biggestSaving = computed(() => {
  let best = 0
  for (const { special } of rows.value) {
    if (special.store_id.startsWith('paknsave:')) continue
    if (special.was_price && special.was_price > special.price) {
      best = Math.max(best, special.was_price - special.price)
    }
  }
  return best
})

/** Level-2 categories present in the data, by row count. */
const level2 = computed<Array<{ id: string; n: number }>>(() => {
  const counts = new Map<string, number>()
  for (const { special } of rows.value) {
    const id = catLevel(special.category_id, 2)
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, n]) => ({ id, n }))
    .sort((a, b) => b.n - a.n)
})

function groupFor(key: string): Group | undefined {
  return groups.value.get(key)
}

export function useSpecials() {
  return {
    byStore,
    loading,
    thisWeek,
    activeStores,
    emptyStores,
    staleStores,
    totalSpecials,
    rows,
    groups,
    families,
    familyOffers,
    familyAlt,
    comparable,
    top,
    topDeduped,
    variantsOf,
    deepDiscounts,
    freshByKg,
    biggestSaving,
    level2,
    whereToGo,
    history,
    groupFor,
    load,
  }
}
