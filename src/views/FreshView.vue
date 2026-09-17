<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSpecials } from '../composables/useSpecials'
import { useCategories } from '../composables/useCategories'
import { catLevel, chainClass, chainName, chainOf, displayName, money, wasPriceOf } from '../lib/format'
import { catName, t } from '../composables/useI18n'
import { catRank } from '../lib/catOrder'
import type { ChainId, Special, Store } from '../lib/types'

const { freshByKg } = useSpecials()
const { nameOf } = useCategories()

const tab = ref<'meat' | 'produce'>('meat')
const L1 = { meat: 'meat-poultry-and-seafood', produce: 'fruit-and-vegetables' }

/** 三家超市標籤（跟半價頁一樣）：全部 / 各家，數字是這個分頁裡的筆數。 */
const chain = ref<ChainId | 'all'>('all')
const inTab = computed(() => freshByKg.value.filter((r) => catLevel(r.special.category_id, 1) === L1[tab.value]))
const counts = computed(() => {
  const m = new Map<ChainId, number>()
  for (const r of inTab.value) {
    const c = chainOf(r.store.id)
    m.set(c, (m.get(c) ?? 0) + 1)
  }
  return [...m.entries()]
})

interface Row {
  store: Store
  special: Special
}

/** 商品分類標籤（第二層 = 下面的分組）：全部 / 雞肉 / 牛肉…。換分頁或換超市就回到全部。 */
const cat = ref<string>('all')
watch([tab, chain], () => {
  cat.value = 'all'
})

/** 每類先列最便宜的 8 樣，其餘收在「看全部」（2026-09-17：以前硬切 8 樣，Jazz 蘋果排第 10 就看不到）。 */
const ROWS_MAX = 8
const opened = ref<Set<string>>(new Set())
const isOpen = (id: string) => opened.value.has(id)
function toggleSec(id: string) {
  const next = new Set(opened.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  opened.value = next
}
watch([tab, chain, cat], () => {
  opened.value = new Set()
})

const sections = computed<Array<{ id: string; label: string; total: number; rows: Row[] }>>(() => {
  const want = L1[tab.value]
  const map = new Map<string, Row[]>()
  const seen = new Set<string>()
  for (const r of inTab.value) {
    if (chain.value !== 'all' && chainOf(r.store.id) !== chain.value) continue
    const dedupe = `${r.store.id}|${r.special.product_key ?? r.special.product_id}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const id = catLevel(r.special.category_id, 2) ?? want
    const list = map.get(id)
    if (list) list.push(r)
    else map.set(id, [r])
  }
  return [...map.entries()]
    .map(([id, rows]) => ({ id, label: catName(nameOf(id)), total: rows.length, rows }))
    .sort((a, b) => catRank(a.id) - catRank(b.id))   // 超市自己的順序（雞肉→牛肉→…→植物替代），不按最便宜
})

const shown = computed(() => (cat.value === 'all' ? sections.value : sections.value.filter((s) => s.id === cat.value)))

function note(r: Row): string {
  const bits = [r.store.name]
  if (r.special.club_only) bits.push('Clubcard')
  else {
    const was = wasPriceOf(r.special)
    if (was) bits.push(`was ${money(was)}`)
  }
  return bits.join(' · ')
}
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 8px">
      <RouterLink class="back" to="/">{{ t('common.back') }}</RouterLink>
      <div class="h1" style="margin-top: 4px">{{ t('fresh.title') }}</div>
    </div>
    <div class="pad" style="margin-top: 10px">
      <div class="seg">
        <div :class="{ on: tab === 'meat' }" @click="tab = 'meat'">{{ t('fresh.meat') }}</div>
        <div :class="{ on: tab === 'produce' }" @click="tab = 'produce'">{{ t('fresh.produce') }}</div>
      </div>
    </div>
    <div class="chips nowrap" style="margin: 10px 0 0 var(--gutter)">
      <button class="chip" :class="chain === 'all' ? 'on' : ''" @click="chain = 'all'">
        {{ t('browse.all') }} · {{ inTab.length }}
      </button>
      <button
        v-for="[c, n] in counts"
        :key="c"
        class="chip"
        :class="[chainClass(c + ':x'), chain === c ? 'on' : '']"
        @click="chain = c"
      >
        <span class="dot" :class="chainClass(c + ':x')" />{{ chainName(c + ':x') }} · {{ n }}
      </button>
    </div>

    <div v-if="sections.length" class="chips nowrap" style="margin: 8px 0 0 var(--gutter)">
      <button class="chip" :class="cat === 'all' ? 'on' : ''" @click="cat = 'all'">
        {{ t('browse.all') }}
      </button>
      <button
        v-for="sec in sections"
        :key="sec.id"
        class="chip"
        :class="cat === sec.id ? 'on' : ''"
        @click="cat = sec.id"
      >
        {{ sec.label }} · {{ sec.total }}
      </button>
    </div>

    <div v-for="sec in shown" :key="sec.id" class="pad" style="margin-top: 12px">
      <div class="sec">{{ sec.label }}</div>
      <div style="margin-top: 2px">
        <RouterLink
          v-for="r in isOpen(sec.id) ? sec.rows : sec.rows.slice(0, ROWS_MAX)"
          :key="r.store.id + r.special.product_id"
          class="lrow"
          :to="r.special.product_key ? `/p/${encodeURIComponent(r.special.product_key)}` : ''"
          style="padding: 6px 0; border-top: 1px solid var(--line)"
        >
          <span class="dot" :class="chainClass(r.store.id)" />
          <div class="grow">
            <div class="t ell" style="font-size: 15px">{{ displayName(r.special) }}</div>
            <div class="s ell">{{ note(r) }}</div>
          </div>
          <div style="text-align: right; flex: none">
            <div class="p" style="font-size: 19px">{{ money(r.special.unit_price!) }}/kg</div>
            <div
              v-if="Math.abs(r.special.price - r.special.unit_price!) > 0.005"
              class="small muted"
              style="margin-top: 2px"
            >
              {{ money(r.special.price) }}
            </div>
            <!-- 湊件價（2026-09-17）：排序照舊用單件的每公斤，這裡只把條件寫出來 -->
            <div v-if="r.special.multi_buy && r.special.multi_buy.qty > 1" class="small muted" style="margin-top: 2px">
              {{ t('fresh.multi', { q: r.special.multi_buy.qty, v: money(r.special.multi_buy.total) }) }}
            </div>
          </div>
        </RouterLink>
      </div>
      <div v-if="sec.total > ROWS_MAX" style="margin-top: 8px">
        <button class="chip" :class="{ on: isOpen(sec.id) }" @click="toggleSec(sec.id)">
          {{ isOpen(sec.id) ? t('browse.showLess') : t('browse.showAll', { n: sec.total }) }}
        </button>
      </div>
    </div>

    <div v-if="!sections.length" class="pad" style="margin-top: 16px">
      <div class="empty sub">{{ t('browse.empty') }}</div>
    </div>
  </div>
</template>
