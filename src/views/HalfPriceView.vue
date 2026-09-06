<script setup lang="ts">
import { computed, ref } from 'vue'
import ProductThumb from '../components/ProductThumb.vue'
import TagChip from '../components/TagChip.vue'
import { useSpecials } from '../composables/useSpecials'
import { discountDepth, primaryTag } from '../lib/compare'
import { chainClass, chainName, chainOf, displayName, money } from '../lib/format'
import { t } from '../composables/useI18n'
import type { ChainId } from '../lib/types'

const { deepDiscounts } = useSpecials()
const chain = ref<ChainId | 'all'>('all')

const counts = computed(() => {
  const m = new Map<ChainId, number>()
  for (const r of deepDiscounts.value) {
    const c = chainOf(r.store.id)
    m.set(c, (m.get(c) ?? 0) + 1)
  }
  return [...m.entries()]
})
const rows = computed(() =>
  deepDiscounts.value
    .filter((r) => chain.value === 'all' || chainOf(r.store.id) === chain.value)
    .slice(0, 60),
)
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px">
      <RouterLink class="back" to="/">{{ t('common.back') }}</RouterLink>
      <div class="h1" style="margin-top: 2px">{{ t('half.title') }}</div>
    </div>
    <div class="chips nowrap" style="margin: 10px 0 0 20px">
      <button class="chip" :class="chain === 'all' ? 'on' : ''" @click="chain = 'all'">
        {{ t('browse.all') }} · {{ deepDiscounts.length }}
      </button>
      <button
        v-for="[c, n] in counts"
        :key="c"
        class="chip"
        :class="chain === c ? 'on' : ''"
        @click="chain = c"
      >
        <span class="dot" :class="chainClass(c + ':x')" />{{ chainName(c + ':x') }} · {{ n }}
      </button>
    </div>
    <div class="pad sub muted" style="margin-top: 8px; font-size: 12.5px">{{ t('half.note') }}</div>

    <div v-if="rows.length" class="grid3 g2" style="margin-top: 6px">
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
    <div v-else class="pad" style="margin-top: 16px">
      <div class="empty sub">{{ t('browse.empty') }}</div>
    </div>
  </div>
</template>
