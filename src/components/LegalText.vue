<script setup lang="ts">
// 隱私權政策／刪除資料說明的內文（data/legal.ts）：'# ' 小標題、'- ' 列點、其他是段落；段落裡的聯絡信箱變成可以點的 mailto。
import { CONTACT_EMAIL } from '../data/legal'

defineProps<{ paras: string[] }>()
</script>

<template>
  <template v-for="(p, i) in paras" :key="i">
    <div v-if="p.startsWith('# ')" class="h3" style="margin-top: 22px">{{ p.slice(2) }}</div>
    <div v-else-if="p.startsWith('- ')" style="display: flex; gap: 8px; margin-top: 6px; font-size: 15px; line-height: 1.55">
      <span style="flex: none">•</span><span>{{ p.slice(2) }}</span>
    </div>
    <p v-else style="margin-top: 10px; font-size: 15px; line-height: 1.6">
      <template v-for="(part, j) in p.split(CONTACT_EMAIL)" :key="j"><a v-if="j" :href="`mailto:${CONTACT_EMAIL}`" style="font-weight: 600; text-decoration: underline">{{ CONTACT_EMAIL }}</a>{{ part }}</template>
    </p>
  </template>
</template>
