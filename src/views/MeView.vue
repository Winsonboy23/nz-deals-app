<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useStores } from '../composables/useStores'
import { useSettings } from '../composables/useSettings'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'
import { usePush } from '../composables/usePush'
import { useAdmin } from '../composables/useAdmin'
import { cardCls as cls, cardTitle as title, useCards, type LoyaltyCard } from '../composables/useCards'
import CardBarcode from '../components/CardBarcode.vue'
import AddCardSheet from '../components/AddCardSheet.vue'
import { lang, setLang, t } from '../composables/useI18n'
import { chainName } from '../lib/format'
import { AccountError, deleteAccount } from '../lib/account'
import { isTap, nextIndex, prevIndex, stackOrder } from '../lib/cardStack'

const { selectedStores } = useStores()
const { foodOnly } = useSettings()
const { user, isIn, name, avatar, signOut } = useAuth()
/** 用哪個帳號登入的（Supabase 的 app_metadata.provider：google / facebook） */
const providerName = computed(() => (user.value?.app_metadata?.provider === 'facebook' ? 'Facebook' : 'Google'))
const { watched, merged } = useSync()
const { isAdmin } = useAdmin()
const push = usePush()
const pushLine = computed(() => {
  if (push.error.value) return t('me.notifyFailed', { e: push.error.value })
  const k: Record<string, string> = { on: 'me.notifyOn', off: 'me.notifyHint', busy: 'me.notifyBusy', denied: 'me.notifyDenied', unsupported: 'me.notifyUnsupported', 'ios-not-installed': 'me.notifyIos' }
  return t(k[push.state.value] ?? 'me.notifyHint')
})
const pushToggle = computed(() => ['on', 'off', 'busy'].includes(push.state.value))

const town = computed(() => {
  const first = selectedStores.value[0]
  if (!first) return ''
  return first.name.replace(chainName(first.id), '').replace(/\s+/g, ' ').trim() || first.name
})

// ── 會員卡錢包（2026-11-04 Chris 用手機測：原本要再進一頁 /me/cards 才能換卡、加卡，結帳排隊時多一步；整個錢包搬進這頁，那頁拿掉）──
// 2026-10-01 規格「疊卡左右滑」（docs/kitewise-home-v2-spec.md §四）：最前面那張完整（條碼、號碼），後面最多兩張往右下錯開、縮小一點露出邊。
// 左右拖最前面那張超過 60px 放開 → 甩出去再塞到最後、下一張彈上來；太短彈回原位；點後面露出來的那張也換。換卡只改本機「最前面是哪張」，
// 不動資料庫的 position（順序在 ⋯ 裡調）。疊的最後一張固定是「＋ 新增會員卡」（虛線框），點了開加卡面板；沒卡的人只看到這張。
// 點最前面的真卡放大：全白底、條碼拉到最大、螢幕不暗（有 wakeLock 就叫；瀏覽器沒辦法調亮度，白底就是能做到的極限）。只給登入者（useCards）。
const { cards, loading: cardsLoading, remove, move } = useCards()
const ADD_ID = '__add__'
/** 疊裡固定在最後的「＋」：不是真卡，沒條碼、沒 ⋯ */
const addSlot: LoyaltyCard = { id: ADD_ID, chain: 'other', label: null, code: '', format: 'CODE128', position: -1 }
const isAdd = (c: LoyaltyCard) => c.id === ADD_ID
const deck = computed(() => [...cards.value, addSlot])
/** 卡面最下面一行：哪些店能刷。Club+ 三家、Everyday Rewards 綠超、其他就是自己取的名字 */
const foot = (c: LoyaltyCard) => (c.chain === 'clubplus' ? t('cards.clubplusFoot') : c.chain === 'woolworths' ? 'Woolworths' : c.label || '')
/** 號碼四個一組，店員照著打不容易看錯 */
const spaced = (code: string) => code.replace(/(.{4})(?=.)/g, '$1 ')

