<script setup lang="ts">
// 首頁的小卡（2026-10-01 改版，照設計稿）：圖在上、橘色折扣角標、品名、劃掉的原價＋現價（價格照樣走 PriceLine，[卡]、湊件不會漏標）。
// 店色圓點（加白邊）一律在左上角、角標在右上角（Chris 首頁改版規格 §三：商品圖上的超市標示只放左上角的小圓點）。
// kind="fresh"：生鮮特價橫滑，角標寫折扣（半價／省 N%／省 $N），沒有折扣資訊（黃超只有低價標籤）就不放；
// kind="half"：瘋狂半價兩欄格子，角標寫實際折數。
import { computed } from 'vue'
import ProductThumb from './ProductThumb.vue'
import TagChip from './TagChip.vue'
import PriceLine from './PriceLine.vue'
import { discountDepth, primaryTag, type Tag } from '../lib/compare'
import { chainClass, displayName } from '../lib/format'
import type { Offer } from '../lib/types'

const props = defineProps<{ offer: Offer; kind: 'fresh' | 'half' }>()
const s = computed(() => props.offer.special)
const to = computed(() => (s.value.product_key ? `/p/${encodeURIComponent(s.value.product_key)}` : ''))
const tag = computed<Tag | null>(() => {
  if (props.kind === 'half') return { kind: 'pct', pct: Math.round(discountDepth(s.value) * 100) }
  const g = primaryTag(s.value)
  return g && g.kind !== 'low' ? g : null
})
/** 按公斤賣的，大字本身就是每公斤價，說明行不再重複寫單價 */
const perKg = computed(() => (s.value.price_unit ?? '').toLowerCase() === 'kg')
</script>

<template>
  <RouterLink class="mini" :class="kind" :to="to">
    <div class="mn-img">
      <ProductThumb :special="s" class="mn-tn" />
      <TagChip v-if="tag" :tag="tag" class="mn-tag" />
      <span class="dot mn-dot" :class="chainClass(offer.store.id)" />
    </div>
    <div class="mn-name">{{ displayName(s) }}</div>
    <div class="mn-price"><PriceLine :special="s" detail :unit="!perKg" was-first /></div>
  </RouterLink>
</template>

<style scoped>
.mini {
  flex: none;
  width: 140px;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border-radius: 14px;
  box-shadow: var(--shadow);
  overflow: hidden;
  color: inherit;
  text-decoration: none;
  padding-bottom: 10px;
}
.mini.half { width: auto; }
.mn-img { position: relative; height: 104px; }
.half .mn-img { height: 124px; }
.mn-tn { position: absolute; inset: 10px 12px 2px; width: auto; height: auto; border-radius: 6px; }
/* 角標貼著卡片的右上角，外角讓卡片的圓角切掉，內角自己圓；店色圓點在左上角 */
.mn-tag { position: absolute; top: 0; right: 0; z-index: 2; height: 22px; padding: 0 9px; border-radius: 0 0 0 10px; font-size: 11.5px; }
.mn-dot { position: absolute; top: 8px; left: 8px; z-index: 2; box-shadow: 0 0 0 2px var(--card); }
.mn-name {
  margin-top: 6px;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.mn-price {
  margin-top: auto;
  padding: 6px 10px 0;
  font-family: var(--font);
  font-weight: 800;
  font-size: 18px;
  letter-spacing: -0.3px;
  line-height: 1.05;
}
</style>
