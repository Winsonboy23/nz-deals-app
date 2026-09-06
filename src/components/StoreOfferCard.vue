<script setup lang="ts">
import { computed } from 'vue'
import ProductThumb from './ProductThumb.vue'
import TagChip from './TagChip.vue'
import { dealPrice, primaryTag } from '../lib/compare'
import { chainClass, money, priceSuffix, unitLabel, wasPriceOf } from '../lib/format'
import { t } from '../composables/useI18n'
import type { Offer } from '../lib/types'

const props = defineProps<{ offer: Offer; best?: boolean }>()
const s = computed(() => props.offer.special)
const tag = computed(() => primaryTag(s.value))
const was = computed(() => wasPriceOf(s.value))
const note = computed(() => (s.value.club_only ? t('p.clubNeeded') : ''))
const to = computed(() => (s.value.product_key ? `/p/${encodeURIComponent(s.value.product_key)}` : ''))
</script>

<template>
  <RouterLink
    :to="to"
    :style="{
      border: best ? '2px solid var(--ink)' : '1px solid var(--line)',
      background: best ? '#FFFCF0' : '',
      borderRadius: '14px',
      padding: '9px 12px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
      marginTop: '7px',
    }"
  >
    <ProductThumb :special="s" variant="tn" />
    <div style="flex: 1; min-width: 0; padding-top: 1px">
      <div style="display: flex; align-items: center; gap: 6px">
        <span class="dot" :class="chainClass(offer.store.id)" />
        <span class="sec ell" style="font-size: 10px; letter-spacing: 0.4px">
          {{ offer.store.name }}
        </span>
      </div>
      <div class="t ell" style="font-size: 15px; font-weight: 700; margin-top: 4px">
        {{ s.name }}
      </div>
      <div v-if="unitLabel(s)" class="s">{{ unitLabel(s) }}</div>
    </div>
    <div style="text-align: right; flex: none">
      <div class="price" style="margin-top: 0">
        {{ money(dealPrice(s)) }}<span v-if="priceSuffix(s)" class="unit">{{ priceSuffix(s) }}</span>
      </div>
      <div class="small muted" style="margin-top: 4px">
        <s v-if="was">{{ money(was) }}</s>
        <template v-else>{{ note }}</template>
      </div>
      <div v-if="tag" style="margin-top: 5px"><TagChip :tag="tag" /></div>
    </div>
  </RouterLink>
</template>
