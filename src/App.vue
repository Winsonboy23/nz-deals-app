<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import TabBar from './components/TabBar.vue'
import ProductSheet from './components/ProductSheet.vue'
import LoadingBar from './components/LoadingBar.vue'
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

// 從背景切回來：問一下店有沒有新抓過（last_fetched_at），有就重拿。以前只在啟動時拿，App 掛在背景的人一直看舊的（2026-09-17）。
// 5 分鐘內問過就不再問，免得每次切視窗都打 Supabase。
let lastCheck = Date.now()
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 5 * 60_000) return
  lastCheck = Date.now()
  await loadStores()
  if (selectedIds.value.length) await load()
})

function closeSheet() {
  void router.replace(backPath.value)
}
</script>

<template>
  <LoadingBar />
  <RouterView v-slot="{ Component }" :route="bg">
    <Transition name="page" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>
  <!-- Vue 只看「根元素」有沒有 transition 來決定等多久才把它拿掉。商品面板的根是一層空 div，
       動畫寫在裡面的 .bsheet / .dim 上，所以 Vue 以為 0 秒 → 關的時候直接消失。講明時間它才會等。 -->
  <Transition name="sheet" :duration="{ enter: 340, leave: 300 }">
    <ProductSheet v-if="sheetKey" :pkey="sheetKey" @close="closeSheet" />
  </Transition>
  <TabBar v-if="showTabs" />
</template>
