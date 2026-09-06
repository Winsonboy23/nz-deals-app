<script setup lang="ts">
import { computed } from 'vue'
import ProductThumb from './ProductThumb.vue'
import TagChip from './TagChip.vue'
import { primaryTag, dealPrice } from '../lib/compare'
import { chainClass, displayName, money, priceSuffix, unitLabel, wasPriceOf } from '../lib/format'
import { chainBadge, t } from '../composables/useI18n'
import type { Group, Offer } from '../lib/types'

const props = defineProps<{ offer: Offer; group?: Group | null }>()

const s = computed(() => props.offer.special)
const tag = computed(() => primaryTag(s.value))
const was = computed(() => wasPriceOf(s.value))
const unit = computed(() => unitLabel(s.value))
const isBest = computed(
  () => !!props.group && props.group.offers.length >= 2 && props.group.best.store.id === props.offer.store.id,
)
const others = computed(() => {
  const g = props.group
  if (!g || g.offers.length < 2) return ''
  const rest = g.offers.filter((o) => o.store.id !== props.offer.store.id)
  if (!rest.length) return ''
  return t('cmp.others', { v: rest.map((o) => money(dealPrice(o.special))).join(' · ') })
})
const to = computed(() => (s.value.product_key ? `/p/${encodeURIComponent(s.value.product_key)}` : ''))
</script>

<template>
  <RouterLink class="card" :to="to">
    <ProductThumb :special="s">
      <span v-if="isBest" class="tag best" :class="chainClass(offer.store.id)">
        ✓ {{ chainBadge(offer.store.id) }}
      </span>
      <span v-else class="dot" :class="chainClass(offer.store.id)" />
      <TagChip v-if="tag" :tag="tag" deal />
    </ProductThumb>
    <div class="price">
      {{ money(s.price) }}<span v-if="priceSuffix(s)" class="unit">{{ priceSuffix(s) }}</span>
    </div>
    <div class="meta">
      <s v-if="was">{{ money(was) }}</s>
      <span v-if="was && unit"> · </span>
      <span v-if="unit">{{ unit }}</span>
    </div>
    <div class="name">{{ displayName(s) }}</div>
    <div v-if="others" class="others">{{ others }}</div>
  </RouterLink>
</template>
