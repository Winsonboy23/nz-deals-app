<script setup lang="ts">
// 隱私權政策（2026-09-30）：開 Facebook 登入要在 Meta 開發者後台填這頁網址；沒選過店也打得開（main.ts）。內文在 data/legal.ts。
import LegalText from '../components/LegalText.vue'
import { lang, t } from '../composables/useI18n'
import { LEGAL_UPDATED, PRIVACY } from '../data/legal'
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px">
      <RouterLink class="back" to="/me">‹ {{ t('me.title') }}</RouterLink>
      <div class="h1" style="margin-top: 8px">{{ t('legal.privacy') }}</div>
      <div class="sub muted" style="margin-top: 8px">{{ t('legal.updated', { d: LEGAL_UPDATED }) }}</div>
    </div>
    <div class="pad"><LegalText :paras="PRIVACY[lang]" /></div>
    <div class="pad" style="margin-top: 24px">
      <div class="box">
        <RouterLink class="lrow tap" to="/delete-data" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('legal.deleteData') }}</div></div>
          <div class="link">›</div>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
