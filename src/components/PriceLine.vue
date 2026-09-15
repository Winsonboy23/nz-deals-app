<script setup lang="ts">
// 價格只在這裡排版（2026-09-15）：大字永遠是「買一件多少錢」；有條件的旁邊加小框——[卡] 要會員卡、[2 件] 要湊件。
// detail 開著就多一行說明：一般價（會員價的）／幾件多少、每件多少（湊件的）／劃掉的原價；unit 開著再加每公斤／每 100 克。
// 列表卡片、商品頁、同類可比清單都用這一個，三處才不會一處有標一處沒標。字級跟著外層（.price / .p）走。
import { computed } from 'vue'
import { multiUnitPrice } from '../lib/compare'
import { money, priceSuffix, unitLabel, wasPriceOf } from '../lib/format'
import { t } from '../composables/useI18n'
import type { Special } from '../lib/types'

const props = defineProps<{ special: Special; detail?: boolean; unit?: boolean; align?: 'left' | 'right'; wrap?: boolean }>()
const s = computed(() => props.special)
const multi = computed(() => (s.value.multi_buy && s.value.multi_buy.qty > 0 ? s.value.multi_buy : null))
const was = computed(() => wasPriceOf(s.value))

/** 條件的說明：會員價 → 一般價多少；湊件 → 幾件多少（每件多少） */
const terms = computed(() => {
  const out: string[] = []
  if (s.value.club_only && was.value) out.push(t('price.regular', { v: money(was.value) }))
  if (multi.value) {
    out.push(t('price.multiDetail', { q: multi.value.qty, v: money(multi.value.total), u: money(multiUnitPrice(s.value) as number) }))
  }
  return out
})
/** 劃掉的原價：不是會員價、又有原價才劃（會員價那行已經寫了一般價，不再劃一次） */
const strike = computed(() => (!s.value.club_only && was.value ? money(was.value) : ''))
const unitText = computed(() => (props.unit ? unitLabel(s.value) : null))
const hasDetail = computed(() => !!props.detail && (terms.value.length > 0 || !!strike.value || !!unitText.value))
</script>

<template>
  <span class="pl" :class="{ right: align === 'right', wrap }">
    <span class="pl-main">{{ money(s.price) }}<span v-if="priceSuffix(s)" class="unit">{{ priceSuffix(s) }}</span></span>
    <span v-if="s.club_only" class="cond club">{{ t('price.club') }}</span>
    <span v-if="multi" class="cond multi">{{ t('price.multi', { q: multi.qty }) }}</span>
    <!-- 說明行的順序：條件（一般價／湊件）→ 劃掉的原價 → 單價；窄卡片截掉的是最後面的單價，不是條件 -->
    <span v-if="hasDetail" class="pl-detail">
      <template v-for="(x, i) in terms" :key="i"><template v-if="i"> · </template>{{ x }}</template>
      <template v-if="strike"><template v-if="terms.length"> · </template><s>{{ strike }}</s></template>
      <template v-if="unitText"><template v-if="terms.length || strike"> · </template>{{ unitText }}</template>
    </span>
  </span>
</template>
