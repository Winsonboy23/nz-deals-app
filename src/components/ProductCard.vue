<script setup lang="ts">
// 商品卡（首頁「這週最划算」橫滑、分類頁格子共用）。照 Chris 首頁改版規格 §2，由上到下：
// 商品圖（左上角店色圓點；左下角折扣標：低價標籤灰底、省 $X／半價橘底；右下角「N 款」白底綠字）→ 價格（[卡] 跟在後面）
// → 說明行只放一樣（一般價／湊件、或劃掉的原價、或單價）→ 品名最多兩行 → 其他店的價。
import { computed } from 'vue'
import ProductThumb from './ProductThumb.vue'
import TagChip from './TagChip.vue'
import PriceLine from './PriceLine.vue'
import { primaryTag, rankPrice } from '../lib/compare'
import { chainClass, displayName, money } from '../lib/format'
import { t } from '../composables/useI18n'
import type { Group, Offer } from '../lib/types'

const props = defineProps<{ offer: Offer; group?: Group | null; variants?: number }>()

const s = computed(() => props.offer.special)
const tag = computed(() => primaryTag(s.value))
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
      <span class="dot" :class="chainClass(offer.store.id)" />
      <!-- 圖片下緣：折扣標在左、「N 款」在右；卡片窄放不下時「N 款」自己換到上一行，不會疊在一起 -->
      <span v-if="tag || (variants && variants > 1)" class="thumb-foot">
        <TagChip v-if="tag" :tag="tag" deal />
        <span v-if="variants && variants > 1" class="tag variants">{{ t('card.variants', { n: variants }) }}</span>
      </span>
    </ProductThumb>
    <div class="price"><PriceLine :special="s" detail unit brief /></div>
    <div class="name">{{ displayName(s) }}</div>
    <div v-if="others" class="others">{{ others }}</div>
  </RouterLink>
</template>