// ── 疊卡 ──
/** 最前面那張在 deck 裡的位置（超出範圍時 stackOrder 會繞回來） */
const cur = ref(0)
const order = computed(() => stackOrder(cur.value, deck.value.length))
const frontIdx = computed(() => order.value[0] ?? 0)
const front = computed<LoyaltyCard | undefined>(() => deck.value[frontIdx.value])
/** 每張卡在疊裡的深度：0 = 最前面 */
const depth = computed(() => new Map(order.value.map((i, d) => [deck.value[i].id, d])))
/** 後面露出幾張（最多兩張），決定卡片要讓出多少右下的邊 */
const back = computed(() => Math.min(2, Math.max(0, deck.value.length - 1)))
const isFront = (c: LoyaltyCard) => c.id === front.value?.id

const FLY_MS = 280   // 跟 .lc 的 transition 一樣長
/** 正在甩出去的那張（往左 -1／往右 +1）：先飛到畫面外，時間到再照新的深度滑回最後面 */
const flyOut = ref<{ id: string; dir: number } | null>(null)
/** 「上一張」：要滑進來的那張，先不動畫地擺到左邊畫面外 */
const flyIn = ref<string | null>(null)
let flyTimer: ReturnType<typeof setTimeout> | undefined
/** 還在飛、或手指正拖著（拖曳中按方向鍵不換） */
const busy = () => !!flyOut.value || !!flyIn.value || dragX.value !== null
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const stackEl = ref<HTMLElement | null>(null)
/** 焦點在疊裡（鍵盤在用）→ 換完卡把焦點交給新的最前面那張，不要留在退到後面（aria-hidden）的卡上 */
const focusInStack = () => !!stackEl.value?.contains(document.activeElement)
function focusFront(): void {
  void nextTick(() => stackEl.value?.querySelector<HTMLElement>('.lc.d0')?.focus({ preventScroll: true }))
}

/** 最前面那張甩出去（dir 是方向），換 to 那張到最前面 */
function throwFront(dir: number, to: number): void {
  const f = front.value
  if (!f || to === frontIdx.value || to < 0) return
  const refocus = focusInStack()
  cur.value = to
  // 不要動畫的人：直接換，不飛
  if (!reducedMotion()) {
    flyOut.value = { id: f.id, dir }
    clearTimeout(flyTimer)
    flyTimer = setTimeout(() => (flyOut.value = null), FLY_MS)
  }
  if (refocus) focusFront()
}
/** 下一張：後面第一張換上來，最前面那張往左甩 */
function next(): void {
  const behind = order.value[1]
  if (behind !== undefined && !busy()) throwFront(-1, behind)
}
/** 上一張：最後面那張從左邊滑進來蓋在最上面 */
function prev(): void {
  if (deck.value.length < 2 || busy()) return
  const to = prevIndex(cur.value, deck.value.length)
  const refocus = focusInStack()
  const commit = () => {
    flyIn.value = null
    cur.value = to
    if (refocus) focusFront()
  }
  if (reducedMotion()) return commit()
  flyIn.value = deck.value[to].id
  // 兩格之後才換：讓瀏覽器先畫一次「在畫面外」的位置，滑進來的動畫才有起點
  requestAnimationFrame(() => requestAnimationFrame(commit))
}
/** 點下面的圓點：直接換到第 i 張（往後甩左、往前甩右） */
function goTo(i: number): void {
  if (i === frontIdx.value || busy()) return
  throwFront(i > frontIdx.value ? -1 : 1, i)
}

// 拖曳：pointer events（手指、滑鼠都走這條；滑鼠只認左鍵）。移動不到 8px 放開＝點一下（放大／加卡）；超過就是拖，
// 左右為主才拖卡，上下為主讓頁面捲（touch-action: pan-y）
let pid = -1
let x0 = 0
let y0 = 0
/** 這次按下去還算不算「點一下」：拖過就不算，接著來的 click 不放大 */
let tapOk = true
/** 拖曳中的左右位移；null = 沒在拖 */
const dragX = ref<number | null>(null)

