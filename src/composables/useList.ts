import { computed, ref, watch } from 'vue'
import { readCache, writeCache } from '../lib/cache'
import { dealPrice } from '../lib/compare'
import type { Offer, Special, Store } from '../lib/types'
import { useSpecials } from './useSpecials'

export interface ListItem {
  id: string
  /** null for free-text items that never matched a special */
  key: string | null
  name: string
  qty: number
  checked: boolean
}

export interface SplitBucket {
  store: Store
  lines: Array<{ item: ListItem; offer: Offer; total: number }>
  subtotal: number
}

export interface OneStopCard {
  store: Store
  known: number
  missing: number
  total: number
  lines: Array<{ item: ListItem; special: Special | null; total: number }>
}

const items = ref<ListItem[]>(readCache<ListItem[]>('list') ?? [])
watch(items, (v) => writeCache('list', v), { deep: true })

/** 「用清單做菜」的挑食材模式。跟 checked（在店裡買到了）是兩回事，所以另存一份，也不進 localStorage。 */
const picking = ref(false)
const picked = ref<Set<string>>(new Set())
function startPicking(): void {
  picked.value = new Set()
  picking.value = true
}
function stopPicking(): void {
  picking.value = false
  picked.value = new Set()
}
function togglePick(id: string): void {
  const next = new Set(picked.value)
  next.has(id) ? next.delete(id) : next.add(id)
  picked.value = next
}
/** 選到的項目，順序照清單。送去 AI 食譜頁的就是這些。 */
const pickedItems = computed(() => items.value.filter((i) => picked.value.has(i.id)))

const { groups, activeStores } = useSpecials()

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

function setQty(id: string, qty: number): void {
  const i = items.value.find((x) => x.id === id)
  if (!i) return
  if (qty <= 0) return remove(id)
  i.qty = qty
}

function toggle(id: string): void {
  const i = items.value.find((x) => x.id === id)
  if (i) i.checked = !i.checked
}

function has(key: string): boolean {
  return items.value.some((i) => i.key === key)
}

/** Every item goes to whichever of your stores is cheapest for it. */
const split = computed<{ buckets: SplitBucket[]; unmatched: ListItem[]; total: number }>(() => {
  const map = new Map<string, SplitBucket>()
  const unmatched: ListItem[] = []
  let total = 0
  for (const item of items.value) {
    const g = item.key ? groups.value.get(item.key) : undefined
    if (!g) {
      unmatched.push(item)
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
    total,
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
    let total = 0
    for (const item of items.value) {
      const g = item.key ? groups.value.get(item.key) : undefined
      const offer = g?.offers.find((o) => o.store.id === d.store.id)
      if (offer) {
        known += 1
        const t = dealPrice(offer.special) * item.qty
        total += t
        lines.push({ item, special: offer.special, total: t })
      } else {
        missing += 1
        lines.push({ item, special: null, total: 0 })
      }
    }
    cards.push({ store: d.store, known, missing, total, lines })
  }
  return cards.sort((a, b) => b.known - a.known || a.total - b.total)
})

const oneStopFrom = computed(() => (oneStop.value.length ? oneStop.value[0].total : 0))

export function useList() {
  return {
    items,
    picking,
    picked,
    pickedItems,
    startPicking,
    stopPicking,
    togglePick,
    add,
    addFreeText,
    remove,
    setQty,
    toggle,
    has,
    split,
    oneStop,
    oneStopFrom,
  }
}
