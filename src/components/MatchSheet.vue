<script setup lang="ts">
// 自由輸入配對的挑選面板（一站式購物改版規格 §4.3）：「你是要哪一個？」最多 6 個候選，點一個就採用；最下面「都不是，照原樣記下」。
// 長相照 ProductSheet（.dim + .bsheet + 把手），根元素是一層 div，外面的 <Transition name="sheet"> 要講明時間。
import ProductThumb from './ProductThumb.vue'
import { candSpecial, type Cand } from '../lib/freeText'
import type { Picker } from '../composables/useFreeText'
import { chainClass, displayName, money } from '../lib/format'
import { t } from '../composables/useI18n'

defineProps<{ picker: Picker; busy: string | null }>()
const emit = defineEmits<{ choose: [c: Cand]; dismiss: [] }>()

const priceText = (c: Cand) => (c.minPrice == null ? '' : money(c.minPrice) + ((c.minUnit ?? '').toLowerCase() === 'kg' ? '/kg' : ''))
const meta = (c: Cand) => (c.minPrice == null ? t('list.pickStoresNoPrice', { n: c.stores.length }) : t('list.pickStores', { n: c.stores.length, v: priceText(c) }))
</script>

<template>
  <div>
    <div class="dim" @click="emit('dismiss')" />
    <div class="bsheet match-sheet" role="dialog" :aria-label="t('list.pickTitle')">
      <button class="grab-btn" type="button" :aria-label="t('list.pickNone')" @click="emit('dismiss')"><div class="grab" /></button>
      <div class="h2" style="font-size: 22px">{{ t('list.pickTitle') }}</div>
      <div class="sub" style="margin-top: 4px; font-size: 13px">
        {{ t('list.pickTyped', { q: picker.text }) }}<template v-if="picker.remote"> · {{ t('list.pickRemote') }}</template>
      </div>
      <div v-if="picker.cjk" class="sub muted" style="margin-top: 2px; font-size: 12.5px">{{ t('list.zhOnly') }}</div>
      <div class="box" style="margin-top: 12px">
        <button
          v-for="c in picker.cands"
          :key="c.id"
          type="button"
          class="lrow tap cand"
          :class="{ 'dim-row': busy && busy !== c.id }"
          :disabled="!!busy"
          @click="emit('choose', c)"
        >
          <ProductThumb :special="candSpecial(c.rep)" variant="sq" class="cand-tn" />
          <div class="grow" style="min-width: 0; text-align: left">
            <div class="t cand-name">{{ displayName(candSpecial(c.rep)) }}</div>
            <div class="s ell cand-meta">
              <span v-for="sid in [...c.stores].sort()" :key="sid" class="dot" :class="chainClass(sid)" />{{ meta(c) }}
            </div>
          </div>
          <svg v-if="busy === c.id" class="spin" width="18" height="18" viewBox="0 0 46 46" aria-hidden="true" style="flex: none; color: var(--ink-2)">
            <circle cx="23" cy="23" r="19" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="86 120" />
          </svg>
        </button>
      </div>
      <button class="btn ghost" type="button" style="margin-top: 14px; font-size: 15.5px" :disabled="!!busy" @click="emit('dismiss')">{{ t('list.pickNone') }}</button>
    </div>
  </div>
</template>

<style scoped>
.cand { width: 100%; padding: 9px 12px; gap: 10px; background: none; color: inherit; font: inherit; border: 0; border-top: 1px solid var(--line); }
.cand:first-child { border-top: 0; }
.cand-tn { width: 48px; height: 48px; flex: none; }
.cand-name { font-size: 14.5px; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cand-meta { margin-top: 3px; display: flex; align-items: center; gap: 4px; }
.cand-meta .dot { flex: none; }
.cand-meta .dot:last-of-type { margin-right: 3px; }
</style>
