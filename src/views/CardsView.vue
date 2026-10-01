<script setup lang="ts">
// 我的 → 會員卡：到店裡打開給店員掃。只存號碼、不存圖，條碼自己用 JsBarcode 畫（比截圖好掃）。只給登入者（useCards）。
// 卡片直向一張張滑（scroll-snap，下一張露出頭，像一疊卡）；點卡片放大：全白底、條碼拉到最大、螢幕不暗（有 wakeLock 就叫）。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import CardBarcode from '../components/CardBarcode.vue'
import AddCardSheet from '../components/AddCardSheet.vue'
import { useAuth } from '../composables/useAuth'
import { useCards, type LoyaltyCard } from '../composables/useCards'
import { t } from '../composables/useI18n'
import { chainClass, chainName } from '../lib/format'

const { isIn, ready } = useAuth()
const { cards, loading, remove, move } = useCards()

/** 卡面上的名字：三家是超市名，其他是自訂名稱 */
const title = (c: LoyaltyCard) => (c.chain === 'other' ? c.label || t('cards.other') : chainName(c.chain))
const cls = (c: LoyaltyCard) => (c.chain === 'other' ? 'other' : chainClass(c.chain))
/** 號碼四個一組，店員照著打不容易看錯 */
const spaced = (code: string) => code.replace(/(.{4})(?=.)/g, '$1 ')

// ── 放大 ──
const zoomed = ref<LoyaltyCard | null>(null)
let lock: WakeLockSentinel | null = null
let asking = false
/** 放大時叫住螢幕、關掉就放開。不支援（舊 iPhone、http）或被拒（省電模式）就算了。 */
async function keepAwake(): Promise<void> {
  try {
    if (zoomed.value && !asking && (!lock || lock.released)) {
      asking = true
      lock = await navigator.wakeLock.request('screen').finally(() => {
        asking = false
      })
    }
    // 關掉了就放開（也接住「還在等系統回應時就關掉」的那一個）
    if (!zoomed.value && lock) {
      const l = lock
      lock = null
      await l.release()
    }
  } catch {
    lock = null
  }
}
watch(zoomed, keepAwake)
// 切到別的 App 再回來，系統會自動放掉 wake lock；還在放大就再叫一次
const onVisible = () => {
  if (document.visibilityState === 'visible') void keepAwake()
}
document.addEventListener('visibilitychange', onVisible)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  zoomed.value = null
  void keepAwake()
})

// ── 每張右上的 ⋯ ──
const menu = ref<LoyaltyCard | null>(null)
const menuIdx = computed(() => cards.value.findIndex((c) => c.id === menu.value?.id))
async function menuMove(dir: -1 | 1): Promise<void> {
  const c = menu.value
  menu.value = null
  if (c) await move(c.id, dir)
}
async function menuDelete(): Promise<void> {
  const c = menu.value
  if (!c || !confirm(t('cards.confirmDelete', { name: title(c) }))) return
  menu.value = null
  await remove(c.id)
}

