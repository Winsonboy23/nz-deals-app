<script setup lang="ts">
import { computed, ref } from 'vue'
import ProductThumb from '../components/ProductThumb.vue'
import TagChip from '../components/TagChip.vue'
import { useSpecials } from '../composables/useSpecials'
import { useCategories } from '../composables/useCategories'
import { dealPrice, discountDepth, primaryTag } from '../lib/compare'
import { catLevel, chainClass, chainName, chainOf, displayName, money } from '../lib/format'
import { catName, t } from '../composables/useI18n'
import type { ChainId, Group } from '../lib/types'

const { deepDiscounts, comparable, rows: allRows, activeStores } = useSpecials()
const { nameOf } = useCategories()
const chain = ref<ChainId | 'all'>('all')
/** 商品分類標籤（Foodstuffs 第一層）：全部 / 蔬果 / 肉類…，數字是目前超市篩選下的筆數。換超市就回到全部。 */
const cat = ref<string>('all')
const byChain = computed(() =>
  deepDiscounts.value.filter((r) => chain.value === 'all' || chainOf(r.store.id) === chain.value),
)
const catCounts = computed(() => {
  const m = new Map<string, number>()
  const pns = !pnsCount.value || (chain.value !== 'all' && chain.value !== 'paknsave') ? []
    : canCompare.value ? pnsDeals.value.map((g) => g.best.special) : pnsPlain.value.map((r) => r.special)
  for (const sp of [...byChain.value.map((r) => r.special), ...pns]) {
    const id = catLevel(sp.category_id, 1)
    if (id) m.set(id, (m.get(id) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
})
function pickChain(c: ChainId | 'all') {
  chain.value = c
  cat.value = 'all'
}

/** PAK'nSAVE 沒有原價、進不了半價榜，另外列一區：它的低價標籤裡「比你選的其他店便宜」的商品（同一樣東西比），差最多的在前。 */
const hasPns = computed(() => activeStores.value.some((d) => d.store.id.startsWith('paknsave:')))
const canCompare = computed(() => activeStores.value.some((d) => !d.store.id.startsWith('paknsave:')))
const pnsDeals = computed<Group[]>(() =>
  comparable.value
    .filter((g) => g.best.store.id.startsWith('paknsave:'))
    .sort((a, b) => (b.payGap ?? 0) - (a.payGap ?? 0)),
)
/** 沒有別家可比時，退而列它的低價商品（資料順序）。 */
const pnsPlain = computed(() =>
  allRows.value.filter((r) => r.store.id.startsWith('paknsave:')).slice(0, 60),
)
const pnsCount = computed(() => (hasPns.value ? (canCompare.value ? pnsDeals.value.length : pnsPlain.value.length) : 0))

const counts = computed(() => {
  const m = new Map<ChainId, number>()
  for (const r of deepDiscounts.value) {
    const c = chainOf(r.store.id)
    m.set(c, (m.get(c) ?? 0) + 1)
  }
  if (pnsCount.value) m.set('paknsave', pnsCount.value)
  return [...m.entries()]
})
const showPns = computed(() => pnsCount.value > 0 && (chain.value === 'all' || chain.value === 'paknsave'))
const pnsRows = computed(() => {
  if (!showPns.value) return []
  const list = canCompare.value
    ? pnsDeals.value.map((g) => ({ store: g.best.store, special: g.best.special, group: g as Group | null }))
    : pnsPlain.value.map((r) => ({ store: r.store, special: r.special, group: null as Group | null }))
  return list.filter((r) => cat.value === 'all' || catLevel(r.special.category_id, 1) === cat.value).slice(0, 60)
})
function others(g: Group): string {
  return t('cmp.others', { v: g.offers.slice(1).map((o) => money(dealPrice(o.special))).join(' · ') })
}
const rows = computed(() =>
  byChain.value
    .filter((r) => cat.value === 'all' || catLevel(r.special.category_id, 1) === cat.value)
    .slice(0, 60),
)
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px">
      <RouterLink class="back" to="/">{{ t('common.back') }}</RouterLink>
      <div class="h1" style="margin-top: 2px">{{ t('half.title') }}</div>
    </div>
    <div class="chips nowrap" style="margin: 10px 0 0 var(--gutter)">
      <button class="chip" :class="chain === 'all' ? 'on' : ''" @click="pickChain('all')">
        {{ t('browse.all') }} · {{ deepDiscounts.length + pnsCount }}
      </button>
      <button
        v-for="[c, n] in counts"
        :key="c"
        class="chip"
        :class="[chainClass(c + ':x'), chain === c ? 'on' : '']"
        @click="pickChain(c)"
      >
        <span class="dot" :class="chainClass(c + ':x')" />{{ chainName(c + ':x') }} · {{ n }}
      </button>
    </div>
    <div class="chips nowrap" style="margin: 8px 0 0 var(--gutter)">
      <button class="chip" :class="cat === 'all' ? 'on' : ''" @click="cat = 'all'">
        {{ t('browse.all') }}
      </button>
      <button
        v-for="[id, n] in catCounts"
        :key="id"
        class="chip"
        :class="cat === id ? 'on' : ''"
        @click="cat = id"
      >
        {{ catName(nameOf(id)) }} · {{ n }}
      </button>
    </div>
    <div class="pad sub muted" style="margin-top: 8px; font-size: 12.5px">{{ t('half.note') }}</div>

    <div v-if="rows.length && chain !== 'paknsave'" class="grid3 g2" style="margin-top: 6px">
      <RouterLink
        v-for="r in rows"
        :key="r.store.id + r.special.product_id"
        class="card"
        :to="r.special.product_key ? `/p/${encodeURIComponent(r.special.product_key)}` : ''"
      >
        <ProductThumb :special="r.special">
          <span class="dot" :class="chainClass(r.store.id)" />
          <span class="tag pct deal">-{{ Math.round(discountDepth(r.special) * 100) }}%</span>
        </ProductThumb>
        <div class="price">
          {{ money(r.special.price)
          }}<span
            v-if="r.special.was_price"
            style="
              font-size: 12px;
              color: var(--ink-3);
              text-decoration: line-through;
              font-weight: 600;
              margin-left: 6px;
              letter-spacing: 0;
            "
            >{{ money(r.special.was_price) }}</span
          >
        </div>
        <div class="name" style="margin-top: 6px">{{ displayName(r.special) }}</div>
        <div v-if="primaryTag(r.special)" style="margin-top: 7px">
          <TagChip :tag="primaryTag(r.special)!" />
        </div>
      </RouterLink>
    </div>
    <div v-else-if="!pnsRows.length" class="pad" style="margin-top: 16px">
      <div class="empty sub">{{ t('browse.empty') }}</div>
    </div>

    <template v-if="showPns">
      <div class="pad" style="margin-top: 22px">
        <div class="h2">{{ t('half.pns') }}</div>
        <div class="sub muted" style="margin-top: 4px; font-size: 12.5px">
          {{ canCompare ? t('half.pnsNote') : t('half.pnsNoCompare') }}
        </div>
      </div>
      <div v-if="pnsRows.length" class="grid3 g2" style="margin-top: 8px">
        <RouterLink
          v-for="r in pnsRows"
          :key="'pns' + r.store.id + r.special.product_id"
          class="card"
          :to="r.special.product_key ? `/p/${encodeURIComponent(r.special.product_key)}` : ''"
        >
          <ProductThumb :special="r.special">
            <span class="dot pns" />
            <span class="tag low">{{ t('tag.low') }}</span>
          </ProductThumb>
          <div class="price">{{ money(dealPrice(r.special)) }}</div>
          <div class="name" style="margin-top: 6px">{{ displayName(r.special) }}</div>
          <div v-if="r.group" class="others" style="margin-top: 6px">{{ others(r.group) }}</div>
        </RouterLink>
      </div>
      <div v-else class="pad" style="margin-top: 12px">
        <div class="empty sub">{{ t('browse.empty') }}</div>
      </div>
    </template>
  </div>
</template>
