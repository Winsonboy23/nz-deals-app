<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TagChip from '../components/TagChip.vue'
import { bi, useRecipes, type IngredientMatch } from '../composables/useRecipes'
import { useList } from '../composables/useList'
import { lang, t } from '../composables/useI18n'
import { dealPrice, primaryTag } from '../lib/compare'
import { chainClass, chainName, displayName, money, unitLabel, wasPriceOf } from '../lib/format'

const route = useRoute()
const { byId } = useRecipes()
const { add, addFreeText } = useList()
const r = computed(() => byId(String(route.params.id)))
const base = import.meta.env.BASE_URL
const added = ref(false)
watch(() => route.params.id, () => (added.value = false))

/** 同一家買齊（預設）／每樣各挑最便宜 */
const mode = ref<'one' | 'cheap'>('one')
const view = computed<IngredientMatch[]>(() => (r.value ? (mode.value === 'one' && r.value.oneStore ? r.value.oneStore.matches : r.value.matches) : []))
const adding = computed(() => view.value.filter((m) => !m.ingredient.optional || m.offer))
const priced = computed(() => adding.value.filter((m) => m.offer).length)
const estCost = computed(() => adding.value.reduce((s, m) => s + (m.offer ? dealPrice(m.offer.special) : 0), 0))
const addLabel = computed(() =>
  priced.value
    ? t('recipes.add', { n: adding.value.length, v: money(estCost.value) })
    : t('recipes.addNoPrice', { n: adding.value.length }),
)

/** On-special ingredients go on the list as the matched product (price known); the rest as free text (price unknown, §8 One stop). */
function addAll() {
  for (const m of adding.value) {
    if (m.offer?.special.product_key) add(m.offer.special.product_key, displayName(m.offer.special))
    else addFreeText(bi(m.ingredient.name))
  }
  added.value = true
}

function sub(m: IngredientMatch): string {
  if (!m.offer) return t('recipes.noSpecial')
  const s = m.offer.special
  const parts = [chainName(s.store_id), displayName(s)]
  const was = wasPriceOf(s)
  if (was) parts.push(t('recipes.was', { v: money(was) }))
  const u = unitLabel(s)
  if (u) parts.push(u)
  return parts.join(' · ')
}
const link = (m: IngredientMatch) =>
  m.offer?.special.product_key ? `/p/${encodeURIComponent(m.offer.special.product_key)}` : ''

const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
async function share() {
  if (!r.value) return
  try {
    await navigator.share({ title: bi(r.value.recipe.title), url: location.href })
  } catch {
    /* user cancelled */
  }
}
</script>

