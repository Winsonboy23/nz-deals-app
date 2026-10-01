<script setup lang="ts">
// 價格只在這裡排版（2026-09-15）：大字是「買一件多少錢」；湊件的大字改成「2 件 $7.50」（2026-09-24，[2 件] 小框拿掉）；要會員卡的旁邊加 [卡] 小框；
// 沒原價的綠超促銷加灰底小框（[本週鮮價]／[低價]／[清倉]，2026-09-24）。
// detail 開著就多一行說明：一般價（會員價的）／幾件多少、每件多少（湊件的）／劃掉的原價；unit 開著再加每公斤／每 100 克。
// brief 開著，說明行只放第一樣（條件 → 劃掉的原價 → 單價）：首頁「這週最划算」那種窄卡（Chris 首頁改版規格 §2）。
// 列表卡片、商品頁、同類可比清單都用這一個，三處才不會一處有標一處沒標。字級跟著外層（.price / .p）走。
// 會員價和半價的價格數字是橘色（class hot，2026-10-01 首頁改版規格 §2）；其他價格黑色，包含一般有原價的特價。
// wasFirst 開著就把劃掉的原價放在現價前面同一行（首頁的生鮮、半價小卡）。
import { computed } from 'vue'
import { multiUnitPrice } from '../lib/compare'
import { money, priceSuffix, unitLabel, wasPriceOf } from '../lib/format'
import { t } from '../composables/useI18n'
import type { Special } from '../lib/types'

const props = defineProps<{ special: Special; detail?: boolean; unit?: boolean; align?: 'left' | 'right'; wrap?: boolean; wasFirst?: boolean; brief?: boolean }>()
const s = computed(() => props.special)
const multi = computed(() => (s.value.multi_buy && s.value.multi_buy.qty > 0 ? s.value.multi_buy : null))
const was = computed(() => wasPriceOf(s.value))
/**
 * 綠超沒原價的促銷（Fresh Deal／Low Price／Clearance，本週約 740 筆）：沒劃掉的價，不標一下看起來就是一般價
 * （2026-09-24 合作夥伴以為葡萄 $7.99 Fresh Deal 沒特價）。只標名字，沒原價所以不寫省多少。
 */
const PROMO: Record<string, string> = { FreshDeal: 'price.freshDeal', LowPrice: 'price.lowPrice', Clearance: 'price.clearance' }
const promo = computed(() => {
  const k = PROMO[s.value.promo_type ?? '']
  return k && !was.value ? t(k) : ''
})

/** 條件的說明：會員價 → 一般價多少；湊件 → 幾件多少（每件多少） */
const terms = computed(() => {
  const out: string[] = []
  if (s.value.club_only && was.value) out.push(t('price.regular', { v: money(was.value) }))
  if (multi.value) {
    out.push(t('price.multiDetail', { u: money(multiUnitPrice(s.value) as number), s: money(s.value.price) + (priceSuffix(s.value) ?? '') }))
  }
  return out
})
/** 劃掉的原價：不是會員價、又有原價才劃（會員價那行已經寫了一般價，不再劃一次） */
const strike = computed(() => (!s.value.club_only && was.value ? money(was.value) : ''))
/** 橘色的價格數字：會員價，或半價以上（原價的一半以下；黃超沒有原價，wasPriceOf 已經是 null） */
const hot = computed(() => s.value.club_only || (!!was.value && s.value.price <= was.value / 2))
const unitText = computed(() => {
  if (!props.unit) return null
  const u = unitLabel(s.value)
  return u === money(s.value.price) + '/kg' ? null : u   // 按公斤賣的，大字已經是每公斤價，不重複寫
})
/** 說明行的順序：條件（一般價／湊件）→ 劃掉的原價（wasFirst 時已經放到現價前面）→ 單價；窄卡片截掉的是最後面的單價，不是條件 */
const parts = computed<Array<{ text: string; strike?: boolean }>>(() => {
  if (!props.detail) return []
  const out: Array<{ text: string; strike?: boolean }> = terms.value.map((text) => ({ text }))
  if (strike.value && !props.wasFirst) out.push({ text: strike.value, strike: true })
  if (unitText.value) out.push({ text: unitText.value })
  return props.brief ? out.slice(0, 1) : out
})
</script>

<template>
  <span class="pl" :class="{ right: align === 'right', wrap, hot }">
    <s v-if="wasFirst && strike" class="pl-was">{{ strike }}</s>
    <!-- 湊件的大字是「2 件 $7.50」（2026-09-24 使用者：大字 $4.15 旁邊掛 [2 件] 看起來像 4.15 買兩件）；單買價退到說明行 -->
    <span v-if="multi" class="pl-main"><span class="qty">{{ t('price.multiQty', { q: multi.qty }) }}</span>{{ money(multi.total) }}</span>
    <span v-else class="pl-main">{{ money(s.price) }}<span v-if="priceSuffix(s)" class="unit">{{ priceSuffix(s) }}</span></span>
    <span v-if="s.club_only" class="cond club">{{ t('price.club') }}</span>
    <span v-if="promo" class="cond promo">{{ promo }}</span>
    <span v-if="parts.length" class="pl-detail">
      <template v-for="(x, i) in parts" :key="i"><template v-if="i"> · </template><s v-if="x.strike">{{ x.text }}</s><template v-else>{{ x.text }}</template></template>
    </span>
  </span>
</template>
