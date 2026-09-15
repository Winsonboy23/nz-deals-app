<script setup lang="ts">
import { computed } from 'vue'
import ProductThumb from './ProductThumb.vue'
import TagChip from './TagChip.vue'
import PriceLine from './PriceLine.vue'
import { primaryTag } from '../lib/compare'
import { chainClass, displayName, unitLabel } from '../lib/format'
import type { Offer } from '../lib/types'

const props = defineProps<{ offer: Offer; best?: boolean }>()
const s = computed(() => props.offer.special)
const tag = computed(() => primaryTag(s.value))
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
      <!-- 紅超、黃超的 name 沒有品牌和容量（另外兩欄），要用 displayName 拼回去，不然到貨架前對不到（2026-09-15） -->
      <div class="t ell" style="font-size: 15px; font-weight: 700; margin-top: 4px">
        {{ displayName(s) }}
      </div>
      <div v-if="unitLabel(s)" class="s">{{ unitLabel(s) }}</div>
    </div>
    <div style="text-align: right; flex: none; max-width: 48%">
      <div class="price" style="margin-top: 0"><PriceLine :special="s" detail align="right" /></div>
      <div v-if="tag" style="margin-top: 5px"><TagChip :tag="tag" /></div>
    </div>
  </RouterLink>
</template>
