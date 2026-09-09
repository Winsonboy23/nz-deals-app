<script setup lang="ts">
// 購物清單。✓ = 買到了（劃線變淡）。沒配對到特價的自由項放最後一張「其他」卡，可以自己填價格（算進最省總價）。
// 最下面「AI 食譜」→ /ai-recipes 用清單裡的食材想 2 道菜。
import { computed, ref } from 'vue'
import ProductThumb from '../components/ProductThumb.vue'
import { useList, type ListItem } from '../composables/useList'
import { useSpecials } from '../composables/useSpecials'
import { chainClass, chainName, displayName, money, unitLabel } from '../lib/format'
import { dealPrice } from '../lib/compare'
import { t } from '../composables/useI18n'
import type { Group } from '../lib/types'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'
import { aiEnabled } from '../lib/aiRecipe'

const { items, add, has, addFreeText, remove, setQty, rename, setPrice, toggle, split, oneStop, oneStopFrom } = useList()
const { activeStores, groups, familyAlt } = useSpecials()
/** One stop：這家沒有這樣東西時，推薦它最便宜的同類（§8）。只是建議，不算進總價。 */
function altText(storeId: string, key: string | null): string | null {
  const g = key ? groups.value.get(key) : undefined
  const o = g ? familyAlt(g, storeId) : null
  if (!g || !o) return null
  const same = !!o.unitUnit && o.unitUnit === g.best.unitUnit   // 單位一樣才寫單價
  return t('cmp.familyAlt', { n: displayName(o.special), v: (same && unitLabel(o.special)) || money(dealPrice(o.special)) })
}
/** 清單照片：One stop 這家沒特價時，拿同一樣商品在別家的資料來顯示圖（圖是跟商品走的）。 */
const thumbFor = (key: string | null) => (key ? groups.value.get(key)?.best.special ?? null : null)

const mode = ref<'split' | 'one'>('split')
const { isIn } = useAuth()
const { shareUrl, watched } = useSync()
/** 關注的商品這週有特價、又還沒在清單裡 → 頂部建議加入（app-features §6）。 */
const suggest = computed(() => (isIn.value ? [...watched.value].map((k) => groups.value.get(k)).filter((g): g is Group => !!g && !has(g.key)).slice(0, 5) : []))
const shared = ref<'idle' | 'copied' | 'failed'>('idle')
async function share() {
  const url = await shareUrl()
  if (!url) { shared.value = 'failed'; return }
  try { await navigator.clipboard.writeText(url); shared.value = 'copied' } catch { prompt('', url); shared.value = 'copied' }
  setTimeout(() => (shared.value = 'idle'), 2500)
}
const draft = ref('')
const empty = computed(() => items.value.length === 0)
/** 「其他」卡裡點名字展開的那一項（改名字、填價格） */
const editing = ref<string | null>(null)

function submit() {
  addFreeText(draft.value)
  draft.value = ''
}
function onPrice(i: ListItem, e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  setPrice(i.id, v ? Number(v) : null)
}
const productLink = (key: string) => `/p/${encodeURIComponent(key)}`
</script>

