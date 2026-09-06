<script setup lang="ts">
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
    case 'multi':
      return t('tag.multi', { q: g.qty ?? 0, v: money(g.total ?? 0) })
    case 'club':
      return t('tag.club')
    default:
      return t('tag.low')
  }
})
</script>

<template>
  <span class="tag" :class="[tag.kind, { deal }]">{{ label }}</span>
</template>
