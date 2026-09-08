<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ProductCard from '../components/ProductCard.vue'
import CompareBox from '../components/CompareBox.vue'
import { useSpecials } from '../composables/useSpecials'
import { useStores } from '../composables/useStores'
import { useSettings } from '../composables/useSettings'
import { useCategories } from '../composables/useCategories'
import { catLevel, chainClass, chainName, chainOf, isFresh } from '../lib/format'
import { toOffer } from '../lib/compare'
import { catName, t } from '../composables/useI18n'
import { readCache, writeCache } from '../lib/cache'
import { catRank } from '../lib/catOrder'
import type { ChainId, Group, Offer } from '../lib/types'

const { rows, groups, level2 } = useSpecials()
const { selectedStores } = useStores()
const { foodOnly } = useSettings()
const { nameOf } = useCategories()

const chain = ref<ChainId | 'all'>('all')
const cat = ref<string>('')
const shown = ref(6)

const chains = computed(() => {
  const seen: ChainId[] = []
  for (const s of selectedStores.value) if (!seen.includes(s.chain_id)) seen.push(s.chain_id)
  return seen
})

/** 兩層點選（2026-09-08）：第一排 8 個大類，點了第二排才出現它的小類；點過的小類記起來排前面。 */
const L1_ORDER = ['fruit-and-vegetables', 'meat-poultry-and-seafood', 'fridge-deli-and-eggs', 'bakery', 'frozen', 'pantry', 'hot-and-cold-drinks', 'snacks-treats-and-easy-meals']
const level1 = computed<Array<{ id: string; n: number }>>(() => {
  const n = new Map<string, number>()
  for (const c of level2.value) {
    const id = c.id.split('/')[0]
    n.set(id, (n.get(id) ?? 0) + c.n)
  }
  const rank = (id: string) => { const i = L1_ORDER.indexOf(id); return i < 0 ? 99 : i }
  return [...n.entries()].map(([id, count]) => ({ id, n: count })).sort((a, b) => rank(a.id) - rank(b.id) || b.n - a.n)
})
const l1 = ref('')
let recent: string[] = readCache<string[]>('recentCats') ?? []
/** 「點過的排前面」只在換大類時重排，點的當下不動，不然被點的那顆會跳到最前面。 */
const recentOrder = ref<string[]>(recent)
const subs = computed(() => {
  const list = level2.value.filter((c) => c.id.startsWith(l1.value + '/')).sort((a, b) => catRank(a.id) - catRank(b.id))
  const rec = recentOrder.value.filter((id) => list.some((c) => c.id === id))
  return [...rec.map((id) => list.find((c) => c.id === id)!), ...list.filter((c) => !rec.includes(c.id))]
})
watch(level1, (list) => { if (!list.some((c) => c.id === l1.value)) l1.value = list[0]?.id ?? '' }, { immediate: true })
watch(l1, () => { recentOrder.value = recent })
watch(subs, (list) => { if (!list.some((c) => c.id === cat.value)) cat.value = list[0]?.id ?? '' }, { immediate: true })
function pickCat(id: string) {
  cat.value = id
  recent = [id, ...recent.filter((x) => x !== id)].slice(0, 8)
  writeCache('recentCats', recent)
}
watch([cat, chain, foodOnly], () => (shown.value = 6))

interface Section {
  id: string
  label: string
  compare: Group[]
  singles: Offer[]
  fresh: boolean
}

