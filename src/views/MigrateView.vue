<script setup lang="ts">
// 換網域搬家（新網址這邊）：舊網址帶著訪客資料跳來 #/migrate?d=…（main.ts），寫進這個網址的 localStorage。
// 各 composable 只在載入時讀一次 localStorage，所以搬完整頁重載回首頁才生效。沒有 d 或解不開就直接回首頁。
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { decodePayload, importGuestData } from '../lib/migrate'
import { t } from '../composables/useI18n'

const route = useRoute()
const router = useRouter()
const moved = ref(false)

onMounted(() => {
  const data = typeof route.query.d === 'string' ? decodePayload(route.query.d) : null
  if (!data) {
    void router.replace('/')
    return
  }
  try {
    importGuestData(localStorage, data)
  } catch {
    /* 瀏覽器不給寫（封鎖網站資料、空間滿）就算了，照樣回首頁 */
  }
  moved.value = true
  setTimeout(() => {
    // 只換 # 後面的網址不會重新載入，所以先把網址改成首頁再 reload
    history.replaceState(null, '', import.meta.env.BASE_URL + '#/')
    location.reload()
  }, 1000)
})
</script>

<template>
  <div class="screen">
    <div v-if="moved" class="pad" style="margin-top: 56px">
      <div class="h2">{{ t('migrate.done') }}</div>
    </div>
  </div>
</template>
