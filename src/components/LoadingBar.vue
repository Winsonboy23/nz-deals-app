<script setup lang="ts">
/** 畫面最上面一條會跑的細線：只要有人在跟 Supabase 拿東西（店、特價、現價）就出現。 */
import { computed } from 'vue'
import { useStores } from '../composables/useStores'
import { useSpecials } from '../composables/useSpecials'
import { useStorePrices } from '../composables/useStorePrices'

const stores = useStores()
const specials = useSpecials()
const prices = useStorePrices()
const busy = computed(() => stores.loading.value || specials.loading.value || prices.loading.value)
</script>

<template>
  <Transition name="fade">
    <div v-if="busy" class="loadbar" aria-hidden="true"><i /></div>
  </Transition>
</template>
