<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import ProductThumb from '../components/ProductThumb.vue'
import TagChip from '../components/TagChip.vue'
import { useSpecials } from '../composables/useSpecials'
import { useCategories } from '../composables/useCategories'
import { dealPrice, discountDepth, primaryTag } from '../lib/compare'
import { catLevel, chainClass, chainName, chainOf, displayName, money } from '../lib/format'
import { catName, t } from '../composables/useI18n'
import type { ChainId, Group, Special, Store } from '../lib/types'

const router = useRouter()
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
const pnsRows = computed<Stack[]>(() => {
  if (!showPns.value) return []
  const list: Row[] = canCompare.value
    ? pnsDeals.value.map((g) => ({ store: g.best.store, special: g.best.special, group: g as Group | null }))
    : pnsPlain.value.map((r) => ({ store: r.store, special: r.special, group: null }))
  return stack(list.filter((r) => cat.value === 'all' || catLevel(r.special.category_id, 1) === cat.value)).slice(0, 60)
})
function others(g: Group): string {
  return t('cmp.others', { v: g.offers.slice(1).map((o) => money(dealPrice(o.special))).join(' · ') })
}
/** 疊卡片（2026-09-08）：同品牌同第二層分類合成一張卡（Cadbury 17 款），點「N 款」在原地攤開，不換頁。
 *  進來的清單已按折扣深排序，所以每疊的第一個就是最划算的，疊的順序也跟著。 */
interface Row { store: Store; special: Special; group?: Group | null }
interface Stack { key: string; head: Row; items: Row[] }
const COLS = 3
const cat2 = (id: string | null) => (id ? id.split('/').slice(0, 2).join('/') : '')
function stack(list: Row[]): Stack[] {
  const map = new Map<string, Row[]>()
  for (const r of list) {
    const b = (r.special.brand ?? '').trim().toLowerCase()
    const k = b ? `${b}|${cat2(r.special.category_id)}` : `1|${r.store.id}|${r.special.product_id}`
    const cur = map.get(k)
    if (cur) cur.push(r)
    else map.set(k, [r])
  }
  return [...map.entries()].map(([key, items]) => ({ key, head: items[0], items }))
}
/** 攤開的那一疊；攤開的面板要放在「那一列的最後一張之後」，不然那列會被切斷。 */
const opened = ref<string | null>(null)
const toggle = (k: string) => (opened.value = opened.value === k ? null : k)
function expandAfter(list: Stack[], sec: string): number {
  const i = list.findIndex((x) => sec + x.key === opened.value)
  return i < 0 ? -1 : Math.min(list.length - 1, Math.floor(i / COLS) * COLS + COLS - 1)
}
const openedItems = computed<Row[]>(
  () =>
    rows.value.find((x) => 'h' + x.key === opened.value)?.items ??
    pnsRows.value.find((x) => 'p' + x.key === opened.value)?.items ??
    [],
)
function go(r: Row) {
  if (r.special.product_key) void router.push(`/p/${encodeURIComponent(r.special.product_key)}`)
}

const rows = computed<Stack[]>(() =>
  stack(byChain.value.filter((r) => cat.value === 'all' || catLevel(r.special.category_id, 1) === cat.value)).slice(0, 60),
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
      <template v-for="(st, i) in rows" :key="st.key">
        <div class="card" @click="go(st.head)">
          <ProductThumb :special="st.head.special" :class="{ stack: st.items.length > 1 }">
            <span class="dot" :class="chainClass(st.head.store.id)" />
            <span class="tag pct deal">-{{ Math.round(discountDepth(st.head.special) * 100) }}%</span>
            <button
              v-if="st.items.length > 1"
              class="tag stackn"
              :class="{ on: opened === 'h' + st.key }"
              @click.stop="toggle('h' + st.key)"
            >
              {{ t('card.variants', { n: st.items.length }) }}
            </button>
          </ProductThumb>
          <div class="price">
            {{ money(st.head.special.price)
            }}<span
              v-if="st.head.special.was_price"
              style="
                font-size: 12px;
                color: var(--ink-3);
                text-decoration: line-through;
                font-weight: 600;
                margin-left: 6px;
                letter-spacing: 0;
              "
              >{{ money(st.head.special.was_price) }}</span
            >
          </div>
          <div class="name" style="margin-top: 6px">{{ displayName(st.head.special) }}</div>
          <div v-if="primaryTag(st.head.special)" style="margin-top: 7px">
            <TagChip :tag="primaryTag(st.head.special)!" />
          </div>
        </div>
        <div v-if="expandAfter(rows, 'h') === i" class="expand">
          <div class="hscroll">
            <RouterLink
              v-for="r in openedItems"
              :key="r.store.id + r.special.product_id"
              class="stackitem"
              :to="r.special.product_key ? `/p/${encodeURIComponent(r.special.product_key)}` : ''"
            >
              <ProductThumb :special="r.special" variant="tn" style="width: 100%; height: 78px" />
              <div class="p" style="margin-top: 5px; font-size: 15px">{{ money(dealPrice(r.special)) }}</div>
              <div class="s" style="line-height: 1.25">{{ displayName(r.special) }}</div>
            </RouterLink>
          </div>
        </div>
      </template>
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
        <template v-for="(st, i) in pnsRows" :key="st.key">
          <div class="card" @click="go(st.head)">
            <ProductThumb :special="st.head.special" :class="{ stack: st.items.length > 1 }">
              <span class="dot pns" />
              <span class="tag low">{{ t('tag.low') }}</span>
              <button
                v-if="st.items.length > 1"
                class="tag stackn"
                :class="{ on: opened === 'p' + st.key }"
                @click.stop="toggle('p' + st.key)"
              >
                {{ t('card.variants', { n: st.items.length }) }}
              </button>
            </ProductThumb>
            <div class="price">{{ money(dealPrice(st.head.special)) }}</div>
            <div class="name" style="margin-top: 6px">{{ displayName(st.head.special) }}</div>
            <div v-if="st.head.group" class="others" style="margin-top: 6px">{{ others(st.head.group!) }}</div>
          </div>
          <div v-if="expandAfter(pnsRows, 'p') === i" class="expand">
            <div class="hscroll">
              <RouterLink
                v-for="r in openedItems"
                :key="r.store.id + r.special.product_id"
                class="stackitem"
                :to="r.special.product_key ? `/p/${encodeURIComponent(r.special.product_key)}` : ''"
              >
                <ProductThumb :special="r.special" variant="tn" style="width: 100%; height: 78px" />
                <div class="p" style="margin-top: 5px; font-size: 15px">{{ money(dealPrice(r.special)) }}</div>
                <div class="s" style="line-height: 1.25">{{ displayName(r.special) }}</div>
              </RouterLink>
            </div>
          </div>
        </template>
      </div>
      <div v-else class="pad" style="margin-top: 12px">
        <div class="empty sub">{{ t('browse.empty') }}</div>
      </div>
    </template>
  </div>
</template>
