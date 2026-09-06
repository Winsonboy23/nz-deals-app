<script setup lang="ts">
import { t } from '../composables/useI18n'
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 14px"><div class="h1">{{ t('recipes.title') }}</div></div>
    <div class="pad" style="margin-top: 20px">
      <div class="empty">
        <div style="font-size: 22px; color: #c4c4c0; line-height: 1">☺</div>
        <div class="h3" style="margin-top: 9px; font-size: 15.5px">{{ t('recipes.soon') }}</div>
        <div class="s" style="margin-top: 6px; line-height: 1.5">{{ t('recipes.body') }}</div>
      </div>
    </div>
  </div>
</template>
