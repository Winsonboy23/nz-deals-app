import { computed, ref, shallowRef, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { readCache, writeCache } from '../lib/cache'
import { nzMonday } from '../lib/week'
import { buildGroup, discountDepth, toOffer } from '../lib/compare'
import { catLevel, isFood, isFresh } from '../lib/format'
import type { Group, Offer, Special, Store } from '../lib/types'
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
    cols: [...COL_LIST],
    rows: rows.map((r) => COL_LIST.map((c) => (r as unknown as Record<string, unknown>)[c])),
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
  const cacheKey = `sp:${store.id}:${thisWeek.value}`
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
  for (let off = 0; ; off += PAGE) {
    const page = await supabase
      .from('specials')
      .select(COLS)
      .eq('store_id', store.id)
      .eq('week_start', week)
      .range(off, off + PAGE - 1)
    if (page.error) return { store, week, stale: week !== thisWeek.value, rows, error: page.error.message }
    const got = (page.data ?? []) as unknown as Special[]
    rows.push(...got)
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
    comparable,
    top,
    deepDiscounts,
    freshByKg,
    biggestSaving,
    level2,
    groupFor,
    load,
  }
}
