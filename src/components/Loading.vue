<script setup lang="ts">
/** 抓資料時的轉圈：整塊置中（預設）或一行小字（inline）。文字不給就寫「載入中…」。 */
import { t } from '../composables/useI18n'

withDefaults(defineProps<{ text?: string; inline?: boolean }>(), { text: '', inline: false })
</script>

<template>
  <div class="loading" :class="{ inline }" role="status" aria-live="polite">
    <svg class="spin" :width="inline ? 16 : 30" :height="inline ? 16 : 30" viewBox="0 0 46 46" aria-hidden="true">
      <circle cx="23" cy="23" r="19" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="86 120" />
    </svg>
    <span>{{ text || t('common.loading') }}</span>
  </div>
</template>

<style scoped>
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 36px 0;
  color: var(--ink-2);
  font-size: 14px;
}
.loading.inline {
  flex-direction: row;
  justify-content: flex-start;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
}
</style>
