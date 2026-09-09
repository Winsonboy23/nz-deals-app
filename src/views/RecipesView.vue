<script setup lang="ts">
import { computed, ref } from 'vue'
import { bi, useRecipes } from '../composables/useRecipes'
import { useStores } from '../composables/useStores'
import { t } from '../composables/useI18n'
import { chainClass, chainName, chainShort, money } from '../lib/format'
import { useAuth } from '../composables/useAuth'
import { aiEnabled } from '../lib/aiRecipe'

const { ranked } = useRecipes()
const { selectedStores } = useStores()
const { isIn } = useAuth()
const filter = ref<'all' | 'quick'>('all')
const list = computed(() => ranked.value.filter((r) => filter.value === 'all' || r.recipe.minutes <= 30))
const base = import.meta.env.BASE_URL
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
    <div v-if="aiEnabled && selectedStores.length" class="pad" style="margin-top: 12px">
      <RouterLink class="aihome" :to="isIn ? '/ai-recipes?from=week' : '/signin'">{{ isIn ? t('ai.homeEntry') : t('ai.homeEntrySignIn') }}</RouterLink>
    </div>

    <div class="chips nowrap" style="margin: 12px 0 0 var(--gutter)">
      <button class="chip" :class="{ on: filter === 'all' }" @click="filter = 'all'">{{ t('recipes.recommended') }}</button>
      <button class="chip" :class="{ on: filter === 'quick' }" @click="filter = 'quick'">{{ t('recipes.under30') }}</button>
    </div>

    <div v-if="!selectedStores.length" class="pad" style="margin-top: 14px">
      <RouterLink class="empty sub" to="/stores" style="display: block">{{ t('recipes.noStores') }}</RouterLink>
    </div>

    <div class="pad" style="margin-top: 6px">
      <RouterLink v-for="r in list" :key="r.recipe.id" class="rc" :to="`/recipes/${r.recipe.id}`">
        <div class="rc-img">
          <img :src="base + r.recipe.image" :alt="bi(r.recipe.title)" loading="lazy" decoding="async" />
          <span class="rc-rank">{{ r.rank }}</span>
        </div>
        <div class="rc-body">
          <div class="h3 ell">{{ bi(r.recipe.title) }}</div>
          <div class="s" style="margin-top: 3px">
            <template v-if="r.recipe.cuisineName"><b>{{ bi(r.recipe.cuisineName) }}</b> · </template>{{ t('recipes.meta', { serves: r.recipe.serves, min: r.recipe.minutes }) }} · {{ t('recipes.' + r.recipe.difficulty) }}<template v-if="Number.isFinite(r.perServe)"> · {{ t('recipes.perServe', { v: money(r.perServe) }) }}</template>
          </div>
          <div class="rc-bar">
            <div class="pbar"><i :style="{ width: (r.total ? (r.onSpecial / r.total) * 100 : 0) + '%' }" /></div>
            <div class="rc-onsp">{{ t('recipes.onSpecial', { n: r.onSpecial, m: r.total }) }}</div>
          </div>
          <div v-if="r.chains.length" class="s rc-stores">
            <span class="dots"><span v-for="c in r.chains" :key="c" class="dot" :class="chainClass(c + ':x')" /></span>
            <span class="ell">{{ r.chains.map((c) => (r.chains.length > 2 ? chainShort(c + ':x') : chainName(c + ':x'))).join(' · ') }}</span>
          </div>
        </div>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.aihome { display: block; border: 1.5px dashed var(--ink); border-radius: var(--r); padding: 12px 14px; font-weight: 800; font-size: 14.5px; color: inherit; text-decoration: none; }
.aihome:active { background: var(--paper-2); }
.rc {
  display: flex;
  border: 1px solid var(--line);
  border-radius: var(--r);
  overflow: hidden;
  margin-top: 10px;
  background: var(--paper);
  color: inherit;
  text-decoration: none;
}
.rc:active { transform: scale(0.985); }
.rc-img { width: 112px; flex: none; position: relative; background: var(--paper-2); }
.rc-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rc-rank {
  position: absolute;
  left: 8px;
  top: 8px;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--ink);
  color: #fff;
  font-family: 'Inter Tight', Inter, sans-serif;
  font-weight: 900;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rc-body { flex: 1; min-width: 0; padding: 11px 12px 10px; }
.rc-body .s { font-size: 12.5px; color: var(--ink-2); line-height: 1.3; }
.rc-bar { display: flex; align-items: center; gap: 10px; margin-top: 9px; }
.rc-onsp { font-size: 13px; font-weight: 800; flex: none; }
.rc-stores { display: flex; align-items: center; gap: 7px; margin-top: 6px; min-width: 0; }
</style>
