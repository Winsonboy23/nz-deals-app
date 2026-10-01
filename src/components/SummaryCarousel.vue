<script setup lang="ts">
// 首頁最上面的「本週摘要」卡片列（Chris 首頁改版規格 §1，2026-10-01）：左右滑、一次停一張，下一張露出約 24px 的邊讓人知道可以滑；
// 下面 4 個小圓點是現在停在第幾張。
// ① 已省下：淺綠底深綠字、金額省錢橘，沿用原本的兩種狀態和文案，右下角「特價到週日 · 剩 N 天」
// ② 這週煮什麼 → 食譜頁 ③ 購物清單（N 項）→ 清單頁 ④ 會員卡（N 張，右邊畫兩張疊在一起的小卡）→ 會員卡錢包
// ②–④ 白底細框、左上角淺綠底的線條圖示、底部一行深綠連結字。四張同高（同一排 flex 自己撐齊）。
import { computed, ref } from 'vue'
import { useSpecials } from '../composables/useSpecials'
import { useList } from '../composables/useList'
import { useAuth } from '../composables/useAuth'
import { useCards } from '../composables/useCards'
import { useRecipes } from '../composables/useRecipes'
import { savedThisWeek } from '../lib/savings'
import { daysLeft, nzMonday } from '../lib/week'
import { money } from '../lib/format'
import { t } from '../composables/useI18n'

const { activeStores, totalSpecials, groups } = useSpecials()
const { items } = useList()
const { isIn, name } = useAuth()
const { cards } = useCards()
const { ranked } = useRecipes()

/** 你本週已省下：清單裡這週打勾、有原價的才算（lib/savings.ts）；每樣的特價用同一份 groups 的 best（你的店最便宜那家） */
const saved = computed(() => savedThisWeek(items.value, (k) => groups.value.get(k)?.best, nzMonday()))
/** 還沒省到錢時的第二行：你附近 N 家店本週 M 項特價 */
const specialsLine = computed(() => t('home.headlineNoSave', { n: totalSpecials.value.toLocaleString('en-NZ'), s: activeStores.value.length }))
/** 「Chris，你本週已省下」：名字的第一個詞（沒名字只有 email 就用 @ 前面） */
const firstName = computed(() => name.value.split('@')[0].trim().split(/\s+/)[0] ?? '')
/** 「至少 $12.40」：金額大字，「至少」小字（翻譯字串裡金額前後的字拆出來） */
const amountWords = computed(() => {
  const [pre = '', post = ''] = t('home.savedAmount', { v: '\u0000' }).split('\u0000')
  return { pre, post }
})
/** 食譜頁排好的食譜裡，有幾道用到你的店本週的特價 */
const cookN = computed(() => ranked.value.filter((r) => r.onSpecial > 0).length)
const ticked = computed(() => items.value.filter((i) => i.checked).length)

/** 小圓點停在哪一張：每張卡左緣離第一張的距離，跟現在捲到哪裡最接近的那張（最後一張捲不到對齊左邊，照樣是它最近） */
const rail = ref<HTMLElement>()
const at = ref(0)
function onScroll() {
  const el = rail.value
  if (!el) return
  const kids = [...el.children] as HTMLElement[]
  const x0 = kids[0]?.offsetLeft ?? 0
  const off = (k: HTMLElement) => Math.abs(k.offsetLeft - x0 - el.scrollLeft)
  at.value = kids.reduce((best, k, i) => (off(k) < off(kids[best]) ? i : best), 0)
}
/** 點小圓點跳到那張（電腦上沒有手指可以滑） */
function go(i: number) {
  const el = rail.value
  const kids = el ? ([...el.children] as HTMLElement[]) : []
  if (el && kids[i]) el.scrollTo({ left: kids[i].offsetLeft - kids[0].offsetLeft, behavior: 'smooth' })
}
/** 滑鼠拖：按住左右拉；拖超過 5px 就吞掉放開時的點擊（不然會開卡片的連結）。放開後跳到最近那張 */
let drag: { x: number; left: number; moved: boolean } | null = null
function down(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || !rail.value) return
  drag = { x: e.clientX, left: rail.value.scrollLeft, moved: false }
}
function move(e: PointerEvent) {
  const el = rail.value
  if (!drag || !el) return
  const dx = e.clientX - drag.x
  if (!drag.moved && Math.abs(dx) < 5) return
  drag.moved = true
  el.style.scrollSnapType = 'none'
  el.scrollLeft = drag.left - dx
}
function up() {
  if (!drag) return
  const moved = drag.moved
  if (rail.value) rail.value.style.scrollSnapType = ''
  if (moved) {
    onScroll()
    go(at.value)
    setTimeout(() => (drag = null))
  } else drag = null
}
function clickCapture(e: MouseEvent) {
  if (drag?.moved) { e.preventDefault(); e.stopPropagation() }
}
</script>

