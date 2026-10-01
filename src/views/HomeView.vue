<script setup lang="ts">
// 首頁（2026-10-01 照 Chris 定案的《首頁改版規格》docs/kitewise-home-v2-spec.md）：由上到下
// 頂部 → 本週摘要卡片列 → 這週最划算（一排橫滑）→ 本週食譜推薦（一排橫滑）→ 生鮮特價（肉、海鮮、蔬菜、水果各 2）→ 瘋狂半價（兩欄）
// → 你關注的有特價（登入才有）→ 頁尾。
import { computed, ref } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import SummaryCarousel from '../components/SummaryCarousel.vue'
import ProductCard from '../components/ProductCard.vue'
import MiniCard from '../components/MiniCard.vue'
import StaleBanner from '../components/StaleBanner.vue'
import PriceLine from '../components/PriceLine.vue'
import { useSpecials } from '../composables/useSpecials'
import { toOffer } from '../lib/compare'
import { chainClass, displayName, money, catLevel } from '../lib/format'
import { freshPicks } from '../lib/freshPicks'
import { t } from '../composables/useI18n'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'
import { bi, isIllustration, recipeImg, useRecipes, type RankedRecipe, type Recipe } from '../composables/useRecipes'
import { useSiteSettings } from '../composables/useSiteSettings'
import { readCache, writeCache } from '../lib/cache'

const { loading, totalSpecials, topDeduped, deepDiscounts, rows, groups } = useSpecials()
const { isIn } = useAuth()
const { watched } = useSync()
/** J1 · 你關注的有特價：關注的 product_key 這週在你的店有特價的 */
const watchedHits = computed(() => [...watched.value].map((k) => groups.value.get(k)).filter((g): g is NonNullable<typeof g> => !!g).slice(0, 8))

/** 這週最划算：一排橫滑，跟 Top 10 頁同一份（同品牌同類只放一格，附「N 款」） */
const top10 = computed(() => topDeduped.value.slice(0, 10))

/** 本週食譜推薦：食譜頁排好的前 6 道（食材特價最多、每份最便宜） */
const { ranked } = useRecipes()
const recipes6 = computed(() => ranked.value.slice(0, 6))
/**
 * 照片左上角的分類小標：挑一個最有代表性的——區塊優先（煮一鍋吃三天、一鍋到底、免開火、早餐、氣炸鍋／微波爐那區），
 * 再看主要廚具；爐台（平底鍋）排在微波爐前面，因為微波常常只是熱飯。
 */
