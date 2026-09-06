<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSpecials } from '../composables/useSpecials'
import { useCategories } from '../composables/useCategories'
import { catLevel, chainClass, displayName, money, wasPriceOf } from '../lib/format'
import { catName, t } from '../composables/useI18n'
import type { Special, Store } from '../lib/types'

const { freshByKg } = useSpecials()
const { nameOf } = useCategories()

const tab = ref<'meat' | 'produce'>('meat')
const L1 = { meat: 'meat-poultry-and-seafood', produce: 'fruit-and-vegetables' }

interface Row {
  store: Store
  special: Special
}

const sections = computed<Array<{ id: string; label: string; rows: Row[] }>>(() => {
  const want = L1[tab.value]
  const map = new Map<string, Row[]>()
  const seen = new Set<string>()
  for (const r of freshByKg.value) {
    if (catLevel(r.special.category_id, 1) !== want) continue
    const dedupe = `${r.store.id}|${r.special.product_key ?? r.special.product_id}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const id = catLevel(r.special.category_id, 2) ?? want
    const list = map.get(id)
    if (list) list.push(r)
    else map.set(id, [r])
  }
  return [...map.entries()]
    .map(([id, rows]) => ({ id, label: catName(nameOf(id)), rows: rows.slice(0, 8) }))
    .sort((a, b) => a.rows[0].special.unit_price! - b.rows[0].special.unit_price!)
})

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

    <div v-for="sec in sections" :key="sec.id" class="pad" style="margin-top: 12px">
      <div class="sec">{{ sec.label }}</div>
      <div style="margin-top: 2px">
        <RouterLink
          v-for="r in sec.rows"
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
          </div>
        </RouterLink>
      </div>
    </div>

    <div v-if="!sections.length" class="pad" style="margin-top: 16px">
      <div class="empty sub">{{ t('browse.empty') }}</div>
    </div>
  </div>
</template>