<template>
  <div class="sm">
    <div ref="rail" class="hscroll sm-rail" @scroll.passive="onScroll"
      @pointerdown="down" @pointermove="move" @pointerup="up" @pointerleave="up" @click.capture="clickCapture" @dragstart.prevent>
      <!-- ① 已省下（清單這週打勾、有原價的才算）；還沒省到就提醒去打勾，附近幾家店幾項特價退到下一行 -->
      <div class="sm-card sm-saved">
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

      <!-- ② 這週煮什麼 -->
      <RouterLink class="sm-card" to="/recipes">
        <span class="sm-ic">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5Z" /><path d="M2 11h2M20 11h2" /><path d="M9.2 7.5c0-1.3 1.2-1.7 1.2-3M13.6 7.5c0-1.3 1.2-1.7 1.2-3" /></svg>
        </span>
        <div class="sm-t">{{ t('recipes.title') }}</div>
        <div class="sm-s ell">{{ cookN ? t('home.sumCookSub', { n: cookN }) : t('home.sumCookNone') }}</div>
        <div class="sm-go">{{ t('home.sumCookGo') }}</div>
      </RouterLink>

      <!-- ③ 購物清單：幾項（打勾的另外算） -->
      <RouterLink class="sm-card" to="/list">
        <span class="sm-ic">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6.5h10M10 12h10M10 17.5h10" /><path d="m3.5 6.5 1.5 1.5 2.5-2.5M3.5 12l1.5 1.5L7.5 11M3.5 17.5 5 19l2.5-2.5" /></svg>
        </span>
        <div class="sm-t">{{ t('home.sumList') }}</div>
        <div class="sm-s ell">
          <template v-if="items.length"><b>{{ t('common.items', { n: items.length }) }}</b><template v-if="ticked">{{ t('home.sumListTicked', { m: ticked }) }}</template></template>
          <template v-else>{{ t('list.empty') }}</template>
        </div>
        <div class="sm-go">{{ t('home.sumListGo') }}</div>
      </RouterLink>

      <!-- ④ 會員卡：登入才存得了；右邊畫兩張疊在一起的小卡 -->
      <RouterLink class="sm-card" to="/me/cards">
        <span class="sm-ic">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19M6 15h5" /></svg>
        </span>
        <svg class="sm-stack" viewBox="0 0 80 60" aria-hidden="true">
          <rect class="c2" x="27" y="7" width="44" height="29" rx="5" transform="rotate(10 49 21.5)" />
          <g transform="rotate(-7 32 36)">
            <rect class="c1" x="9" y="21" width="46" height="30" rx="5" />
            <rect class="bc" x="15" y="34" width="34" height="11" rx="2" />
            <path class="bl" d="M18 36.5v6M20.5 36.5v6M24 36.5v6M26 36.5v6M29.5 36.5v6M32 36.5v6M35.5 36.5v6M38 36.5v6M41.5 36.5v6M44.5 36.5v6" />
          </g>
        </svg>
        <div class="sm-t">{{ t('me.cards') }}</div>
        <div class="sm-s ell">
          <b v-if="isIn">{{ t('home.sumCardsN', { n: cards.length }) }}</b>
          <template v-else>{{ t('home.sumCardsSignIn') }}</template>
        </div>
        <div class="sm-go">{{ t('home.sumCardsGo') }}</div>
      </RouterLink>
    </div>
    <div class="sm-dots"><button v-for="i in 4" :key="i" type="button" :class="{ on: at === i - 1 }" :aria-label="`${i} / 4`" @click="go(i - 1)"><i /></button></div>
  </div>
