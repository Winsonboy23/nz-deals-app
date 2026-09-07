import { computed, ref, shallowRef } from 'vue'
import { supabase } from '../lib/supabase'
import { readCache, writeCache } from '../lib/cache'
import { haversineKm, islandOf } from '../lib/geo'
import type { Store } from '../lib/types'

export const MAX_STORES = 5

export interface RankedStore {
  store: Store
  km: number | null
  hasData: boolean
  island: 'NI' | 'SI' | null
  selected: boolean
}

/** 目前只開北島（南島還沒抓，2026-09-07）。南島開了把 'SI' 加回來就好。 */
const SHOW_ISLANDS = new Set<'NI' | 'SI'>(['NI'])
const onlyShown = (list: Store[]): Store[] =>
  list.filter((s) => {
    const i = islandOf(s.region)
    return !!i && SHOW_ISLANDS.has(i)
  })

const all = shallowRef<Store[]>(onlyShown(readCache<Store[]>('stores') ?? []))
const loading = ref(false)
const loaded = ref(all.value.length > 0)
const selectedIds = ref<string[]>(readCache<string[]>('selected') ?? [])
const coords = ref<{ lat: number; lng: number } | null>(readCache('coords'))
const query = ref('')
const locating = ref<'idle' | 'busy' | 'ok' | 'denied'>(coords.value ? 'ok' : 'idle')

async function loadStores(): Promise<void> {
  if (loading.value) return
  loading.value = true
  const { data, error } = await supabase
    .from('stores')
    .select('id,chain_id,store_id,name,region,lat,lng,online_shopping,last_fetched_at')
    .order('name')
  loading.value = false
  if (error || !data) return
  all.value = onlyShown(data as Store[])
  loaded.value = true
  writeCache('stores', data)
}

function locate(): Promise<void> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      locating.value = 'denied'
      return resolve()
    }
    locating.value = 'busy'
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coords.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        writeCache('coords', coords.value)
        locating.value = 'ok'
        resolve()
      },
      () => {
        locating.value = 'denied'
        resolve()
      },
      { timeout: 8000, maximumAge: 1000 * 60 * 30 },
    )
  })
}

function hasData(s: Store): boolean {
  return s.online_shopping !== false && !!s.last_fetched_at
}

/** Nearest first; stores with no coordinates are listed after every store with a distance. */
const ranked = computed<RankedStore[]>(() => {
  const q = query.value.trim().toLowerCase()
  const rows = all.value
    .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.region ?? '').toLowerCase() === q)
    .map((s) => ({
      store: s,
      km:
        coords.value && s.lat != null && s.lng != null
          ? haversineKm(coords.value, { lat: s.lat, lng: s.lng })
          : null,
      hasData: hasData(s),
      island: islandOf(s.region),
      selected: selectedIds.value.includes(s.id),
    }))
  rows.sort((a, b) => {
    if (a.km == null && b.km == null) return a.store.name.localeCompare(b.store.name)
    if (a.km == null) return 1
    if (b.km == null) return -1
    return a.km - b.km
  })
  return rows
})

const selectedStores = computed<Store[]>(() =>
  selectedIds.value
    .map((id) => all.value.find((s) => s.id === id))
    .filter((s): s is Store => !!s),
)

const islands = computed<Array<'NI' | 'SI'>>(() => {
  const set = new Set<'NI' | 'SI'>()
  for (const s of selectedStores.value) {
    const i = islandOf(s.region)
    if (i) set.add(i)
  }
  return [...set]
})

function persist(): void {
  writeCache('selected', selectedIds.value)
}

function toggle(id: string): void {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value = selectedIds.value.filter((x) => x !== id)
  else if (selectedIds.value.length < MAX_STORES) selectedIds.value = [...selectedIds.value, id]
  persist()
}

/** Pre-tick the nearest store of each chain that has data, up to 5. */
function preselect(): void {
  if (selectedIds.value.length) return
  const picked: string[] = []
  const seen = new Set<string>()
  for (const r of ranked.value) {
    if (!r.hasData || seen.has(r.store.chain_id)) continue
    seen.add(r.store.chain_id)
    picked.push(r.store.id)
    if (picked.length >= MAX_STORES) break
  }
  selectedIds.value = picked
  persist()
}

export function useStores() {
  return {
    all,
    loaded,
    loading,
    locating,
    coords,
    query,
    ranked,
    selectedIds,
    selectedStores,
    islands,
    loadStores,
    locate,
    toggle,
    preselect,
    hasData,
  }
}
