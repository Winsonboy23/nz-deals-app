<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TagChip from '../components/TagChip.vue'
import PriceLine from '../components/PriceLine.vue'
import Loading from '../components/Loading.vue'
import { useSpecials } from '../composables/useSpecials'
import { bi, recipeImg, useRecipes, type IngredientMatch, isIllustration } from '../composables/useRecipes'
import { useList } from '../composables/useList'
import { lang, t } from '../composables/useI18n'
import { primaryTag, rankPrice } from '../lib/compare'
import { chainClass, chainName, displayName, money, unitLabel } from '../lib/format'

const route = useRoute()
const { byId, loaded: recipesLoaded } = useRecipes()
const { loading } = useSpecials()
const { add, addFreeText } = useList()
const r = computed(() => byId(String(route.params.id)))
const added = ref(false)
/** 寶寶支線（KiteWise 3-6）的開關：預設關、換一道食譜就關回去、不記住 */
const baby = ref(false)
watch(() => route.params.id, () => {
  added.value = false
  baby.value = false
})

/** 「用 2 個鍋 · 廚具：爐台、烤箱」；0 個鍋那段不寫，兩段都沒有就整行不顯示 */
const kit = computed(() => {
  if (!r.value) return ''
  const { pot_count, appliances } = r.value.recipe
  const parts: string[] = []
  if (pot_count) parts.push(t('recipes.pots', { n: pot_count }))
  if (appliances.length) parts.push(t('recipes.appliances', { s: appliances.map((a) => t('recipes.appliance.' + a)).join(lang.value === 'zh' ? '、' : ', ') }))
  return parts.join(' · ')
})

/** 寶寶支線：後台審過、能最後才調味、有寶寶做法、知道第幾步後取出，四樣都有才給開關（沒審過就是一般食譜，什麼都不顯示）；有寫的月齡才列 */
const babyLevels = computed(() => {
  const x = r.value?.recipe
  const b = x?.reviewed && x.can_delay_seasoning && x.baby_split_step ? x.baby_branch : null
  return b ? (['6', '9', '12'] as const).filter((a) => b[a]).map((a) => ({ age: a, text: b[a]! })) : []
})
/** 開關下面那行小字：「6／9／12 個月」 */
const babyAges = computed(() => t('recipes.babyAge', { n: babyLevels.value.map((l) => l.age).join(lang.value === 'zh' ? '／' : ' / ') }))

/** 煮一鍋吃 N 天：資料裡每天的吃法常自己帶「第 1 天：」「Day 1:」開頭，前面已經有粗體的「第 N 天」，拿掉免得重複 */
const dayText = (s: string) => s.replace(/^\s*(第\s*\d+\s*天|day\s*\d+)\s*[：:，,、—–-]?\s*/i, '')
/** 「第 1 天：…」「保存：…」的冒號 */
const colon = computed(() => (lang.value === 'zh' ? '：' : ': '))

