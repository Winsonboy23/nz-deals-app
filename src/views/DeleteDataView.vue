<script setup lang="ts">
// 刪除資料說明（2026-09-30）：Meta 開發者後台的「資料刪除說明網址」填這頁；沒選過店也打得開（main.ts）。內文在 data/legal.ts。
import LegalText from '../components/LegalText.vue'
import { lang, t } from '../composables/useI18n'
import { DELETE_DATA, LEGAL_UPDATED } from '../data/legal'
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px">
      <RouterLink class="back" to="/me">‹ {{ t('me.title') }}</RouterLink>
      <div class="h1" style="margin-top: 8px">{{ t('legal.deleteData') }}</div>
      <div class="sub muted" style="margin-top: 8px">{{ t('legal.updated', { d: LEGAL_UPDATED }) }}</div>
    </div>
    <div class="pad"><LegalText :paras="DELETE_DATA[lang]" /></div>
  </div>
</template>