function recipeTag(r: Recipe): string {
  const b = r.blocks ?? []
  const a = r.appliances ?? []
  if (b.includes('batch')) return t('recipes.batch')
  if (b.includes('one-pot')) return t('home.rtOnePot')
  if (b.includes('no-cook') || (!a.length && r.pot_count === 0)) return t('recipes.noCook')
  if (b.includes('breakfast')) return t('home.rtBreakfast')
  if (b.includes('air-fryer-micro')) {
    if (a.includes('air-fryer')) return t('recipes.appliance.air-fryer')
    if (a.includes('microwave')) return t('recipes.appliance.microwave')
  }
  for (const k of ['oven', 'slow-cooker', 'rice-cooker', 'bbq', 'air-fryer'] as const) if (a.includes(k)) return t(`recipes.appliance.${k}`)
  if (a.includes('stovetop')) return t('home.rtPan')
  for (const k of ['microwave', 'toaster', 'blender'] as const) if (a.includes(k)) return t(`recipes.appliance.${k}`)
  return ''
}
/** 食材名去掉份量和切法：「五花培根 200 g，切 1 cm 段」→「五花培根」、「Broccoli ½ head」→「Broccoli」 */
const foodName = (s: string) => s.split(/[，,（(]|\s+(?=[\d½¼¾⅓⅔半])/)[0].trim() || s
/** 「用到特價：xxx」：這道的食材裡這週有特價的第一樣（必要的先，沒有再看選配的） */
function usesSpecial(r: RankedRecipe): string {
  const m = r.matches.find((x) => x.offer && !x.ingredient.optional) ?? r.matches.find((x) => x.offer)
  return m ? foodName(bi(m.ingredient.name)) : ''
}

/** 生鮮特價：肉 2、海鮮 2、蔬菜 2、水果 2，各挑省最多的，不夠的互補（lib/freshPicks.ts）；價格是你選的店的 */
const fresh = computed(() => freshPicks(rows.value))

/** 後台公告（settings.announce）：關掉之後同一句不再出現，換新的一句又會出現 */
const { announce } = useSiteSettings()
const seenAnnounce = ref(readCache<string>('announceSeen') ?? '')
const showAnnounce = computed(() => !!announce.value && announce.value !== seenAnnounce.value)
function closeAnnounce() {
  seenAnnounce.value = announce.value
  writeCache('announceSeen', announce.value)
}
/** 瘋狂半價 4 格：同品牌同第二層分類只放一格（不然常常 3 格是同一款的不同口味） */
const half = computed(() => {
  const seen = new Set<string>()
  const out: typeof deepDiscounts.value = []
  for (const r of deepDiscounts.value) {
    const b = (r.special.brand ?? '').trim().toLowerCase()
    const c = catLevel(r.special.category_id, 2)
    const k = b && c ? `${b}|${c}` : r.store.id + r.special.product_id
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
    if (out.length === 4) break
  }
  return out
})
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
      <div class="skel" style="height: 148px; border-radius: var(--r)" />
      <div style="display: flex; gap: 10px; margin-top: 46px; overflow: hidden">
        <div class="skel" style="flex: none; width: 152px; height: 236px" />
        <div class="skel" style="flex: none; width: 152px; height: 236px" />
        <div class="skel" style="flex: none; width: 152px; height: 236px" />
      </div>
    </div>

    <template v-else>
      <!-- 1 本週摘要：已省下、這週煮什麼、購物清單、會員卡，左右滑 -->
      <SummaryCarousel />

      <StaleBanner />

      <!-- 2 這週最划算：一排橫滑 -->
      <div class="pad row sec-head">
        <div class="h2">{{ t('home.best') }}</div>
        <RouterLink class="link" to="/top10">{{ t('home.top10') }}</RouterLink>
      </div>
      <div v-if="top10.length" class="hscroll snap rail best-rail">
        <ProductCard v-for="x in top10" :key="x.g.key" :offer="x.g.best" :group="x.g" :variants="x.variants" />
      </div>
      <div v-else class="pad">
        <div class="note sub">{{ t('home.noCompare') }}</div>
      </div>

      <!-- 3 本週食譜推薦：一排橫滑；照片左上角分類小標，下面菜名、時間、每份價、用到哪樣特價（不放星星） -->
      <template v-if="recipes6.length">
        <div class="pad hrow sec-head">
          <div class="h2">{{ t('home.recipes') }}</div>
          <RouterLink class="link" to="/recipes">{{ t('home.allRecipes', { n: ranked.length }) }}</RouterLink>
        </div>
        <div class="hscroll snap rail">
          <RouterLink v-for="r in recipes6" :key="r.recipe.id" class="hr" :to="`/recipes/${r.recipe.id}`">
            <div class="hr-img">
              <img :src="recipeImg(r.recipe.image)" :alt="bi(r.recipe.title)" loading="lazy" decoding="async" />
              <span v-if="recipeTag(r.recipe)" class="hr-tag">{{ recipeTag(r.recipe) }}</span>
              <span v-if="isIllustration(r.recipe)" class="hr-ill">{{ t('recipes.illustration') }}</span>
            </div>
            <div class="hr-body">
              <div class="hr-t">{{ bi(r.recipe.title) }}</div>
              <div class="hr-m">
                ⏱ {{ t('recipes.minutes', { n: r.recipe.minutes }) }}<template v-if="Number.isFinite(r.perServe)"> · {{ t('recipes.perServe', { v: money(r.perServe) }) }}</template>
              </div>
              <div v-if="usesSpecial(r)" class="hr-sp ell">{{ t('home.usesSpecial', { n: usesSpecial(r) }) }}</div>
            </div>
          </RouterLink>
        </div>
      </template>

      <!-- 4 生鮮特價：肉 2、海鮮 2、蔬菜 2、水果 2；「更多」去分類頁 -->
      <template v-if="fresh.length">
        <div class="pad row sec-head">
          <div class="h2">{{ t('home.fresh') }}</div>
          <RouterLink class="link" to="/browse">{{ t('home.moreLink') }}</RouterLink>
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

      <!-- 5 瘋狂半價專區：兩欄 4 格，右上角實際折數 -->
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

/* 橫滑：停下來卡片對齊左邊的留白；上下留一點讓卡片陰影不被切掉 */
.rail { padding-top: 2px; padding-bottom: 12px; margin-bottom: -6px; }
.hscroll.snap { scroll-snap-type: x mandatory; scroll-padding-left: var(--gutter); }
.hscroll.snap > * { scroll-snap-align: start; }

/* 這週最划算：卡寬 152px，圖片正方形；同一排一樣高，「其他店」對齊卡片底部 */
.best-rail > .card { flex: 0 0 152px; display: flex; flex-direction: column; }
.best-rail :deep(.thumb) { height: auto; aspect-ratio: 1 / 1; }
.best-rail :deep(.others) { margin-top: auto; padding-top: 4px; }

/* 本週食譜推薦：卡寬 236px，照片 16:10 */
.hr {
  flex: none;
  width: 236px;
  display: flex;
  flex-direction: column;
  border-radius: var(--r);
  overflow: hidden;
  background: var(--card);
  box-shadow: var(--shadow);
  color: inherit;
  text-decoration: none;
  transition: transform 0.28s var(--ease);
}
.hr:active { transform: scale(0.985); }
.hr-img { position: relative; aspect-ratio: 16 / 10; background: var(--paper-2); }
.hr-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 照片上的小標：分類（淺綠底深綠字，左上）、AI 生的圖寫「示意圖」（白底，右上） */
.hr-tag { position: absolute; left: 8px; top: 8px; padding: 3px 8px; border-radius: 8px; background: var(--brand-tint); color: var(--brand); font-size: 11.5px; font-weight: 700; line-height: 1.3; }
.hr-ill { position: absolute; right: 8px; top: 8px; padding: 3px 7px; border-radius: 7px; background: var(--card); color: var(--ink-2); font-size: 11px; font-weight: 700; line-height: 1.2; }
.hr-body { flex: 1; display: flex; flex-direction: column; padding: 10px 12px 12px; }
/* 菜名固定兩行高，同一排的時間、小標才對得齊 */
.hr-t {
  font-weight: 700;
  font-size: 15px;
  line-height: 1.25;
  min-height: 2.5em;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.hr-m { margin-top: 4px; font-size: 12.5px; color: var(--ink-2); white-space: nowrap; }
.hr-sp { align-self: flex-start; max-width: 100%; margin-top: 8px; padding: 2px 8px; border-radius: 7px; background: var(--brand-tint); color: var(--brand); font-size: 11.5px; font-weight: 700; line-height: 1.45; }

/* 瘋狂半價專區：標題前的小三角（省錢橘）、兩欄格子 */
.half-t { display: flex; align-items: center; gap: 7px; }
.half-t svg { width: 13px; height: 13px; flex: none; fill: var(--deal); }
.half-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
</style>
