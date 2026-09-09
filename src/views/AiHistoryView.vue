<script setup lang="ts">
// 我的 → 食譜紀錄：AI 生成過的每道菜，新的在前。點進去看完整食譜，垃圾桶刪掉那筆。
import { onMounted, ref } from 'vue'
import { historyDelete, historyList, type AiRecipe } from '../lib/aiRecipe'
import { useAuth } from '../composables/useAuth'
import { lang, t } from '../composables/useI18n'

const { isIn } = useAuth()
const list = ref<AiRecipe[]>([])
const loading = ref(true)
onMounted(async () => {
  if (isIn.value) list.value = await historyList()
  loading.value = false
})
async function del(id: string) {
  list.value = list.value.filter((r) => r.dbId !== id)
  await historyDelete(id)
}
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(lang.value === 'zh' ? 'zh-TW' : 'en-NZ', { month: 'short', day: 'numeric' }) : '')
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px"><RouterLink class="back" to="/me">‹ {{ t('me.title') }}</RouterLink></div>
    <div class="pad" style="margin-top: 8px"><div class="h1">{{ t('me.recipes') }}</div></div>

    <div v-if="!isIn" class="pad" style="margin-top: 14px">
      <div class="empty sub">{{ t('ai.needSignIn') }}<div style="margin-top: 12px"><RouterLink class="btn ghost" to="/signin" style="height: 42px; font-size: 15px">{{ t('common.signIn') }}</RouterLink></div></div>
    </div>
    <div v-else-if="loading" class="pad" style="margin-top: 14px"><div v-for="i in 3" :key="i" class="skel" style="height: 60px; margin-top: 8px" /></div>
    <div v-else-if="!list.length" class="pad" style="margin-top: 14px">
      <div class="empty sub">{{ t('ai.historyEmpty') }}<div style="margin-top: 12px"><RouterLink class="btn ghost" to="/list" style="height: 42px; font-size: 15px">{{ t('ai.backList') }}</RouterLink></div></div>
    </div>
    <div v-else class="pad" style="margin-top: 12px">
      <div class="box">
        <div v-for="r in list" :key="r.dbId ?? r.title" class="lrow" style="padding: 10px 12px; gap: 8px">
          <RouterLink class="grow hl" :to="`/me/recipes/${r.dbId}`" style="min-width: 0">
            <div class="t ell">{{ r.title }}</div>
            <div class="s ell">{{ r.cuisine }} · {{ r.minutes }} min · {{ day(r.createdAt) }}</div>
          </RouterLink>
          <button class="del" :aria-label="t('ai.delete')" @click="del(r.dbId as string)">
            <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hl { color: inherit; text-decoration: none; display: block; }
.del { width: 32px; height: 32px; flex: none; display: flex; align-items: center; justify-content: center; color: var(--ink-3); background: none; }
.del svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
</style>