<template>
  <div class="screen with-footbar">
    <div class="pad hrow" style="margin-top: 8px">
      <div class="h1">{{ t('list.title') }}</div>
      <div class="link">{{ t('common.items', { n: items.length }) }}</div>
    </div>

    <div class="pad" style="margin-top: 8px">
      <div class="seg">
        <div :class="{ on: mode === 'split' }" @click="mode = 'split'">{{ t('list.split', { v: money(split.total) }) }}</div>
        <div :class="{ on: mode === 'one' }" @click="mode = 'one'">{{ t('list.oneStop', { v: money(oneStopFrom) }) }}</div>
      </div>
    </div>

    <div class="pad" style="margin-top: 10px; display: flex; gap: 10px">
      <div class="field" style="flex: 1">
        <input v-model="draft" :placeholder="t('list.addPlaceholder')" style="flex: 1" @keyup.enter="submit" />
      </div>
      <button class="btn" style="width: 84px; height: 52px; font-size: 16px; border-radius: 14px; flex: none" @click="submit">{{ t('list.add') }}</button>
    </div>

    <div v-if="suggest.length" class="pad" style="margin-top: 12px">
      <div class="sec">{{ t('home.watched') }}</div>
      <div class="box" style="margin-top: 6px">
        <div v-for="g in suggest" :key="g.key" class="lrow" style="padding: 8px 12px; gap: 8px">
          <span class="dot" :class="chainClass(g.best.store.id)" />
          <div class="grow" style="min-width: 0">
            <div class="t ell" style="font-size: 13.5px">{{ displayName(g.best.special) }}</div>
            <div class="s ell">{{ g.best.store.name }} · {{ money(dealPrice(g.best.special)) }}</div>
          </div>
          <button class="btn ghost" style="height: 34px; padding: 0 14px; font-size: 13px; flex: none" @click="add(g.key, displayName(g.best.special))">{{ t('list.add') }}</button>
        </div>
      </div>
    </div>

    <div v-if="empty" class="pad" style="margin-top: 20px">
      <div class="empty">
        <div style="font-size: 22px; color: #c4c4c0; line-height: 1">☰</div>
        <div class="h3" style="margin-top: 9px; font-size: 15.5px">{{ t('list.empty') }}</div>
        <div class="s" style="margin-top: 3px">{{ t('list.emptyHint') }}</div>
      </div>
    </div>

    <!-- D1 · 最省：每項分到最便宜的店 -->
    <template v-else-if="mode === 'split'">
      <div v-for="b in split.buckets" :key="b.store.id" class="pad" style="margin-top: 8px">
        <div class="box">
          <div class="ghead" :class="chainClass(b.store.id)">
            <span>{{ chainName(b.store.id) }}</span><span>{{ money(b.subtotal) }}</span>
          </div>
          <div v-for="l in b.lines" :key="l.item.id" class="lrow row">
            <button class="cb" :class="{ on: l.item.checked }" @click="toggle(l.item.id)">✓</button>
            <ProductThumb :special="l.offer.special" variant="sq" class="list-tn" />
            <RouterLink class="nm" :class="{ done: l.item.checked }" :to="productLink(l.item.key as string)">
              <div class="t">{{ l.item.name }}</div>
              <div class="s ell">{{ b.store.name }}<template v-if="unitLabel(l.offer.special)"> · {{ unitLabel(l.offer.special) }}</template></div>
            </RouterLink>
            <div class="step">
              <button @click="setQty(l.item.id, l.item.qty - 1)"><i>−</i></button>{{ l.item.qty }}<button @click="setQty(l.item.id, l.item.qty + 1)"><i>+</i></button>
            </div>
            <div class="p">{{ money(l.total) }}</div>
            <button class="del" :aria-label="t('list.remove')" @click="remove(l.item.id)"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg></button>
          </div>
        </div>
      </div>

      <!-- 其他：沒配對到特價的，跟店卡同一種長相；點名字展開改名／填價格 -->
      <div v-if="split.unmatched.length" class="pad" style="margin-top: 8px">
        <div class="box">
          <div class="ghead other">
            <span>{{ t('list.others') }}</span><span v-if="split.othersTotal">{{ money(split.othersTotal) }}</span>
          </div>
          <template v-for="i in split.unmatched" :key="i.id">
            <div class="lrow row">
              <button class="cb" :class="{ on: i.checked }" @click="toggle(i.id)">✓</button>
              <div class="tn sq list-tn ph" />
              <button class="nm" :class="{ done: i.checked }" @click="editing = editing === i.id ? null : i.id">
                <div class="t">{{ i.name }}</div>
                <div class="s ell">{{ i.price ? t('list.selfPrice') : t('list.noPriceYet') }}</div>
              </button>
              <div class="step">
                <button @click="setQty(i.id, i.qty - 1)"><i>−</i></button>{{ i.qty }}<button @click="setQty(i.id, i.qty + 1)"><i>+</i></button>
              </div>
              <div class="p" :class="{ muted: !i.price }">{{ i.price ? money(i.price * i.qty) : '—' }}</div>
              <button class="del" :aria-label="t('list.remove')" @click="remove(i.id)"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg></button>
            </div>
            <div v-if="editing === i.id" class="lrow edit">
              <div class="field" style="flex: 1; height: 40px; font-size: 14px">
                <input :value="i.name" style="flex: 1" maxlength="60" @change="rename(i.id, ($event.target as HTMLInputElement).value)" />
              </div>
              <div class="field" style="width: 118px; height: 40px; font-size: 14px; flex: none">
                <span class="ph">$</span>
                <input :value="i.price ?? ''" type="number" inputmode="decimal" min="0" step="0.01" :placeholder="t('list.priceOptional')" style="flex: 1; min-width: 0" @change="onPrice(i, $event)" />
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- D1 · 一站 -->
    <template v-else>
      <div v-for="c in oneStop" :key="c.store.id" class="pad" style="margin-top: 8px">
        <div class="box">
          <div class="ghead" :class="chainClass(c.store.id)">
            <span class="ell">{{ c.store.name }}</span>
            <span>{{ t('list.from', { v: money(c.total) }) }}</span>
          </div>
          <div class="lrow" style="padding: 8px 12px">
            <div class="s grow">{{ t('list.known', { k: c.known, m: c.known + c.missing, n: c.missing }) }}</div>
          </div>
          <div v-for="l in c.lines" :key="l.item.id" class="lrow row" style="padding-left: 12px">
            <ProductThumb v-if="l.special ?? thumbFor(l.item.key)" :special="(l.special ?? thumbFor(l.item.key))!" variant="sq" class="list-tn" />
            <div v-else class="tn sq list-tn ph" />
            <component :is="l.item.key ? 'RouterLink' : 'div'" class="nm" :class="{ done: l.item.checked }" :to="l.item.key ? productLink(l.item.key) : undefined">
              <div class="t">{{ l.item.name }} × {{ l.item.qty }}</div>
              <div v-if="l.own" class="s ell">{{ t('list.selfPrice') }}</div>
              <div v-else-if="!l.special" class="s ell">{{ t('cmp.noSpecial') }}</div>
              <div v-if="!l.special && !l.own && altText(c.store.id, l.item.key)" class="s ell" style="color: var(--ink-2)">{{ altText(c.store.id, l.item.key) }}</div>
            </component>
            <div v-if="l.special || l.own" class="p">{{ money(l.total) }}</div>
            <div v-else class="p muted">—</div>
          </div>
        </div>
      </div>
      <div v-if="!activeStores.length" class="pad" style="margin-top: 12px">
        <div class="note sub">{{ t('stores.noWeekData') }}</div>
      </div>
    </template>

    <!-- AI 食譜：清單最下面 -->
    <div v-if="!empty && aiEnabled" class="pad" style="margin-top: 20px">
      <RouterLink class="btn" :class="{ ghost: !isIn }" :to="isIn ? '/ai-recipes' : '/signin'" style="font-size: 17px">
        {{ isIn ? t('list.aiBtn') : t('list.aiBtnSignIn') }}
      </RouterLink>
      <div class="s muted" style="margin-top: 8px; text-align: center; font-size: 12.5px; line-height: 1.4">{{ t('list.aiSub') }}</div>
    </div>

    <div class="footbar">
      <span>{{ t('list.saved') }}</span>
      <button v-if="isIn && items.length" class="link" @click="share">{{ shared === 'copied' ? t('list.shared') : t('list.share') }}</button>
      <RouterLink v-else-if="!isIn && items.length" class="link" to="/signin">{{ t('list.shareSignIn') }}</RouterLink>
      <span v-else>{{ t('common.items', { n: items.length }) }}</span>
    </div>
  </div>
</template>

<style scoped>
.row { padding: 7px 8px; gap: 7px; }
.row .cb { width: 26px; height: 26px; font-size: 13px; }
/* 商品名固定寬（吃剩下的空間、最多兩行），數量和價格欄才會對齊 */
.nm { flex: 1; min-width: 0; text-align: left; background: none; color: inherit; text-decoration: none; padding: 0; }
.nm .t { font-size: 13.5px; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.nm.done .t { text-decoration: line-through; color: var(--ink-3); }
.nm.done .s { opacity: 0.55; }
.row .step { padding: 0 7px; gap: 6px; }
.row .p { font-size: 16px; min-width: 56px; }
.row .p.muted { color: var(--ink-3); font-weight: 700; }
.del { width: 28px; height: 28px; flex: none; display: flex; align-items: center; justify-content: center; color: var(--ink-3); background: none; margin-left: -2px; }
.del svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ghead.other { background: var(--paper-2); color: var(--ink); }
.edit { gap: 8px; padding: 8px 10px 10px 42px; background: var(--paper-2); }
.edit input::-webkit-outer-spin-button, .edit input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
</style>
