<script setup lang="ts">
import { useSpecials } from '../composables/useSpecials'
import { useStores } from '../composables/useStores'
import { chainClass } from '../lib/format'
import { shortDate } from '../lib/week'
import { lang, t } from '../composables/useI18n'

const { staleStores, emptyStores } = useSpecials()
const { selectedStores } = useStores()
void selectedStores
</script>

<template>
  <div v-if="staleStores.length || emptyStores.length" class="pad" style="margin-top: 12px">
    <div class="box" style="padding: 10px 12px">
      <div
        v-for="d in staleStores"
        :key="d.store.id"
        style="display: flex; gap: 10px; align-items: center; padding: 4px 0"
      >
        <div class="bar" :class="chainClass(d.store.id)" style="height: 28px; opacity: 0.4" />
        <div style="flex: 1; min-width: 0">
          <div class="h3 ell" style="font-size: 14.5px">{{ d.store.name }}</div>
          <div class="s ell">{{ t('store.stale') }}</div>
        </div>
        <div class="small muted" style="flex: none">{{ shortDate(d.week!, lang) }}</div>
      </div>
      <div
        v-for="d in emptyStores"
        :key="d.store.id"
        style="display: flex; gap: 10px; align-items: center; padding: 4px 0"
      >
        <div class="bar" :class="chainClass(d.store.id)" style="height: 28px; opacity: 0.4" />
        <div style="flex: 1; min-width: 0">
          <div class="h3 ell" style="font-size: 14.5px">{{ d.store.name }}</div>
          <div class="s ell">{{ t('stores.noWeekData') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