// ── 加卡 ──
const adding = ref(false)
const deck = ref<HTMLElement | null>(null)
/** 存好了：新卡在最下面，捲過去給他看 */
async function added(): Promise<void> {
  adding.value = false
  await nextTick()
  const slots = deck.value?.querySelectorAll<HTMLElement>('.cslot')
  slots?.[slots.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="screen wallet">
    <div class="pad" style="margin-top: 6px"><RouterLink class="back" to="/me">‹ {{ t('me.title') }}</RouterLink></div>
    <div class="pad" style="margin-top: 8px">
      <div class="h1">{{ t('me.cards') }}</div>
      <div v-if="isIn && cards.length" class="sub" style="margin-top: 6px">{{ t('cards.sub', { n: cards.length }) }}</div>
    </div>

    <!-- 沒登入 -->
    <div v-if="ready && !isIn" class="pad" style="margin-top: 14px">
      <div class="empty sub">
        {{ t('cards.signIn') }}
        <div style="margin-top: 12px"><RouterLink class="btn ghost" to="/signin" style="height: 42px; font-size: 15px">{{ t('common.signIn') }}</RouterLink></div>
      </div>
    </div>
    <div v-else-if="!ready || (loading && !cards.length)" class="pad" style="margin-top: 14px">
      <div class="skel" style="height: 280px; border-radius: 22px" />
    </div>

    <template v-else>
      <div v-if="!cards.length" class="pad" style="margin-top: 14px">
        <div class="note sub">{{ t('cards.empty') }}</div>
      </div>
      <div ref="deck" class="deck">
        <div v-for="c in cards" :key="c.id" class="slot cslot">
          <div class="lc" :class="cls(c)" role="button" tabindex="0" @click="zoomed = c" @keydown.enter="zoomed = c">
            <div class="lc-top">
              <div class="lc-name ell">{{ title(c) }}</div>
              <button class="lc-more" type="button" :aria-label="t('cards.more')" @click.stop="menu = c">⋯</button>
            </div>
            <div class="lc-panel">
              <CardBarcode class="lc-bar" :code="c.code" :format="c.format" />
              <div class="lc-num">{{ spaced(c.code) }}</div>
            </div>
          </div>
        </div>
        <div class="slot add">
          <button class="addcard" type="button" @click="adding = true">{{ t('cards.add') }}</button>
        </div>
      </div>
    </template>

    <!-- 掛到 body，才不會被頁面轉場的 transform 影響 fixed 定位（同 ListView） -->
    <Teleport to="body">
      <!-- 放大：點哪裡都關 -->
      <Transition name="fade">
        <div v-if="zoomed" class="zoom" role="dialog" :aria-label="title(zoomed)" @click="zoomed = null">
          <div class="zoom-name"><span class="dot" :class="cls(zoomed)" />{{ title(zoomed) }}</div>
          <CardBarcode class="zoom-bar" :code="zoomed.code" :format="zoomed.format" />
          <div class="zoom-num">{{ spaced(zoomed.code) }}</div>
          <div class="zoom-hint">{{ t('cards.tapClose') }}</div>
        </div>
      </Transition>

      <!-- ⋯：上下移、刪除（刪除再問一次） -->
      <Transition name="sheet" :duration="{ enter: 340, leave: 300 }">
        <div v-if="menu">
          <div class="dim" @click="menu = null" />
          <div class="bsheet" role="dialog" :aria-label="title(menu)">
            <button class="grab-btn" type="button" :aria-label="t('cards.cancel')" @click="menu = null"><div class="grab" /></button>
            <div class="h2" style="font-size: 22px">{{ title(menu) }}</div>
            <div class="sub" style="margin-top: 3px">{{ spaced(menu.code) }}</div>
            <div class="box" style="margin-top: 12px">
              <button v-if="menuIdx > 0" class="lrow tap mrow" type="button" @click="menuMove(-1)">{{ t('cards.moveUp') }}</button>
              <button v-if="menuIdx >= 0 && menuIdx < cards.length - 1" class="lrow tap mrow" type="button" @click="menuMove(1)">{{ t('cards.moveDown') }}</button>
              <button class="lrow tap mrow del" type="button" @click="menuDelete">{{ t('cards.delete') }}</button>
            </div>
            <button class="btn ghost" type="button" style="margin-top: 14px; font-size: 16px" @click="menu = null">{{ t('cards.cancel') }}</button>
          </div>
        </div>
      </Transition>

      <Transition name="sheet" :duration="{ enter: 340, leave: 300 }">
        <AddCardSheet v-if="adding" @done="added" @dismiss="adding = false" />
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* 整頁剛好一個螢幕高，卡片區自己捲 */
.wallet { height: 100vh; height: 100dvh; display: flex; flex-direction: column; }
.deck {
  flex: 1;
  min-height: 0;
  margin-top: 14px;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  overscroll-behavior-y: contain;
  scrollbar-width: none;
}
.deck::-webkit-scrollbar { display: none; }
/* 一格一張卡，比卡片區矮一點，下一張露出頭 */
.slot { height: min(calc(100% - 56px), 560px); min-height: 280px; padding: 0 var(--gutter) 12px; scroll-snap-align: start; }
.slot.add { height: auto; min-height: 0; padding-bottom: 8px; scroll-snap-align: end; }

/* 卡面：底色照超市，其他用深灰 */
.lc {
  height: 100%;
  border-radius: 22px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 12px 24px -16px rgba(0, 0, 0, 0.55);
}
.lc.nw { background: var(--nw); }
.lc.ww { background: var(--ww); }
.lc.pns { background: var(--pns); color: var(--ink); }
.lc.other { background: #3a3a3a; }
.lc-top { display: flex; align-items: center; gap: 10px; }
.lc-name { flex: 1; min-width: 0; padding-left: 4px; font-family: var(--font-head); font-weight: 700; font-size: 26px; letter-spacing: -0.4px; line-height: 1.15; }
.lc-more { flex: none; width: 40px; height: 40px; border-radius: 20px; background: rgba(255, 255, 255, 0.2); color: inherit; font-size: 22px; font-weight: 900; line-height: 1; display: flex; align-items: center; justify-content: center; }
.lc.pns .lc-more { background: rgba(0, 0, 0, 0.08); }
/* 白底條碼區放在卡片中間 */
.lc-panel { margin: auto 0; background: #fff; color: var(--ink); border-radius: 14px; padding: 18px 8px 12px; }
.lc-bar { height: clamp(90px, 20vh, 150px); }
.lc-num, .zoom-num {
  text-align: center;
  font-family: 'Inter Tight', Inter, sans-serif;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
  word-break: break-all;
}
.lc-num { margin-top: 10px; font-size: 24px; line-height: 1.2; }

.addcard {
  width: 100%;
  height: 64px;
  border: 1.5px dashed #AEB8AB;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-head);
  font-weight: 600;
  font-size: 17px;
  color: var(--brand-deep);
}

/* 放大：蓋住整個畫面（連分頁列），全白 */
.zoom {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: #fff;
  color: var(--ink);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: max(24px, env(safe-area-inset-top)) 8px max(24px, env(safe-area-inset-bottom));
  cursor: pointer;
}
.zoom-name { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 800; }
.zoom-bar { width: 100%; height: 36vh; }
.zoom-num { font-size: 34px; line-height: 1.15; padding: 0 12px; }
.zoom-hint { font-size: 13px; color: var(--ink-3); }
.dot.other { background: #3a3a3a; }

.mrow { padding: 15px 12px; font-size: 16px; font-weight: 700; }
.mrow.del { color: var(--nw); }
</style>