function onDown(e: PointerEvent, c: LoyaltyCard): void {
  tapOk = true
  // ⋯ 按鈕自己處理；後面的卡只能點
  if (!isFront(c) || !e.isPrimary || e.button !== 0 || (e.target as Element).closest('button')) return
  pid = e.pointerId
  x0 = e.clientX
  y0 = e.clientY
}
function onMove(e: PointerEvent): void {
  if (e.pointerId !== pid) return
  const dx = e.clientX - x0
  const dy = e.clientY - y0
  if (dragX.value === null) {
    if (isTap(dx, dy)) return
    tapOk = false
    // 上下為主（要捲頁面）、只有一張、上一張還在飛 → 不拖
    if (Math.abs(dy) > Math.abs(dx) || deck.value.length < 2 || busy()) {
      pid = -1
      return
    }
    // 開始拖才抓住指標：只是點一下的話不抓，click 才會照常落在 ⋯ 或卡片上
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  dragX.value = dx
}
function onUp(e: PointerEvent): void {
  if (e.pointerId !== pid) return
  pid = -1
  if (dragX.value === null) return
  const dx = e.clientX - x0
  dragX.value = null
  // 夠遠 → 往拖的方向甩出去；不夠遠 → 拿掉跟手的位移，卡片照 .d0 的位置彈回去
  const to = nextIndex(cur.value, deck.value.length, dx)
  if (to !== frontIdx.value) throwFront(dx < 0 ? -1 : 1, to)
}
function onCancel(e: PointerEvent): void {
  if (e.pointerId !== pid) return
  pid = -1
  dragX.value = null
}
/** 拖曳中最前面那張跟著手指走、微微轉（最多 6 度） */
function dragStyle(c: LoyaltyCard): Record<string, string> | undefined {
  if (dragX.value === null || !isFront(c)) return undefined
  const rot = Math.max(-6, Math.min(6, dragX.value * 0.04))
  return { transform: `translate(${dragX.value}px, 0px) rotate(${rot}deg) scale(1)`, transition: 'none' }
}
/** 每張卡的位置 class：d0 最前面、d1 / d2 後面露出邊、dx 再後面的藏起來；甩出去和滑進來另外算 */
function pos(c: LoyaltyCard): string {
  if (flyOut.value?.id === c.id) return flyOut.value.dir < 0 ? 'out-l' : 'out-r'
  if (flyIn.value === c.id) return 'in-l'
  const d = depth.value.get(c.id) ?? 0
  return d <= 2 ? 'd' + d : 'dx'
}
/** 點最前面那張：真卡放大、「＋」開加卡；點後面露出來的那張 → 換它到前面 */
function onCardClick(c: LoyaltyCard): void {
  if (!tapOk) {
    tapOk = true   // 剛剛是拖曳，不算點
    return
  }
  if (!isFront(c)) {
    if (!busy()) throwFront(-1, deck.value.indexOf(c))
  } else if (isAdd(c)) adding.value = true
  else zoomed.value = c
}

// 左右方向鍵也能換（放大、選單、加卡／編輯開著時不管；打字時不搶）
function onKey(e: KeyboardEvent): void {
  if (!isIn.value || zoomed.value || menu.value || adding.value || editing.value || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === 'ArrowRight') next()
  else if (e.key === 'ArrowLeft') prev()
  else return
  e.preventDefault()
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimeout(flyTimer)
})

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

// ── 每張右上的 ⋯（作用在最前面那張；後面的卡點了只是換到前面）：編輯、上下移、刪除 ──
const menu = ref<LoyaltyCard | null>(null)
const menuIdx = computed(() => cards.value.findIndex((c) => c.id === menu.value?.id))
/** 正在編輯的那張（開同一個 AddCardSheet，欄位先填好） */
const editing = ref<LoyaltyCard | null>(null)
function menuEdit(): void {
  editing.value = menu.value
  menu.value = null
}
async function menuMove(dir: -1 | 1): Promise<void> {
  const c = menu.value
  menu.value = null
  if (!c) return
  const saving = move(c.id, dir)   // move() 先同步改好畫面上的順序，再寫資料庫
  cur.value = cards.value.findIndex((x) => x.id === c.id)   // 移完還是這張在最前面
  await saving
}
async function menuDelete(): Promise<void> {
  const c = menu.value
  if (!c || !confirm(t('cards.confirmDelete', { name: title(c) }))) return
  menu.value = null
  await remove(c.id)
  // 原本後面那張補上來；刪的是最後一張真卡 → 停在新的最後一張，不要跳到「＋」
  if (cur.value >= cards.value.length && cards.value.length) cur.value = cards.value.length - 1
}

