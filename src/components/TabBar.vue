<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { t } from '../composables/useI18n'

const route = useRoute()
const active = computed(() => (route.meta.tab as string) ?? '')
</script>

<template>
  <nav class="tabbar">
    <RouterLink class="tab" :class="{ active: active === 'specials' }" to="/">
      <svg viewBox="0 0 24 24">
        <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
        <circle cx="8" cy="8" r="1.5" />
      </svg>
      {{ t('tab.specials') }}
    </RouterLink>
    <RouterLink class="tab" :class="{ active: active === 'browse' }" to="/browse">
      <svg viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
      {{ t('tab.browse') }}
    </RouterLink>
    <RouterLink class="tab" :class="{ active: active === 'recipes' }" to="/recipes">
      <svg viewBox="0 0 24 24">
        <path d="M6 14a4 4 0 1 1 1.2-7.8A5 5 0 0 1 16.8 6.2 4 4 0 1 1 18 14v6H6v-6Z" />
        <path d="M6 17h12" />
      </svg>
      {{ t('tab.recipes') }}
    </RouterLink>
    <RouterLink class="tab" :class="{ active: active === 'list' }" to="/list">
      <svg viewBox="0 0 24 24">
        <path d="M9 6h12M9 12h12M9 18h12" />
        <path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17" />
      </svg>
      {{ t('tab.list') }}
    </RouterLink>
    <RouterLink class="tab" :class="{ active: active === 'me' }" to="/me">
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
      {{ t('tab.me') }}
    </RouterLink>
  </nav>
</template>
