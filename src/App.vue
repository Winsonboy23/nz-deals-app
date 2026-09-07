<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import TabBar from './components/TabBar.vue'
import ProductSheet from './components/ProductSheet.vue'
import { useStores } from './composables/useStores'
import { useSpecials } from './composables/useSpecials'
import { useCategories } from './composables/useCategories'
import { lang } from './composables/useI18n'
import { useSync } from './composables/useSync'

const route = useRoute()
const router = useRouter()
const { loadStores, selectedIds } = useStores()
const { load } = useSpecials()
const { loadCategories } = useCategories()
useSync()   // 登入後店／清單／關注跟帳號同步

// The product sheet sits over the page you came from. useRoute() always points at the *current*
// route, so we keep the path of the last non-sheet page rather than the route object.
const backPath = ref(route.meta.sheet ? '/' : route.fullPath)
watch(route, (r) => {
  if (!r.meta.sheet) backPath.value = r.fullPath
})
const bg = computed(
  () =>
    (route.meta.sheet ? router.resolve(backPath.value) : route) as RouteLocationNormalizedLoaded,
)
const sheetKey = computed(() => (route.meta.sheet ? String(route.params.key) : ''))
const showTabs = computed(() => !bg.value.meta.noTabs)

watchEffect(() => {
  document.body.classList.toggle('zh', lang.value === 'zh')
  document.documentElement.lang = lang.value === 'zh' ? 'zh-Hant' : 'en'
})

onMounted(async () => {
  await Promise.all([loadStores(), loadCategories()])
  if (selectedIds.value.length) await load()
})

function closeSheet() {
  void router.replace(backPath.value)
}
</script>

<template>
  <RouterView v-slot="{ Component }" :route="bg">
    <Transition name="page" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>
  <Transition name="sheet">
    <ProductSheet v-if="sheetKey" :pkey="sheetKey" @close="closeSheet" />
  </Transition>
  <TabBar v-if="showTabs" />
</template>