const sections = computed<Section[]>(() => {
  if (!cat.value) return []
  const buckets = new Map<string, { compare: Map<string, Group>; singles: Offer[] }>()
  for (const { store, special } of rows.value) {
    if (catLevel(special.category_id, 2) !== cat.value) continue
    if (chain.value !== 'all' && chainOf(store.id) !== chain.value) continue
    const id = catLevel(special.category_id, 3) ?? cat.value
    let b = buckets.get(id)
    if (!b) buckets.set(id, (b = { compare: new Map(), singles: [] }))
    const g = special.product_key ? groups.value.get(special.product_key) : undefined
    if (g && g.offers.length >= 2) b.compare.set(g.key, g)
    else b.singles.push(toOffer(store, special))
  }
  const out: Section[] = []
  for (const [id, b] of buckets) {
    const fresh = isFresh(id)
    const value = (o: Offer) => (fresh && o.unit ? o.unit : o.deal)
    out.push({
      id,
      label: catName(nameOf(id)),
      compare: [...b.compare.values()].sort((a, c) => value(a.best) - value(c.best)),
      singles: b.singles.sort((a, c) => value(a) - value(c)),
      fresh,
    })
  }
  return out.sort((a, b) => catRank(a.id) - catRank(b.id))   // 超市自己的順序，不是筆數
})

const visible = computed(() => sections.value.slice(0, shown.value))

function toggleFood() {
  foodOnly.value = !foodOnly.value
}
</script>

<template>
  <div class="screen">
    <div class="pad hrow" style="margin-top: 4px">
      <div class="h1">{{ t('browse.title') }}</div>
      <div style="display: flex; align-items: center; gap: 10px">
        <span style="font-size: 14px; font-weight: 600; color: var(--ink-2)">
          {{ t('browse.foodOnly') }}
        </span>
        <button class="tg" :class="{ off: !foodOnly }" @click="toggleFood" />
      </div>
    </div>

    <div class="chips nowrap" style="margin: 8px 0 0 var(--gutter)">
      <button class="chip" :class="chain === 'all' ? 'on' : ''" @click="chain = 'all'">
        {{ t('browse.all') }}
      </button>
      <button
        v-for="c in chains"
        :key="c"
        class="chip"
        :class="chain === c ? 'on' : ''"
        @click="chain = c"
      >
        <span class="dot" :class="chainClass(c + ':x')" />{{ chainName(c + ':x') }}
      </button>
    </div>

    <div class="chips nowrap" style="margin: 10px 0 0 var(--gutter)">
      <button
        v-for="c in level1"
        :key="c.id"
        class="chip"
        :class="l1 === c.id ? 'on' : ''"
        @click="l1 = c.id"
      >
        {{ catName(nameOf(c.id)) }}
      </button>
    </div>
    <div class="chips nowrap" style="margin: 8px 0 0 var(--gutter)">
      <button
        v-for="c in subs"
        :key="c.id"
        class="chip"
        :class="cat === c.id ? 'on' : 'off'"
        @click="pickCat(c.id)"
      >
        {{ catName(nameOf(c.id)) }}
      </button>
    </div>

    <div v-if="!visible.length" class="pad" style="margin-top: 16px">
      <div class="empty sub">{{ t('browse.empty') }}</div>
    </div>

    <template v-for="sec in visible" :key="sec.id">
      <div class="pad hrow" style="margin-top: 12px; margin-bottom: 6px">
        <div class="h2 ell grow" style="font-size: 19px">{{ sec.label }}</div>
        <div class="link" style="flex: none">
          {{ sec.fresh ? t('browse.byKg') : t('browse.byPrice') }}
        </div>
      </div>
      <div v-for="g in sec.compare.slice(0, 4)" :key="g.key" class="cmp-flush">
        <CompareBox :group="g" />
      </div>
      <div v-if="sec.singles.length" class="grid3">
        <ProductCard
          v-for="o in sec.singles.slice(0, 9)"
          :key="o.store.id + o.special.product_id"
          :offer="o"
          :group="o.special.product_key ? groups.get(o.special.product_key) : null"
        />
      </div>
    </template>

    <div v-if="shown < sections.length" class="pad" style="margin-top: 16px">
      <button class="btn ghost" style="width: 100%" @click="shown += 6">
        {{ t('home.more', { n: sections.length - shown }) }}
      </button>
    </div>
  </div>
</template>