// ── 加卡 ──
const adding = ref(false)
/** 存好了：新卡排在最後，直接換到最前面給他看；編輯完就留在原來那張 */
async function cardSaved(): Promise<void> {
  if (editing.value) {
    editing.value = null
    return
  }
  adding.value = false
  cur.value = cards.value.length - 1
  await nextTick()
  stackEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function toggleFood() {
  foodOnly.value = !foodOnly.value
}

// 刪除帳號：點「刪除帳號」展開確認，再按「我確定要刪除」才真的刪。成功會整頁重載，不會回到這裡。
const confirming = ref(false)
const deleting = ref(false)
const deleteError = ref('')
async function doDelete() {
  if (deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await deleteAccount()
  } catch (e) {
    deleteError.value = e instanceof AccountError && e.code === 'signIn' ? t('me.deleteSignIn') : t('me.deleteFailed', { e: e instanceof Error ? e.message : String(e) })
    deleting.value = false
  }
}
</script>

<template>
  <div class="screen">
    <!-- E1 · Merged：剛登入、訪客資料合併進帳號 -->
    <div v-if="merged" class="pad" style="margin-top: 12px">
      <div class="note" style="display: flex; gap: 10px; align-items: center">
        <span style="font-size: 18px">✓</span>
        <span style="font-size: 13px; font-weight: 600">{{ t('auth.merged') }}</span>
        <button class="link" style="margin-left: auto" @click="merged = false">×</button>
      </div>
    </div>

    <!-- E3 · 登入後：頭像＋名字（設計稿）／E4 · 訪客：綠底卡 -->
    <div v-if="isIn" class="pad me-top">
      <span class="me-av">
        <img v-if="avatar" :src="avatar" alt="" referrerpolicy="no-referrer" />
        <template v-else>{{ name.slice(0, 1).toUpperCase() }}</template>
      </span>
      <div style="flex: 1; min-width: 0">
        <div class="me-name ell">{{ name }}</div>
        <div class="me-via">{{ t('auth.signedInAs', { p: providerName }) }}</div>
      </div>
      <button class="me-out" @click="signOut()">{{ t('auth.signOut') }}</button>
    </div>
    <div v-else class="pad" style="margin-top: 16px">
      <div class="guest">
        <div class="h2">{{ t('me.guest') }}</div>
        <div class="guest-body">{{ t('me.guestBody') }}</div>
        <RouterLink class="btn" to="/signin">{{ t('auth.google') }}</RouterLink>
      </div>
    </div>

    <!-- 會員卡：登入才有。整個錢包就在這裡：左右滑換卡、點放大、⋯ 編輯刪除、最後一張是「＋」 -->
    <template v-if="isIn">
      <div class="pad" style="margin-top: 22px">
        <div class="h2">{{ t('me.cards') }}</div>
      </div>
      <div v-if="cardsLoading && !cards.length" class="pad" style="margin-top: 10px"><div class="skel" style="height: 300px; border-radius: 22px" /></div>
      <template v-else>
        <!-- 疊卡：DOM 照清單順序不動（換卡才有動畫），位置全靠 class（d0 / d1 / d2…）和拖曳時的 style -->
        <div class="deck">
          <div ref="stackEl" class="stack" :style="{ '--back': back }">
            <div class="sizer" />
            <div
              v-for="c in deck"
              :key="c.id"
              class="lc"
              :class="[isAdd(c) ? 'add' : cls(c), pos(c)]"
              :style="dragStyle(c)"
              :role="isFront(c) ? 'button' : undefined"
              :tabindex="isFront(c) ? 0 : -1"
              :aria-hidden="isFront(c) ? undefined : 'true'"
              :aria-label="isAdd(c) ? t('cards.addCard') : undefined"
              @pointerdown="onDown($event, c)"
              @pointermove="onMove"
              @pointerup="onUp"
              @pointercancel="onCancel"
              @click="onCardClick(c)"
              @keydown.enter.self="isFront(c) && (isAdd(c) ? (adding = true) : (zoomed = c))"
            >
              <template v-if="isAdd(c)">
                <div class="add-plus" aria-hidden="true">＋</div>
                <div class="add-text">{{ t('cards.addCard') }}</div>
              </template>
              <template v-else>
                <div class="lc-top">
                  <div class="lc-name ell">{{ title(c) }}</div>
                  <!-- Club+：紅超黃超都能用 -->
                  <span v-if="c.chain === 'clubplus'" class="cp-dots" aria-hidden="true"><i class="nw" /><i class="pns" /></span>
                  <button class="lc-more" type="button" :tabindex="isFront(c) ? 0 : -1" :aria-label="t('cards.more')" @click.stop="isFront(c) ? (menu = c) : onCardClick(c)">⋯</button>
                </div>
                <div class="lc-panel">
                  <CardBarcode class="lc-bar" :code="c.code" :format="c.format" />
                  <div class="lc-num">{{ spaced(c.code) }}</div>
                </div>
                <div v-if="foot(c)" class="lc-foot">{{ foot(c) }}</div>
              </template>
            </div>
          </div>
        </div>
        <!-- 第幾張：● ○ ○ ＋，點了直接換 -->
        <div v-if="deck.length > 1" class="pad dots" aria-live="polite">
          <button
            v-for="(c, i) in deck"
            :key="c.id"
            type="button"
            class="dotb"
            :class="{ on: i === frontIdx, plus: isAdd(c) }"
            :aria-label="isAdd(c) ? t('cards.addCard') : title(c)"
            :aria-current="i === frontIdx ? 'true' : undefined"
            @click="goTo(i)"
          >
            <template v-if="isAdd(c)">＋</template>
          </button>
        </div>
      </template>
    </template>

    <div class="pad" style="margin-top: 22px">
      <div class="box">
        <RouterLink class="lrow tap" to="/stores" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.myStores') }}</div></div>
          <div class="link"><template v-if="town">{{ town }} · </template>{{ selectedStores.length }} ›</div>
        </RouterLink>
        <RouterLink v-if="isIn" class="lrow tap" to="/watching" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.watching') }}</div></div>
          <div class="link">{{ watched.size }} ›</div>
        </RouterLink>
        <RouterLink v-if="isIn" class="lrow tap" to="/me/recipes" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.recipes') }}</div></div>
          <div class="link">›</div>
        </RouterLink>
        <!-- 後台：只有 admins 表裡的 email 看得到（docs/admin-spec.md §1） -->
        <RouterLink v-if="isAdmin" class="lrow tap" to="/admin" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">後台</div></div>
          <div class="link">›</div>
        </RouterLink>
        <div class="lrow" style="padding: 9px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.language') }}</div></div>
          <div class="seg" style="width: 150px; flex: none">
            <div :class="{ on: lang === 'en' }" @click="setLang('en')">EN</div>
            <div :class="{ on: lang === 'zh' }" @click="setLang('zh')">中文</div>
          </div>
        </div>
        <div class="lrow" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.foodOnly') }}</div></div>
          <button class="tg" :class="{ off: !foodOnly }" @click="toggleFood" />
        </div>
      </div>
    </div>

    <!-- 推播（登入才有）。iPhone 要加入主畫面才開得了 -->
    <div v-if="isIn" class="pad" style="margin-top: 16px">
      <div class="box">
        <div class="lrow" style="padding: 14px 12px">
          <div class="grow" style="min-width: 0">
            <div class="t" style="font-size: 16px">{{ t('me.notify') }}</div>
            <div class="s" style="white-space: normal">{{ pushLine }}</div>
          </div>
          <button v-if="pushToggle" class="tg" :class="{ off: push.state.value !== 'on' }" :disabled="push.state.value === 'busy'" style="flex: none" @click="push.state.value === 'on' ? push.disable() : push.enable()" />
        </div>
      </div>
    </div>

    <div class="pad" style="margin-top: 16px">
      <div class="box">
        <RouterLink class="lrow tap" to="/about" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.about') }}</div></div>
          <div class="link">›</div>
        </RouterLink>
        <RouterLink class="lrow tap" to="/privacy" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('legal.privacy') }}</div></div>
          <div class="link">›</div>
        </RouterLink>
        <!-- 刪除帳號（登入才有） -->
        <button v-if="isIn" class="lrow tap" style="padding: 14px 12px" :disabled="deleting" @click="confirming = !confirming">
          <div class="grow"><div class="t" style="font-size: 16px; color: #b00020">{{ t('me.deleteAccount') }}</div></div>
        </button>
        <div v-if="isIn && confirming" style="border-top: 1px solid var(--line); padding: 14px 12px">
          <div style="font-size: 14px; line-height: 1.5">{{ t('me.deleteBody') }}</div>
          <button class="btn" style="margin-top: 12px; height: 48px; font-size: 16px" :style="{ background: deleting ? 'var(--ink-3)' : '#b00020' }" :disabled="deleting" @click="doDelete">
            {{ deleting ? t('me.deleting') : t('me.deleteConfirm') }}
          </button>
          <div v-if="deleteError" style="margin-top: 8px; font-size: 13px; line-height: 1.4; color: #b00020">{{ deleteError }}</div>
          <button v-if="!deleting" class="link" style="display: block; margin: 12px auto 0" @click="confirming = false">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>

    <div class="pad sub muted" style="margin-top: 16px; font-size: 13px">{{ t('me.footnote') }}</div>

    <!-- 掛到 body，才不會被頁面轉場的 transform 影響 fixed 定位（同 ListView） -->
    <Teleport to="body">
      <!-- 放大：點哪裡都關 -->
      <Transition name="fade">
        <div v-if="zoomed" class="zoom" role="dialog" :aria-label="title(zoomed)" @click="zoomed = null">
          <div class="zoom-name">
            <span v-if="zoomed.chain === 'clubplus'" class="cp-dots" aria-hidden="true"><i class="nw" /><i class="pns" /></span>
            <span v-else class="dot" :class="cls(zoomed)" />{{ title(zoomed) }}
          </div>
          <CardBarcode class="zoom-bar" :code="zoomed.code" :format="zoomed.format" />
          <div class="zoom-num">{{ spaced(zoomed.code) }}</div>
          <div class="zoom-hint">{{ t('cards.tapClose') }}</div>
        </div>
      </Transition>

      <!-- ⋯：編輯、上下移、刪除（刪除再問一次） -->
      <Transition name="sheet" :duration="{ enter: 340, leave: 300 }">
        <div v-if="menu">
          <div class="dim" @click="menu = null" />
          <div class="bsheet" role="dialog" :aria-label="title(menu)">
            <button class="grab-btn" type="button" :aria-label="t('cards.cancel')" @click="menu = null"><div class="grab" /></button>
            <div class="h2" style="font-size: 22px">{{ title(menu) }}</div>
            <div class="sub" style="margin-top: 3px">{{ spaced(menu.code) }}</div>
            <div class="box" style="margin-top: 12px">
              <button class="lrow tap mrow" type="button" @click="menuEdit">{{ t('cards.edit') }}</button>
              <button v-if="menuIdx > 0" class="lrow tap mrow" type="button" @click="menuMove(-1)">{{ t('cards.moveUp') }}</button>
              <button v-if="menuIdx >= 0 && menuIdx < cards.length - 1" class="lrow tap mrow" type="button" @click="menuMove(1)">{{ t('cards.moveDown') }}</button>
              <button class="lrow tap mrow del" type="button" @click="menuDelete">{{ t('cards.delete') }}</button>
            </div>
            <button class="btn ghost" type="button" style="margin-top: 14px; font-size: 16px" @click="menu = null">{{ t('cards.cancel') }}</button>
          </div>
        </div>
      </Transition>

      <!-- 加卡／編輯用同一個面板（編輯時 card 有值、欄位先填好） -->
      <Transition name="sheet" :duration="{ enter: 340, leave: 300 }">
        <AddCardSheet v-if="adding || editing" :card="editing" @done="cardSaved" @dismiss="adding = false; editing = null" />
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* 頭像＋名字 */
.me-top { display: flex; align-items: center; gap: 14px; margin-top: 18px; }
.me-av {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  flex: none;
  overflow: hidden;
  border: 2px solid var(--card);
  box-shadow: var(--shadow);
  background: var(--brand-tint);
  color: var(--brand-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-head);
  font-weight: 700;
  font-size: 24px;
}
.me-av img { width: 100%; height: 100%; object-fit: cover; }
.me-name { font-family: var(--font-head); font-weight: 700; font-size: 22px; line-height: 1.2; letter-spacing: -0.2px; }
.me-via { margin-top: 2px; font-size: 13px; color: var(--ink-3); }
.me-out { flex: none; height: 32px; padding: 0 13px; border-radius: 16px; border: 1.5px solid var(--brand); color: var(--brand-deep); background: var(--card); font-size: 13px; font-weight: 700; }

