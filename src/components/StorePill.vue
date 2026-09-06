<script setup lang="ts">
import { computed } from 'vue'
import { useStores } from '../composables/useStores'
import { chainClass, chainName } from '../lib/format'
import { t } from '../composables/useI18n'

const { selectedStores } = useStores()

/** "New World Greymouth" / "Greymouth Woolworths" → "Greymouth" */
const town = computed(() => {
  const first = selectedStores.value[0]
  if (!first) return ''
  return first.name.replace(chainName(first.id), '').replace(/\s+/g, ' ').trim() || first.name
})
</script>

<template>
  <RouterLink class="pill" to="/stores">
    <span class="dots">
      <span v-for="s in selectedStores" :key="s.id" class="dot" :class="chainClass(s.id)" />
    </span>
    <span v-if="town">{{ town }} · </span>{{ t('common.stores', { n: selectedStores.length }) }} ›
  </RouterLink>
</template>
