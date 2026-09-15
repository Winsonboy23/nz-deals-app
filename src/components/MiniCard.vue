<script setup lang="ts">
import { computed } from 'vue'
import TagChip from './TagChip.vue'
import PriceLine from './PriceLine.vue'
import { primaryTag } from '../lib/compare'
import { chainClass, displayName } from '../lib/format'
import type { Offer } from '../lib/types'

const props = defineProps<{ offer: Offer }>()
const s = computed(() => props.offer.special)
const tag = computed(() => primaryTag(s.value))
const to = computed(() => (s.value.product_key ? `/p/${encodeURIComponent(s.value.product_key)}` : ''))
</script>

<template>
  <RouterLink class="mini" :to="to">
    <div class="bar" :class="chainClass(offer.store.id)" />
    <div style="min-width: 0">
      <div class="price"><PriceLine :special="s" detail /></div>
      <div class="name">{{ displayName(s) }}</div>
      <TagChip v-if="tag" :tag="tag" />
    </div>
  </RouterLink>
</template>
