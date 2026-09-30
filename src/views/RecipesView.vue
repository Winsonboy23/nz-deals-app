<script setup lang="ts">
import { computed, ref } from 'vue'
import { bi, recipeImg, useRecipes, type RankedRecipe, isIllustration } from '../composables/useRecipes'
import { useStores } from '../composables/useStores'
import { useSpecials } from '../composables/useSpecials'
import Loading from '../components/Loading.vue'
import { t } from '../composables/useI18n'
import { chainClass, money } from '../lib/format'
import { nzMonday } from '../lib/week'

const { ranked } = useRecipes()
const { selectedStores } = useStores()
const { loading, totalSpecials } = useSpecials()
/** 上方篩選：快速看分鐘數，其他三個看食譜的 blocks */
const FILTERS = [
  ['all', 'recipes.all'],
  ['one-pot', 'recipes.onePot'],
  ['batch', 'recipes.batch'],
  ['no-cook', 'recipes.noCook'],
  ['quick', 'recipes.quick'],
] as const
const filter = ref<(typeof FILTERS)[number][0]>('all')
const list = computed(() =>
  ranked.value.filter((r) => {
    const f = filter.value
    if (f === 'all') return true
    if (f === 'quick') return r.recipe.minutes <= 30
    return r.recipe.blocks.includes(f)
  }),
)
/** 瀑布流：卡片左右交替放兩欄；照片 4:5 和 1:1 在同一欄裡交替、兩欄相反（左欄從 1:1 開始），右欄再往下推 28px，兩欄就不會對齊 */
function colsOf(rs: RankedRecipe[]) {
  const out: { r: RankedRecipe; tall: boolean }[][] = [[], []]
  rs.forEach((r, i) => out[i % 2].push({ r, tall: i % 4 === 1 || i % 4 === 2 }))
  return out
}
/** 本週精選（weekStart = 這週一）排在常備食譜前面，兩段各照原本的排法；有本週精選才分段加小標，沒有就跟以前一樣一整片 */
const monday = nzMonday()
const sections = computed(() => {
  const weekly = list.value.filter((r) => r.recipe.weekStart === monday)
  if (!weekly.length) return [{ label: '', cols: colsOf(list.value) }]
  const rest = list.value.filter((r) => r.recipe.weekStart !== monday)
  return [
    { label: 'recipes.weekly', cols: colsOf(weekly) },
    ...(rest.length ? [{ label: 'recipes.library', cols: colsOf(rest) }] : []),
  ]
})
</script>

<template>
  <div class="screen">
    <div class="pad hrow" style="margin-top: 14px">
      <div class="h1">{{ t('recipes.title') }}</div>
      <RouterLink class="pill soft" to="/stores" style="flex: none">
        <span class="dots"><span v-for="s in selectedStores" :key="s.id" class="dot" :class="chainClass(s.id)" /></span>
        {{ t('common.stores', { n: selectedStores.length }) }}
      </RouterLink>
    </div>
    <div class="pad sub" style="margin-top: 8px">{{ t('recipes.sub') }}</div>

    <div class="chips nowrap" style="margin: 12px 0 0 var(--gutter)">
      <button v-for="[id, label] in FILTERS" :key="id" class="chip" :class="{ on: filter === id }" @click="filter = id">{{ t(label) }}</button>
    </div>

    <div v-if="!selectedStores.length" class="pad" style="margin-top: 14px">
      <RouterLink class="empty sub" to="/stores" style="display: block">{{ t('recipes.noStores') }}</RouterLink>
    </div>

    <Loading v-if="selectedStores.length && loading && !totalSpecials" />
    <div v-else-if="!list.length" class="pad sub" style="margin-top: 14px">{{ t('recipes.emptyGroup') }}</div>
    <template v-else>
      <template v-for="sec in sections" :key="sec.label">
        <div v-if="sec.label" class="pad sec rc-sec">{{ t(sec.label) }}</div>
        <div class="pad rc-cols">
          <div v-for="(col, c) in sec.cols" :key="c" class="rc-col">
            <RouterLink v-for="{ r, tall } in col" :key="r.recipe.id" class="rc" :to="`/recipes/${r.recipe.id}`">
              <div class="rc-img" :class="{ tall }">
                <img :src="recipeImg(r.recipe.image)" :alt="bi(r.recipe.title)" loading="lazy" decoding="async" />
                <span v-if="isIllustration(r.recipe)" class="rc-ill">{{ t('recipes.illustration') }}</span>
                <span v-if="r.chains.length" class="dots rc-dots"><span v-for="ch in r.chains" :key="ch" class="dot" :class="chainClass(ch + ':x')" /></span>
              </div>
              <div class="rc-body">
                <div class="rc-t">{{ bi(r.recipe.title) }}</div>
                <div class="rc-s">
                  ⏱ {{ t('recipes.minutes', { n: r.recipe.minutes }) }}<template v-if="Number.isFinite(r.perServe)"> · {{ t('recipes.perServe', { v: money(r.perServe) }) }}</template>
                </div>
              </div>
            </RouterLink>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* 瀑布流兩欄：右欄整欄往下推 28px，兩欄故意不對齊 */
.rc-cols { display: flex; align-items: flex-start; gap: var(--gutter); margin-top: 12px; }
.rc-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--gutter); }
.rc-col + .rc-col { margin-top: 28px; }
.rc {
  display: block;
  border: 1px solid var(--line);
  border-radius: var(--r);
  overflow: hidden;
  background: var(--paper);
  color: inherit;
  text-decoration: none;
}
.rc:active { transform: scale(0.985); }
.rc-img { position: relative; aspect-ratio: 1 / 1; background: var(--paper-2); }
.rc-img.tall { aspect-ratio: 4 / 5; }
.rc-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rc-dots { position: absolute; left: 7px; bottom: 7px; padding: 4px 5px; border-radius: 8px; background: var(--paper); }
.rc-sec { margin-top: 20px; }
/* AI 生的圖：右上角小字「示意圖」 */
.rc-ill { position: absolute; right: 7px; top: 7px; padding: 3px 6px; border-radius: 6px; background: var(--paper); color: var(--ink-2); font-size: 10.5px; font-weight: 700; line-height: 1.2; }
.rc-body { padding: 9px 10px 10px; }
.rc-t {
  font-family: 'Inter Tight', Inter, sans-serif;
  font-weight: 800;
  font-size: 15px;
  line-height: 1.2;
  letter-spacing: -0.2px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.rc-s { margin-top: 4px; font-size: 12.5px; color: var(--ink-2); line-height: 1.3; }
</style>
