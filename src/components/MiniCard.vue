<script setup lang="ts">
import { computed } from 'vue'
import TagChip from './TagChip.vue'
import { primaryTag } from '../lib/compare'
import { chainClass, displayName, money, wasPriceOf } from '../lib/format'
import type { Offer } from '../lib/types'

const props = defineProps<{ offer: Offer }>()
const s = computed(() => props.offer.special)
const tag = computed(() => primaryTag(s.value))
const was = computed(() => wasPriceOf(s.value))
const to = computed(() => (s.value.product_key ? `/p/${encodeURIComponent(s.value.product_key)}` : ''))
</script>

<template>
  <RouterLink class="mini" :to="to">
    <div class="bar" :class="chainClass(offer.store.id)" />
    <div style="min-width: 0">
      <div class="price">
        {{ money(s.price) }}<span v-if="was" class="was">{{ money(was) }}</span>
      </div>
      <div class="name">{{ displayName(s) }}</div>
      <TagChip v-if="tag" :tag="tag" />
    </div>
  </RouterLink>
</template>
