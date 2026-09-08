<script setup lang="ts">
import { computed } from 'vue'
import ProductThumb from '../components/ProductThumb.vue'
import { useSpecials } from '../composables/useSpecials'
import { dealPrice } from '../lib/compare'
import { chainClass, displayName, money, priceSuffix, unitLabel, wasPriceOf } from '../lib/format'
import { chainBadge, t } from '../composables/useI18n'
import type { Group } from '../lib/types'

const { topDeduped } = useSpecials()
const rows = computed(() => topDeduped.value.slice(0, 10).map((x) => x.g))

function detail(g: Group): string {
  const s = g.best.special
  if (s.club_only) return `Clubcard · ${unitLabel(s) ?? money(s.price)}`
  const was = wasPriceOf(s)
  if (was) return `was ${money(was)}`
  return unitLabel(s) ?? t('tag.low')
}
function others(g: Group): string {
  return t('cmp.others', {
    v: g.offers
      .slice(1)
      .map((o) => money(dealPrice(o.special)))
      .join(' · '),
  })
}
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 8px">
      <RouterLink class="back" to="/">{{ t('common.back') }}</RouterLink>
      <div class="h1" style="margin-top: 4px">{{ t('top10.title') }}</div>
      <div class="sub" style="margin-top: 5px">{{ t('top10.sub') }}</div>
    </div>
    <div class="pad" style="margin-top: 10px">
      <RouterLink
        v-for="(g, i) in rows"
        :key="g.key"
        class="lrow"
        :to="`/p/${encodeURIComponent(g.key)}`"
        style="padding: 6px 0; border-top: 1px solid var(--line); gap: 9px"
      >
        <div class="rank">{{ i + 1 }}</div>
        <ProductThumb :special="g.best.special" variant="tn" style="width: 46px; height: 46px" />
        <div class="grow">
          <div class="t ell" style="font-size: 14.5px">{{ displayName(g.best.special) }}</div>
          <div style="display: flex; align-items: center; gap: 7px; margin-top: 4px">
            <span class="tag best" :class="chainClass(g.best.store.id)">
              ✓ {{ chainBadge(g.best.store.id) }}
            </span>
            <span class="ell" style="font-size: 12px; color: var(--ink-2)">{{ detail(g) }}</span>
          </div>
          <div class="others" style="margin-top: 3px">{{ others(g) }}</div>
        </div>
        <div style="text-align: right; flex: none">
          <div class="price" style="margin-top: 0; font-size: 20px">
            {{ money(dealPrice(g.best.special))
            }}<span v-if="priceSuffix(g.best.special)" class="unit">
              {{ priceSuffix(g.best.special) }}</span
            >
          </div>
          <div v-if="g.payGap" class="gap">{{ t('cmp.gap', { v: money(g.payGap) }) }}</div>
        </div>
      </RouterLink>
      <div v-if="!rows.length" class="empty sub" style="margin-top: 16px">
        {{ t('home.noCompare') }}
      </div>
    </div>
  </div>
</template>