/** 同一家買齊（預設）／每樣各挑最便宜 */
const mode = ref<'one' | 'cheap'>('one')
const view = computed<IngredientMatch[]>(() => (r.value ? (mode.value === 'one' && r.value.oneStore ? r.value.oneStore.matches : r.value.matches) : []))
const adding = computed(() => view.value.filter((m) => !m.ingredient.optional || m.offer))
const priced = computed(() => adding.value.filter((m) => m.offer).length)
const estCost = computed(() => adding.value.reduce((s, m) => s + (m.offer ? rankPrice(m.offer.special) : 0), 0))
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
  const parts = [chainName(s.store_id), displayName(s)]   // 原價、一般價、湊件價在右邊價格的說明行（PriceLine）
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
        <img :src="recipeImg(r.recipe.image)" :alt="bi(r.recipe.title)" decoding="async" />
        <span v-if="isIllustration(r.recipe)" class="hero-ill">{{ t('recipes.illustration') }}</span>
        <RouterLink class="hero-back" to="/recipes">‹ {{ t('recipes.back') }}</RouterLink>
        <span class="hero-badge">{{ t('recipes.badge', { n: r.onSpecial, m: r.total, k: r.rank }) }}</span>
      </div>
      <!-- AI 生的圖沒有攝影師（credit 可能是空的），不寫「照片：」 -->
      <div v-if="r.recipe.credit?.photographer" class="pad credit">
        <a :href="r.recipe.credit.url" target="_blank" rel="noopener">{{ t('recipes.photo', { p: r.recipe.credit.photographer }) }}</a>
      </div>

      <div class="pad" style="margin-top: 10px">
        <div class="h1">{{ bi(r.recipe.title) }}</div>
        <div class="sub" style="margin-top: 8px">
          <template v-if="r.recipe.cuisineName">{{ bi(r.recipe.cuisineName) }} · </template>{{ t('recipes.meta', { serves: r.recipe.serves, min: r.recipe.minutes }) }}
          · {{ t('recipes.' + r.recipe.difficulty) }}
          <template v-if="r.recipe.kcal"> · {{ t('recipes.kcal', { n: r.recipe.kcal }) }}</template>
        </div>
        <div v-if="kit" class="muted" style="margin-top: 4px; font-size: 12.5px">{{ kit }}</div>
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
        <Loading v-if="loading" inline style="margin-bottom: 6px" />
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
              <div class="p"><PriceLine v-if="m.offer" :special="m.offer.special" detail align="right" /><template v-else>—</template></div>
              <TagChip v-if="m.offer && primaryTag(m.offer.special)" :tag="primaryTag(m.offer.special)!" style="margin-top: 4px" />
              <span v-else-if="!m.offer" class="tag low" style="margin-top: 4px">{{ t('recipes.notOnSpecial') }}</span>
            </div>
          </component>
        </div>
        <template v-if="r.recipe.staples">
          <div class="hrow" style="margin-top: 14px">
            <div class="h2" style="font-size: 15px">{{ t('ai.staplesTitle') }}</div>
            <div class="s muted" style="font-size: 12.5px">{{ t('ai.staplesSub') }}</div>
          </div>
          <div class="box stbox" style="margin-top: 8px">
            <div class="lrow" style="padding: 10px 12px">
              <div class="grow"><div class="t" style="font-weight: 600; color: var(--ink-2); line-height: 1.4">{{ bi(r.recipe.staples) }}</div></div>
            </div>
          </div>
        </template>
      </div>

      <div class="pad" style="margin-top: 24px">
        <div class="h2">{{ t('recipes.method') }}</div>
        <div v-if="babyLevels.length" class="box" style="margin-top: 12px">
          <div class="lrow" style="padding: 12px">
            <div class="grow">
              <div class="t">{{ t('recipes.baby') }}</div>
              <div class="s">{{ babyAges }}</div>
            </div>
            <button class="tg" :class="{ off: !baby }" role="switch" :aria-checked="baby" :aria-label="t('recipes.baby')" @click="baby = !baby" />
          </div>
        </div>
        <div v-if="baby" class="babywarn">{{ t('recipes.babyWarn') }}</div>
        <template v-for="(step, i) in r.recipe.steps[lang]" :key="i">
          <div class="rstep">
            <b>{{ i + 1 }}</b>
            <span>{{ step }}</span>
          </div>
          <!-- 寶寶支線打開：第 baby_split_step 步做完先取出寶寶的份，下一步（調味）照常接下去 -->
          <div v-if="baby && i + 1 === r.recipe.baby_split_step" class="babycard">
            <div class="babycard-t">🍼 {{ t('recipes.babyStep') }}</div>
            <div v-for="l in babyLevels" :key="l.age" class="babyage">
              <b>{{ t('recipes.babyAge', { n: l.age }) }}</b>
              {{ bi(l.text) }}
            </div>
          </div>
        </template>
        <!-- 煮一鍋吃 N 天（batch 不是 null 才有）：一天一行、照 variations 的順序，最後一行怎麼保存 -->
        <div v-if="r.recipe.batch" class="box batchbox">
          <div class="batch-t">{{ t('recipes.batchTitle', { n: r.recipe.batch.days }) }}</div>
          <div v-for="(v, i) in r.recipe.batch.variations" :key="i" class="batch-l">
            <b>{{ t('recipes.batchDay', { d: i + 1 }) }}</b>{{ colon }}{{ dayText(bi(v)) }}
          </div>
          <div class="batch-l"><b>{{ t('recipes.batchStorage') }}</b>{{ colon }}{{ bi(r.recipe.batch.storage) }}</div>
        </div>
        <div v-if="r.recipe.tip" class="tipbox">
          <b>{{ t('recipes.tip') }}</b> {{ bi(r.recipe.tip) }}
        </div>
      </div>
    </template>

    <Loading v-else-if="!recipesLoaded" />
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
  background: var(--card);
  color: var(--brand-deep);
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
  background: var(--brand-deep);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  padding: 7px 9px;
  border-radius: 6px;
  line-height: 1.2;
}
/* AI 生的圖：右上角小字「示意圖」 */
.hero-ill {
  position: absolute;
  right: 10px;
  top: 10px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--card);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  box-shadow: 0 1px 3px #0002;
}
.credit { margin-top: 6px; font-size: 11px; color: var(--ink-3); }
.credit a { color: inherit; text-decoration: none; }
.rbar { width: 6px; height: 36px; border-radius: 3px; flex: none; background: var(--line); }
.stbox { background: var(--paper-2); border: 1px dashed #BCC5B9; box-shadow: none; }
.rbar.nw { background: var(--nw); }
.rbar.ww { background: var(--ww); }
.rbar.pns { background: var(--pns); }
.lrow { color: inherit; text-decoration: none; }
.opt { margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--ink-3); }
.rstep { display: flex; gap: 12px; margin-top: 12px; font-size: 15.5px; line-height: 1.45; }
.rstep b { flex: none; width: 16px; font-weight: 800; color: var(--brand); }
/* 寶寶支線：開關打開才出現。提醒用螢光黃，「先取出寶寶的份」那張卡用綠框白底，比一般步驟醒目 */
.babywarn { margin-top: 12px; padding: 8px 12px; border-radius: 10px; background: var(--hl); font-size: 14px; font-weight: 700; line-height: 1.35; }
.babycard { margin-top: 14px; padding: 12px 14px; border: 2px solid var(--brand); border-radius: var(--r); background: var(--card); }
.babycard-t { font-size: 16px; font-weight: 800; }
.babyage { margin-top: 10px; font-size: 14.5px; line-height: 1.45; }
.babyage b { display: block; font-weight: 800; }
/* 煮一鍋吃 N 天：外框用 .box，字級跟寶寶卡一樣 */
.batchbox { margin-top: 16px; padding: 12px 14px; }
.batch-t { font-size: 16px; font-weight: 800; }
.batch-l { margin-top: 8px; font-size: 14.5px; line-height: 1.45; }
.batch-l b { font-weight: 800; }
.tipbox {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: var(--r);
  background: var(--brand-tint);
  font-size: 14px;
  line-height: 1.45;
}
</style>
