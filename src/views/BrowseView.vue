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

watch(
  level2,
  (list) => {
    if (!cat.value && list.length) cat.value = list[0].id
  },
  { immediate: true },
)
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
  return out.sort((a, b) => b.compare.length + b.singles.length - (a.compare.length + a.singles.length))
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

    <div class="chips nowrap" style="margin: 8px 0 0 var(--gutter)">
      <button
        v-for="c in level2"
        :key="c.id"
        class="chip"
        :class="cat === c.id ? 'on' : 'off'"
        @click="cat = c.id"
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
      <div v-for="g in sec.compare.slice(0, 4)" :key="g.key" class="pad" style="margin-bottom: 8px">
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
