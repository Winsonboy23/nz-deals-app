<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Special } from '../lib/types'
import { catLevel, chainClass, imageFor } from '../lib/format'
import { useCategories } from '../composables/useCategories'
import { catName } from '../composables/useI18n'

const props = withDefaults(
  defineProps<{ special: Special; variant?: 'thumb' | 'tn' | 'sq' | 'big' }>(),
  { variant: 'thumb' },
)
const { nameOf } = useCategories()
const failed = ref(false)
const src = computed(() => imageFor(props.special))
watch(src, () => (failed.value = false))

const cls = computed(() => {
  const base = props.variant === 'thumb' ? 'thumb' : 'tn'
  const extra = props.variant === 'sq' ? ' sq' : ''
  return `${base}${extra} ${chainClass(props.special.store_id)}`
})
const placeholder = computed(() =>
  catName(nameOf(catLevel(props.special.category_id, 3) ?? props.special.category_id)),
)
</script>

<template>
  <div :class="[cls, { ph: !src || failed }]">
    <img
      v-if="src && !failed"
      :src="src"
      :alt="special.name"
      loading="lazy"
      decoding="async"
      @error="failed = true"
    />
    <span v-else>{{ placeholder }}</span>
    <slot />
  </div>
</template>
