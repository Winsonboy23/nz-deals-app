<script setup lang="ts">
// Facebook／IG／Messenger／LINE 的內建瀏覽器：Google 登入在裡面會失敗（disallowed_useragent），提示換瀏覽器開（2026-09-30）。
// 按 ✕ 關掉就這次開啟不再出現（sessionStorage）；登入頁一定顯示、不能關。
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { t } from '../composables/useI18n'

const ua = navigator.userAgent
const inApp = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\//i.test(ua)
const android = /Android/i.test(ua)

const route = useRoute()
const onSignIn = computed(() => route.path === '/signin')

const KEY = 'nzd:iabClosed'
const closed = ref(false)
try {
  closed.value = sessionStorage.getItem(KEY) === '1'
} catch {
  // 內建瀏覽器可能不給用 storage：當作沒關過
}
function close() {
  closed.value = true
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    // 存不了就只關到重新整理為止
  }
}

/** Android 直接叫 Chrome 開同一頁（hash 路由一起帶過去；Android 認的是最後一個 #Intent;）。iPhone 沒有程式化的辦法。 */
const chromeUrl = computed(() => `intent://${location.host}${location.pathname}#${route.fullPath}#Intent;scheme=https;package=com.android.chrome;end`)
</script>

<template>
  <div v-if="inApp && (onSignIn || !closed)" class="pad" style="margin-top: 12px">
    <div class="box" style="padding: 10px 12px; display: flex; gap: 10px; align-items: flex-start">
      <div style="flex: 1; min-width: 0">
        <div style="font-size: 14px; line-height: 1.45">{{ t('auth.inApp') }}</div>
        <a v-if="android" class="btn ghost" :href="chromeUrl" style="height: 40px; margin-top: 8px; font-size: 15px">{{ t('auth.openChrome') }}</a>
      </div>
      <button v-if="!onSignIn" class="link" style="flex: none" @click="close">✕</button>
    </div>
  </div>
</template>