/* 訪客：中間綠底白字卡，按鈕白底深綠字 */
.guest { background: var(--brand); color: #fff; border-radius: 18px; padding: 18px; box-shadow: var(--shadow); }
.guest-body { margin-top: 8px; font-size: 14px; line-height: 1.5; color: rgba(255, 255, 255, 0.9); }
.guest .btn { margin-top: 16px; height: 52px; background: var(--card); color: var(--brand-deep); }

/* ── 會員卡疊（從原本的 /me/cards 頁搬來，2026-11-04）── */
/* 疊卡區：整條寬，甩出去的卡到畫面邊緣切掉、不會撐出橫向捲動。clip 不會變成捲動區（卡片陰影、轉動不會被上下切到），舊瀏覽器退回 hidden
   （不叫 .stage：design.css 的 .stage 是設計稿畫板，會變成 flex） */
.deck { margin-top: 10px; padding: 6px 0 4px; overflow: hidden; user-select: none; -webkit-user-select: none; }
@supports (overflow: clip) {
  .deck { overflow: visible; overflow-x: clip; }
}
/* 卡片都疊在左上角；右邊和下面讓出後面那幾張露出來的邊（每張 12px），--back = 後面露出幾張。
   露出的邊不能比卡片內距（14px × 縮小比例）寬，不然後面那張的白色條碼區、字會從邊上漏出一條 */
.stack { position: relative; margin: 0 var(--gutter); padding: 0 calc(var(--back) * 12px) calc(var(--back) * 12px) 0; }
/* 卡片高度：在「我的」頁裡是一段，不佔整個畫面；條碼區夠高就好 */
.sizer { height: clamp(270px, 76vw, 340px); }

/* 卡面：Club+ 深色、Everyday Rewards 綠超色、其他深灰、「＋」虛線淡底 */
.lc {
  position: absolute;
  top: 0;
  left: 0;
  right: calc(var(--back) * 12px);
  bottom: calc(var(--back) * 12px);
  border-radius: 22px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 12px 24px -16px rgba(0, 0, 0, 0.55);
  /* 上下滑照常捲頁面，左右交給我們拖 */
  touch-action: pan-y;
  /* 以底邊中間為軸：拖的時候上面擺得比下面多；縮小時底邊不動 */
  transform-origin: 50% 100%;
  transition: transform 0.28s var(--ease), opacity 0.28s var(--ease);
}
/* 位置（每個 transform 都寫成 translate rotate scale 同一組，動畫才會一項一項補間）
   後面的卡縮小後右邊會內縮 1.5%／3%，translate 加回來，露出的邊剛好 12px、24px（以底邊為軸，下面不用補） */
.lc.d0 { z-index: 4; transform: translate(0px, 0px) rotate(0deg) scale(1); }
.lc.d1 { z-index: 3; transform: translate(calc(12px + 1.5%), 12px) rotate(0deg) scale(0.97); }
.lc.d2 { z-index: 2; transform: translate(calc(24px + 3%), 24px) rotate(0deg) scale(0.94); }
.lc.dx { z-index: 1; transform: translate(calc(24px + 3%), 24px) rotate(0deg) scale(0.94); opacity: 0; pointer-events: none; }
/* 甩出去：疊在最上面飛到畫面外（往下帶一點，抵掉轉動時上角翹起來的高度）；時間到換回深度 class，就從旁邊滑回最後面 */
.lc.out-l { z-index: 5; transform: translate(calc(-100% - 80px), 24px) rotate(-10deg) scale(1); }
.lc.out-r { z-index: 5; transform: translate(calc(100% + 80px), 24px) rotate(10deg) scale(1); }
/* 上一張：先不動畫地擺到左邊畫面外、最上面，下一格換成 d0 就滑進來 */
.lc.in-l { z-index: 5; transform: translate(calc(-100% - 80px), 24px) rotate(-10deg) scale(1); transition: none; }

.lc.cp { background: linear-gradient(145deg, #2b3b31 0%, #18221b 55%, #101712 100%); }
.lc.ww { background: var(--ww); }
.lc.other { background: #3a3a3a; }
/* 「＋ 新增會員卡」：虛線框、淡底、中間一個大 ＋ */
.lc.add { background: var(--card); color: var(--brand); border: 1.5px dashed #AEB8AB; box-shadow: none; align-items: center; justify-content: center; gap: 8px; }
.add-plus { font-size: 72px; font-weight: 300; line-height: 1; }
.add-text { font-family: var(--font-head); font-weight: 600; font-size: 16px; color: var(--brand-deep); }
.lc-top { display: flex; align-items: center; gap: 10px; }
/* 窄手機字小一點，「Everyday Rewards」才不會被切成「Everyday Rewar…」 */
.lc-name { flex: 1; min-width: 0; padding-left: 4px; font-family: var(--font-head); font-weight: 700; font-size: clamp(22px, 6.6vw, 26px); letter-spacing: -0.4px; line-height: 1.15; }
.lc.cp .lc-name { font-size: 30px; }
.lc-more { flex: none; width: 40px; height: 40px; border-radius: 20px; background: rgba(255, 255, 255, 0.2); color: inherit; font-size: 22px; font-weight: 900; line-height: 1; display: flex; align-items: center; justify-content: center; }
/* Club+ 右上：紅、黃兩個小圓點（紅超黃超都能用），白邊跟商品圖上的超市圓點一樣 */
.cp-dots { flex: none; display: inline-flex; gap: 5px; }
.cp-dots i { width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9); }
.cp-dots .nw { background: var(--nw); }
.cp-dots .pns { background: var(--pns); }
/* 白底條碼區放在卡片中間。卡片高度固定（疊卡），矮螢幕放不下時條碼先變矮，號碼和底下那行字不會被切掉 */
.lc-panel { margin: auto 0; min-height: 0; display: flex; flex-direction: column; background: #fff; color: var(--ink); border-radius: 14px; padding: 18px 8px 12px; }
.lc-bar { flex: 0 1 auto; min-height: 48px; height: clamp(80px, 18vh, 130px); }
/* keep-all：窄手機要換行時在空白、頓號處換，「都能刷」不會被拆開 */
.lc-foot { margin-top: 10px; padding: 0 4px; font-size: 12.5px; font-weight: 600; line-height: 1.3; opacity: 0.85; word-break: keep-all; }
.lc-num, .zoom-num {
  text-align: center;
  font-family: var(--font);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
  word-break: break-all;
}
/* 疊卡讓出右邊的邊、卡片窄一點：窄手機（360）字小一點，16 位號碼才排得進一行 */
.lc-num { margin-top: 10px; font-size: clamp(20px, 6.2vw, 24px); line-height: 1.2; }

/* 第幾張：● ○ ○ ＋（最後一顆是「＋」那張） */
.dots { display: flex; justify-content: center; gap: 6px; margin-top: 8px; }
.dotb { width: 24px; height: 24px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--ink-3); font-size: 15px; font-weight: 800; line-height: 1; }
.dotb::before { content: ''; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--brand); }
.dotb.on::before { background: var(--brand); }
.dotb.plus::before { content: none; }
.dotb.plus.on { color: var(--brand); }

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
