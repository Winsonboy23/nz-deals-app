<script setup lang="ts">
// 食譜紀錄裡的一道：整張攤開，可以把要買的加清單、可以刪掉這筆。
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AiRecipeCard from '../components/AiRecipeCard.vue'
import { historyDelete, historyGet, type AiRecipe } from '../lib/aiRecipe'
import { t } from '../composables/useI18n'

const route = useRoute()
const router = useRouter()
const recipe = ref<AiRecipe | null>(null)
const loading = ref(true)
onMounted(async () => {
  recipe.value = await historyGet(String(route.params.id))
  loading.value = false
})
async function del() {
  if (!recipe.value?.dbId) return
  await historyDelete(recipe.value.dbId)
  void router.replace('/me/recipes')
}
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px"><RouterLink class="back" to="/me/recipes">‹ {{ t('me.recipes') }}</RouterLink></div>
    <div v-if="loading" class="pad" style="margin-top: 14px"><div class="skel" style="height: 220px" /></div>
    <div v-else-if="!recipe" class="pad" style="margin-top: 14px"><div class="empty sub">{{ t('browse.empty') }}</div></div>
    <template v-else>
      <div class="pad" style="margin-top: 10px"><AiRecipeCard :recipe="recipe" :open="true" static /></div>
      <div class="pad" style="margin-top: 14px">
        <button class="btn ghost" style="height: 46px; font-size: 15px; color: #b00020; border-color: #b00020" @click="del">{{ t('ai.delete') }}</button>
        <div class="s muted" style="margin-top: 12px; font-size: 12px; line-height: 1.45">{{ t('ai.disclaimer') }}</div>
      </div>
    </template>
  </div>
</template>
