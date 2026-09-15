<script setup lang="ts">
// 折扣徽章（半價／省 N%／省 $N／低價標籤）。會員卡、湊件不是折扣是條件，改在 PriceLine 的價格旁邊標（2026-09-15）。
import { computed } from 'vue'
import type { Tag } from '../lib/compare'
import { money } from '../lib/format'
import { t } from '../composables/useI18n'

const props = defineProps<{ tag: Tag; deal?: boolean }>()

const label = computed(() => {
  const g = props.tag
  switch (g.kind) {
    case 'half':
      return t('tag.half')
    case 'pct':
      return t('tag.pct', { p: g.pct ?? 0 })
    case 'save':
      return t('tag.save', { v: money(g.amount ?? 0) })
    default:
      return t('tag.low')
  }
})
</script>

<template>
  <span class="tag" :class="[tag.kind, { deal }]">{{ label }}</span>
</template>
