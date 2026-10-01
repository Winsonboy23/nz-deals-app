<script setup lang="ts">
import { computed, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import ProductCard from '../components/ProductCard.vue'
import MiniCard from '../components/MiniCard.vue'
import StaleBanner from '../components/StaleBanner.vue'
import { useSpecials } from '../composables/useSpecials'
import { toOffer } from '../lib/compare'
import { chainClass, displayName, money } from '../lib/format'
import { daysLeft, nzMonday } from '../lib/week'
import { savedThisWeek } from '../lib/savings'
import { t } from '../composables/useI18n'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'
import { useList } from '../composables/useList'
import PriceLine from '../components/PriceLine.vue'
import { bi, isIllustration, recipeImg, useRecipes } from '../composables/useRecipes'
import { chainName } from '../lib/format'
import { useSiteSettings } from '../composables/useSiteSettings'
import { readCache, writeCache } from '../lib/cache'

const { loading, activeStores, totalSpecials, topDeduped, deepDiscounts, freshByKg } = useSpecials()
const { isIn, name } = useAuth()
const { watched } = useSync()
const { groups } = useSpecials()
/** J1 · 你關注的有特價：關注的 product_key 這週在你的店有特價的 */
const watchedHits = computed(() => [...watched.value].map((k) => groups.value.get(k)).filter((g): g is NonNullable<typeof g> => !!g).slice(0, 8))

/** 最上面「你本週已省下」：清單裡這週打勾、有原價的才算（lib/savings.ts）；每樣的特價用同一份 groups 的 best（你的店最便宜那家） */
const { items } = useList()
const saved = computed(() => savedThisWeek(items.value, (k) => groups.value.get(k)?.best, nzMonday()))
/** 還沒省到錢時退到第二行：你附近 N 家店本週 M 項特價 */
const specialsLine = computed(() => t('home.headlineNoSave', { n: totalSpecials.value.toLocaleString('en-NZ'), s: activeStores.value.length }))
/** 「Chris，你本週已省下」：名字的第一個詞（沒名字只有 email 就用 @ 前面） */
const firstName = computed(() => name.value.split('@')[0].trim().split(/\s+/)[0] ?? '')
/** 「至少 $12.40」：金額大字，「至少」小字（翻譯字串裡金額前後的字拆出來） */
const amountWords = computed(() => {
  const [pre = '', post = ''] = t('home.savedAmount', { v: '\u0000' }).split('\u0000')
  return { pre, post }
})

const top6 = computed(() => topDeduped.value.slice(0, 6))
/** 本週食譜推薦：食譜頁排好的前 3 道（食材特價最多、每份最便宜）；第一道做成大圖卡 */
const { ranked } = useRecipes()
const top3 = computed(() => ranked.value.filter((r) => r.onSpecial > 0).slice(0, 3))
/** 後台公告（settings.announce）：關掉之後同一句不再出現，換新的一句又會出現 */
const { announce } = useSiteSettings()
const seenAnnounce = ref(readCache<string>('announceSeen') ?? '')
const showAnnounce = computed(() => !!announce.value && announce.value !== seenAnnounce.value)
function closeAnnounce() {
  seenAnnounce.value = announce.value
  writeCache('announceSeen', announce.value)
}
/** 瘋狂半價專區：首頁兩欄放 4 格，其他在「更多」 */
const half = computed(() => deepDiscounts.value.slice(0, 4))
const fresh = computed(() => freshByKg.value.slice(0, 12))
</script>

<template>
  <div class="screen has-header">
    <AppHeader />

    <div v-if="showAnnounce" class="pad" style="margin-top: 12px">
      <div class="note row" style="gap: 10px; align-items: flex-start">
        <div class="s" style="flex: 1; min-width: 0; color: var(--ink)">{{ announce }}</div>
        <button class="link" style="flex: none" @click="closeAnnounce">✕</button>
      </div>
    </div>

    <div v-if="loading && !totalSpecials" class="pad" style="margin-top: 14px">
      <div class="skel" style="height: 118px; border-radius: var(--r)" />
      <div style="display: flex; gap: 8px; margin-top: 18px">
        <div class="skel" style="flex: 1; height: 150px" />
        <div class="skel" style="flex: 1; height: 150px" />
        <div class="skel" style="flex: 1; height: 150px" />
      </div>
    </div>

    <template v-else>
      <!-- 你本週已省下（清單這週打勾、有原價的才算）；還沒省到就提醒去打勾，附近幾家店幾項特價退到第二行。綠底白字卡（設計稿） -->
      <div class="pad" style="margin-top: 14px">
        <div class="saved">
          <template v-if="saved.amount > 0">
            <div class="sv-hi">{{ isIn && firstName ? t('home.savedName', { n: firstName }) : t('home.saved') }}</div>
            <div class="sv-amt">
              <span v-if="amountWords.pre" class="sv-word">{{ amountWords.pre }}</span>{{ money(saved.amount) }}<span v-if="amountWords.post" class="sv-word">{{ amountWords.post }}</span>
              <svg class="sv-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7l6 6 4-4 8 8" /><path d="M14 17h7v-7" /></svg>
            </div>
            <div class="sv-sub">
              {{ t('home.savedHow', { n: saved.counted + saved.uncounted }) }}<template v-if="saved.uncounted">{{ t('home.savedSkipped', { u: saved.uncounted }) }}</template>
            </div>
          </template>
          <template v-else>
            <div class="sv-none">{{ t('home.savedNone') }}</div>
            <div class="sv-sub">{{ t('home.savedNoneSub') }}</div>
            <div class="sv-sub">{{ specialsLine }}</div>
          </template>
          <div class="sv-ends">{{ t('home.ends') }} · <b>{{ t('home.daysLeft', { d: daysLeft() }) }}</b></div>
        </div>
      </div>

      <StaleBanner />

      <div class="pad row sec-head">
        <div class="h2">{{ t('home.best') }}</div>
        <RouterLink class="link" to="/top10">{{ t('home.top10') }}</RouterLink>
      </div>
      <div v-if="top6.length" class="grid3">
        <ProductCard v-for="x in top6" :key="x.g.key" :offer="x.g.best" :group="x.g" :variants="x.variants" />
      </div>
      <div v-else class="pad">
        <div class="note sub">{{ t('home.noCompare') }}</div>
      </div>

      <!-- 生鮮特價：橫滑卡，圖在上、左上角折扣標 -->
      <template v-if="fresh.length">
        <div class="pad row sec-head">
          <div class="h2">{{ t('home.fresh') }}</div>
          <RouterLink class="link" to="/fresh">
            {{ t('home.more', { n: freshByKg.length }) }}
          </RouterLink>
        </div>
        <div class="hscroll snap rail">
          <MiniCard
            v-for="r in fresh"
            :key="r.store.id + r.special.product_id"
            :offer="toOffer(r.store, r.special)"
            kind="fresh"
          />
        </div>
      </template>

      <!-- 本週食譜推薦：第一道大圖卡（照片鋪滿、底部漸層壓白字），第 2、3 道小列 -->
      <template v-if="top3.length">
        <div class="pad hrow sec-head">
          <div class="h2">{{ t('home.recipes') }}</div>
          <RouterLink class="link" to="/recipes">{{ t('home.allRecipes', { n: ranked.length }) }}</RouterLink>
        </div>
        <div class="pad">
          <RouterLink class="hero" :to="`/recipes/${top3[0].recipe.id}`">
            <img :src="recipeImg(top3[0].recipe.image)" :alt="bi(top3[0].recipe.title)" decoding="async" />
            <span v-if="isIllustration(top3[0].recipe)" class="hero-ill">{{ t('recipes.illustration') }}</span>
            <div class="hero-txt">
              <div class="hero-t">{{ bi(top3[0].recipe.title) }}</div>
              <div class="hero-m">
                ⏱ {{ t('recipes.minutes', { n: top3[0].recipe.minutes }) }}<template v-if="Number.isFinite(top3[0].perServe)"> · {{ t('recipes.perServe', { v: money(top3[0].perServe) }) }}</template>
              </div>
            </div>
          </RouterLink>
          <div v-if="top3.length > 1" class="box" style="margin-top: 10px">
            <RouterLink v-for="r in top3.slice(1)" :key="r.recipe.id" class="lrow tap" :to="`/recipes/${r.recipe.id}`" style="padding: 10px 12px; gap: 10px; color: inherit; text-decoration: none">
              <img :src="recipeImg(r.recipe.image)" :alt="bi(r.recipe.title)" loading="lazy" decoding="async" style="width: 56px; height: 56px; border-radius: 10px; object-fit: cover; flex: none; background: var(--paper-2)" />
              <div class="grow" style="min-width: 0">
                <div class="t ell">{{ bi(r.recipe.title) }}</div>
                <div class="s ell"><template v-if="r.recipe.cuisineName">{{ bi(r.recipe.cuisineName) }} · </template>{{ r.recipe.minutes }} min · {{ t('recipes.onSpecial', { n: r.onSpecial, m: r.total }) }}</div>
                <div v-if="r.oneStore" class="s ell" style="font-weight: 700">{{ t('recipes.oneStore', { s: chainName(r.oneStore.store.id), n: r.oneStore.onSpecial, m: r.total }) }}</div>
              </div>
              <div class="link" style="flex: none">›</div>
            </RouterLink>
          </div>
        </div>
      </template>

      <!-- 瘋狂半價專區：兩欄 4 格，右上角實際折數 -->
      <template v-if="half.length">
        <div class="pad row sec-head">
          <div class="h2 half-t"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 3h9L6 10z" /></svg>{{ t('home.half') }}</div>
          <RouterLink class="link" to="/half-price">
            {{ t('home.more', { n: deepDiscounts.length }) }}
          </RouterLink>
        </div>
        <div class="pad half-grid">
          <MiniCard
            v-for="r in half"
            :key="r.store.id + r.special.product_id"
            :offer="toOffer(r.store, r.special)"
            kind="half"
          />
        </div>
      </template>

      <template v-if="isIn && watchedHits.length">
        <div class="pad hrow sec-head">
          <div class="h2">{{ t('home.watched') }}</div>
          <div class="link">{{ watchedHits.length }}</div>
        </div>
        <div class="pad">
          <div class="box">
            <RouterLink v-for="g in watchedHits" :key="g.key" class="lrow tap" :to="`/p/${encodeURIComponent(g.key)}`" style="padding: 10px 12px">
              <span class="dot" :class="chainClass(g.best.store.id)" />
              <div class="grow" style="min-width: 0">
                <div class="t ell" style="font-size: 14px">{{ displayName(g.best.special) }}</div>
                <div class="s ell">{{ g.best.store.name }}</div>
              </div>
              <div class="p" style="font-size: 17px"><PriceLine :special="g.best.special" align="right" /></div>
            </RouterLink>
          </div>
        </div>
      </template>

      <div class="pad sub muted" style="margin-top: 18px; font-size: 12.5px">
        {{ t('me.footnote') }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.sec-head { margin-top: 22px; margin-bottom: 10px; }
/* 已省下：中間綠底白字卡 */
.saved {
  background: var(--brand);
  color: #fff;
  border-radius: var(--r);
  padding: 16px 18px 12px;
  box-shadow: var(--shadow);
}
.sv-hi { font-family: var(--font-head); font-weight: 600; font-size: 19px; line-height: 1.3; }
.sv-amt { display: flex; align-items: baseline; gap: 6px; margin-top: 2px; font-family: var(--font-head); font-weight: 700; font-size: 38px; line-height: 1.1; letter-spacing: -0.5px; }
.sv-word { font-size: 18px; font-weight: 600; letter-spacing: 0; }
.sv-arrow { width: 30px; height: 30px; align-self: center; fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.sv-none { font-family: var(--font-head); font-weight: 700; font-size: 24px; line-height: 1.2; }
.sv-sub { margin-top: 6px; font-size: 13.5px; line-height: 1.45; color: rgba(255, 255, 255, 0.9); }
.sv-none + .sv-sub { margin-top: 8px; }
.sv-sub + .sv-sub { margin-top: 0; }
.sv-ends { margin-top: 10px; text-align: right; font-size: 12.5px; color: rgba(255, 255, 255, 0.88); }
.sv-ends b { color: #fff; }

/* 生鮮橫滑：一次停一張，停下來卡片對齊左邊的 gutter；上下留一點讓卡片陰影不被切掉 */
.rail { padding-top: 2px; padding-bottom: 12px; margin-bottom: -6px; }
.hscroll.snap { scroll-snap-type: x mandatory; scroll-padding-left: var(--gutter); }
.hscroll.snap > :deep(.mini) { scroll-snap-align: start; }

/* 本週食譜推薦的大圖卡 */
.hero {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  border-radius: var(--r);
  overflow: hidden;
  background: var(--paper-2);
  box-shadow: var(--shadow);
  color: #fff;
  text-decoration: none;
}
.hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0, 0, 0, 0) 38%, rgba(0, 0, 0, 0.72) 100%); }
.hero-ill { position: absolute; right: 9px; top: 9px; z-index: 2; padding: 3px 7px; border-radius: 7px; background: var(--card); color: var(--ink-2); font-size: 11px; font-weight: 700; line-height: 1.2; }
.hero-txt { position: absolute; left: 14px; right: 14px; bottom: 11px; z-index: 1; }
.hero-t {
  font-family: var(--font-head);
  font-weight: 700;
  font-size: 21px;
  line-height: 1.25;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.hero-m { margin-top: 3px; text-align: right; font-size: 12.5px; font-weight: 700; white-space: nowrap; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); }

/* 瘋狂半價專區：標題前的小三角（風箏橘）、兩欄格子 */
.half-t { display: flex; align-items: center; gap: 7px; }
.half-t svg { width: 13px; height: 13px; flex: none; fill: var(--kite); }
.half-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
</style>