<template>
  <div class="screen">
    <template v-if="r">
      <div class="hero">
        <img :src="base + r.recipe.image" :alt="bi(r.recipe.title)" decoding="async" />
        <RouterLink class="hero-back" to="/recipes">‹ {{ t('recipes.back') }}</RouterLink>
        <span class="hero-badge">{{ t('recipes.badge', { n: r.onSpecial, m: r.total, k: r.rank }) }}</span>
      </div>
      <div class="pad credit">
        <a :href="r.recipe.credit.url" target="_blank" rel="noopener">{{ t('recipes.photo', { p: r.recipe.credit.photographer }) }}</a>
      </div>

      <div class="pad" style="margin-top: 10px">
        <div class="h1">{{ bi(r.recipe.title) }}</div>
        <div class="sub" style="margin-top: 8px">
          <template v-if="r.recipe.cuisineName">{{ bi(r.recipe.cuisineName) }} · </template>{{ t('recipes.meta', { serves: r.recipe.serves, min: r.recipe.minutes }) }}
          · {{ t('recipes.' + r.recipe.difficulty) }}
          <template v-if="r.recipe.kcal"> · {{ t('recipes.kcal', { n: r.recipe.kcal }) }}</template>
        </div>
        <div v-if="r.oneStore" class="seg" style="margin-top: 12px">
          <div :class="{ on: mode === 'one' }" @click="mode = 'one'">{{ t('recipes.oneStore', { s: chainName(r.oneStore.store.id), n: r.oneStore.onSpecial, m: r.total }) }}</div>
          <div :class="{ on: mode === 'cheap' }" @click="mode = 'cheap'">{{ t('recipes.cheapestSplit', { k: r.chains.length }) }}</div>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 16px">
          <RouterLink v-if="added" class="btn ghost" to="/list" style="flex: 1; font-size: 16px">{{ t('recipes.added') }}</RouterLink>
          <button v-else class="btn" style="flex: 1; font-size: 16px" @click="addAll">{{ addLabel }}</button>
          <button v-if="canShare" class="btn ghost" style="width: 96px; font-size: 16px" @click="share">{{ t('recipes.share') }}</button>
        </div>
      </div>

      <div class="pad hrow" style="margin-top: 22px">
        <div class="h2">{{ t('recipes.ingredients') }}</div>
        <div class="s muted" style="font-size: 12.5px">{{ mode === 'one' && r.oneStore ? t('recipes.oneStoreSub', { s: chainName(r.oneStore.store.id) }) : t('recipes.cheapest') }}</div>
      </div>
      <div class="pad" style="margin-top: 10px">
        <div class="box">
          <component
            :is="m.offer ? 'RouterLink' : 'div'"
            v-for="m in view"
            :key="bi(m.ingredient.name)"
            class="lrow"
            :class="{ tap: m.offer, 'dim-row': !m.offer }"
            :to="link(m)"
          >
            <div class="rbar" :class="m.offer ? chainClass(m.offer.store.id) : ''" />
            <div class="grow">
              <div class="t">
                {{ bi(m.ingredient.name) }}<span v-if="m.ingredient.optional" class="opt">· {{ t('recipes.optional') }}</span>
              </div>
              <div class="s ell">{{ sub(m) }}</div>
            </div>
            <div style="text-align: right; flex: none">
              <div class="p">{{ m.offer ? money(dealPrice(m.offer.special)) : '—' }}</div>
              <TagChip v-if="m.offer && primaryTag(m.offer.special)" :tag="primaryTag(m.offer.special)!" style="margin-top: 4px" />
              <span v-else-if="!m.offer" class="tag low" style="margin-top: 4px">{{ t('recipes.notOnSpecial') }}</span>
            </div>
          </component>
        </div>
        <div v-if="r.recipe.staples" class="s muted" style="margin-top: 10px; font-size: 13px; line-height: 1.4">
          {{ t('recipes.staples', { s: bi(r.recipe.staples) }) }}
        </div>
      </div>

      <div class="pad" style="margin-top: 24px">
        <div class="h2">{{ t('recipes.method') }}</div>
        <div v-for="(step, i) in r.recipe.steps[lang]" :key="i" class="rstep">
          <b>{{ i + 1 }}</b>
          <span>{{ step }}</span>
        </div>
        <div v-if="r.recipe.tip" class="tipbox">
          <b>{{ t('recipes.tip') }}</b> {{ bi(r.recipe.tip) }}
        </div>
      </div>
    </template>

    <div v-else class="pad" style="margin-top: 20px">
      <RouterLink class="back" to="/recipes">‹ {{ t('recipes.back') }}</RouterLink>
      <div class="empty sub" style="margin-top: 12px">{{ t('browse.empty') }}</div>
    </div>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  margin: 4px var(--gutter) 0;
  border-radius: var(--r);
  overflow: hidden;
  aspect-ratio: 16 / 10;
  background: var(--paper-2);
}
.hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-back {
  position: absolute;
  left: 10px;
  top: 10px;
  height: 34px;
  padding: 0 13px;
  border-radius: 17px;
  background: #fff;
  color: var(--ink);
  font-weight: 800;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  box-shadow: 0 1px 3px #0002;
}
.hero-badge {
  position: absolute;
  left: 10px;
  bottom: 10px;
  max-width: calc(100% - 20px);
  background: var(--ink);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  padding: 7px 9px;
  border-radius: 6px;
  line-height: 1.2;
}
.credit { margin-top: 6px; font-size: 11px; color: var(--ink-3); }
.credit a { color: inherit; text-decoration: none; }
.rbar { width: 6px; height: 36px; border-radius: 3px; flex: none; background: var(--line); }
.rbar.nw { background: var(--nw); }
.rbar.ww { background: var(--ww); }
.rbar.pns { background: var(--pns); }
.lrow { color: inherit; text-decoration: none; }
.opt { margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--ink-3); }
.rstep { display: flex; gap: 12px; margin-top: 12px; font-size: 15.5px; line-height: 1.45; }
.rstep b { flex: none; width: 16px; font-family: 'Inter Tight', Inter, sans-serif; font-weight: 900; }
.tipbox {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: var(--r);
  background: var(--paper-2);
  font-size: 14px;
  line-height: 1.45;
}
</style>