</template>

<style scoped>
.sm { margin-top: 14px; }
/* 一次停一張（scroll-snap-stop），停下來卡片對齊左邊的留白；上下留一點讓卡片的框不被切到 */
.sm-rail {
  scroll-snap-type: x mandatory;
  scroll-padding-left: var(--gutter);
  padding-top: 1px;
  padding-bottom: 2px;
}
.sm-card {
  /* 一張的寬：100% 是扣掉左右留白的寬；再補回右邊的留白、扣掉卡片間距 10px 和下一張露出的 24px */
  flex: 0 0 calc(100% + var(--gutter) - 34px);
  scroll-snap-align: start;
  scroll-snap-stop: always;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 148px;
  padding: 14px 16px 13px;
  border-radius: var(--r);
  border: 1px solid var(--line);
  background: var(--card);
  color: inherit;
  text-decoration: none;
  transition: transform 0.28s var(--ease);
}
a.sm-card:active { transform: scale(0.985); }
/* ① 已省下：淺綠底，字用深綠（不用白字），金額用省錢橘 */
.sm-saved { background: var(--brand-tint); border-color: var(--brand-tint); color: var(--brand); }
.sv-hi { font-weight: 600; font-size: 17px; line-height: 1.3; }
.sv-amt { display: flex; align-items: baseline; gap: 5px; margin-top: 2px; font-weight: 800; font-size: 34px; line-height: 1.1; letter-spacing: -0.5px; color: var(--deal); }
.sv-word { font-size: 16px; font-weight: 600; letter-spacing: 0; }
.sv-arrow { width: 26px; height: 26px; align-self: center; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.sv-none { font-weight: 700; font-size: 21px; line-height: 1.25; }
.sv-sub { margin-top: 6px; font-size: 13px; line-height: 1.45; color: var(--ink-2); }
.sv-sub + .sv-sub { margin-top: 0; }
.sv-ends { margin-top: auto; padding-top: 8px; text-align: right; font-size: 12.5px; }
.sv-ends b { font-weight: 800; }
/* ②–④ 左上角的圖示：淺綠底圓角方塊、深綠線條 */
.sm-ic { width: 40px; height: 40px; border-radius: 12px; background: var(--brand-tint); color: var(--brand); display: flex; align-items: center; justify-content: center; }
.sm-ic svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.sm-t { margin-top: 10px; font-weight: 700; font-size: 16px; line-height: 1.25; }
.sm-s { margin-top: 2px; font-size: 13.5px; line-height: 1.4; color: var(--ink-2); }
.sm-s b { color: var(--ink); font-weight: 700; }
.sm-go { margin-top: auto; padding-top: 8px; font-size: 14px; font-weight: 700; color: var(--brand); }
/* ④ 右邊兩張疊在一起的小卡 */
.sm-stack { position: absolute; right: 18px; top: 50%; width: 88px; height: 66px; transform: translateY(-50%); }
.sm-stack .c2 { fill: var(--brand-tint); stroke: var(--brand); stroke-width: 1.5; }
.sm-stack .c1 { fill: var(--brand); }
.sm-stack .bc { fill: #fff; }
.sm-stack .bl { fill: none; stroke: var(--brand); stroke-width: 1.3; }
/* 小圓點：現在這張是深綠 */
.sm-dots { display: flex; justify-content: center; margin-top: 2px; }
/* 圓點本身 6px，按鈕留大一點好點 */
.sm-dots button { padding: 6px 3px; border: 0; background: none; cursor: pointer; display: flex; }
.sm-dots i { width: 6px; height: 6px; border-radius: 50%; background: rgba(28, 33, 29, 0.18); transition: background-color 0.25s var(--ease); }
.sm-dots .on i { background: var(--brand); }
</style>
