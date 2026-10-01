<script setup lang="ts">
import { computed } from 'vue'
import ProductThumb from './ProductThumb.vue'
import TagChip from './TagChip.vue'
import PriceLine from './PriceLine.vue'
import { primaryTag, rankPrice } from '../lib/compare'
import { chainClass, displayName, money } from '../lib/format'
import { chainBadge, t } from '../composables/useI18n'
import type { Group, Offer } from '../lib/types'

const props = defineProps<{ offer: Offer; group?: Group | null; variants?: number }>()

const s = computed(() => props.offer.special)
const tag = computed(() => primaryTag(s.value))
const isBest = computed(
  () => !!props.group && props.group.offers.length >= 2 && props.group.best.store.id === props.offer.store.id,
)
const others = computed(() => {
  const g = props.group
  if (!g || g.offers.length < 2) return ''
  const rest = g.offers.filter((o) => o.store.id !== props.offer.store.id)
  if (!rest.length) return ''
  return t('cmp.others', { v: rest.map((o) => money(rankPrice(o.special))).join(' · ') })
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
      <!-- 圖片下緣：折扣標在左、「N 款」在右；卡片窄放不下時「N 款」自己換到上一行，不會疊在一起 -->
      <span v-if="tag || (variants && variants > 1)" class="thumb-foot">
        <TagChip v-if="tag" :tag="tag" deal />
        <span v-if="variants && variants > 1" class="tag variants">{{ t('card.variants', { n: variants }) }}</span>
      </span>
    </ProductThumb>
    <div class="price"><PriceLine :special="s" detail unit /></div>
    <div class="name">{{ displayName(s) }}</div>
    <div v-if="others" class="others">{{ others }}</div>
  </RouterLink>
</template>
