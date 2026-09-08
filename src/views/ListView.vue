<script setup lang="ts">
import { computed, ref } from 'vue'
import ProductThumb from '../components/ProductThumb.vue'
import { useList } from '../composables/useList'
import { useSpecials } from '../composables/useSpecials'
import { chainClass, chainName, displayName, money, unitLabel } from '../lib/format'
import { dealPrice } from '../lib/compare'
import { t } from '../composables/useI18n'
import type { Group } from '../lib/types'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'
import AiDirectionsSheet from '../components/AiDirectionsSheet.vue'
import { aiEnabled } from '../lib/aiRecipe'

const { items, add, has, addFreeText, remove, setQty, toggle, split, oneStop, oneStopFrom,
  picking, picked, pickedNames, startPicking, stopPicking, togglePick } = useList()
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
/** 挑食材 → AI 食譜。第一層是底頁，第二層才換頁。 */
const sheet = ref(false)
function openSheet() {
  if (pickedNames.value.length) sheet.value = true
}

function submit() {
  addFreeText(draft.value)
  draft.value = ''
}
</script>

<template>
  <div class="screen with-footbar">
    <div class="pad hrow" style="margin-top: 8px">
      <div class="h1">{{ t('list.title') }}</div>
      <button v-if="picking" class="link" @click="stopPicking()">{{ t('common.done') }}</button>
      <button v-else-if="aiEnabled && items.length >= 2" class="link" @click="startPicking()">{{ t('ai.cookFromList') }}</button>
      <div v-else class="link">{{ t('common.items', { n: items.length }) }}</div>
    </div>

    <div v-if="!picking" class="pad" style="margin-top: 8px">
      <div class="seg">
        <div :class="{ on: mode === 'split' }" @click="mode = 'split'">
          {{ t('list.split', { v: money(split.total) }) }}
        </div>
        <div :class="{ on: mode === 'one' }" @click="mode = 'one'">
          {{ t('list.oneStop', { v: money(oneStopFrom) }) }}
        </div>
      </div>
    </div>

    <div v-if="!picking" class="pad" style="margin-top: 10px; display: flex; gap: 10px">
      <div class="field" style="flex: 1">
        <input
          v-model="draft"
          :placeholder="t('list.addPlaceholder')"
          style="flex: 1"
          @keyup.enter="submit"
        />
      </div>
      <button
        class="btn"
        style="width: 84px; height: 52px; font-size: 16px; border-radius: 14px; flex: none"
        @click="submit"
      >
        {{ t('list.add') }}
      </button>
    </div>

    <div v-if="!picking && suggest.length" class="pad" style="margin-top: 12px">
      <div class="sec">{{ t('home.watched') }}</div>
      <div class="box" style="margin-top: 6px">
        <div v-for="g in suggest" :key="g.key" class="lrow" style="padding: 8px 12px; gap: 8px">
          <span class="dot" :class="chainClass(g.best.store.id)" />
          <div class="grow" style="min-width: 0">
            <div class="t ell" style="font-size: 13.5px">{{ displayName(g.best.special) }}</div>
            <div class="s ell">{{ g.best.store.name }} · {{ money(dealPrice(g.best.special)) }}</div>
          </div>
          <button class="btn ghost" style="height: 34px; padding: 0 14px; font-size: 13px; flex: none" @click="add(g.key, displayName(g.best.special))">
            {{ t('list.add') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="picking" class="pad" style="margin-top: 12px">
      <div class="sub">{{ t('ai.pickSub') }}</div>
      <div class="box" style="margin-top: 10px">
        <button v-for="i in items" :key="i.id" class="lrow tap pickrow" @click="togglePick(i.id)">
          <span class="rb" :class="{ on: picked.has(i.id) }" />
          <span class="t grow ell">{{ i.name }}</span>
        </button>
      </div>
    </div>

    <div v-else-if="empty" class="pad" style="margin-top: 20px">
      <div class="empty">
        <div style="font-size: 22px; color: #c4c4c0; line-height: 1">☰</div>
        <div class="h3" style="margin-top: 9px; font-size: 15.5px">{{ t('list.empty') }}</div>
        <div class="s" style="margin-top: 3px">{{ t('list.emptyHint') }}</div>
      </div>
    </div>

    <!-- D1 · Cheapest split -->
    <template v-else-if="mode === 'split'">
      <div v-for="b in split.buckets" :key="b.store.id" class="pad" style="margin-top: 8px">
        <div class="box">
          <div class="ghead" :class="chainClass(b.store.id)">
            <span>{{ chainName(b.store.id) }}</span><span>{{ money(b.subtotal) }}</span>
          </div>
          <div v-for="l in b.lines" :key="l.item.id" class="lrow" style="padding: 7px 8px; gap: 7px">
            <button
              class="cb"
              :class="{ on: l.item.checked }"
              style="width: 26px; height: 26px; font-size: 13px"
              @click="toggle(l.item.id)"
            >
              ✓
            </button>
            <ProductThumb :special="l.offer.special" variant="sq" class="list-tn" />
            <div :style="{ opacity: l.item.checked ? 0.45 : 1, flex: 1, minWidth: 0 }">
              <div class="t ell" style="font-size: 13.5px">{{ l.item.name }}</div>
              <div class="s ell">
                {{ b.store.name }}
                <template v-if="unitLabel(l.offer.special)"> · {{ unitLabel(l.offer.special) }}</template>
              </div>
            </div>
            <div class="step" style="padding: 0 7px; gap: 6px">
              <button @click="setQty(l.item.id, l.item.qty - 1)"><i>−</i></button>
              {{ l.item.qty }}
              <button @click="setQty(l.item.id, l.item.qty + 1)"><i>+</i></button>
            </div>
            <div class="p" style="font-size: 17px">{{ money(l.total) }}</div>
          </div>
        </div>
      </div>

      <div v-if="split.unmatched.length" class="pad" style="margin-top: 12px">
        <div class="sec">{{ t('list.unmatched') }}</div>
        <div
          v-for="i in split.unmatched"
          :key="i.id"
          style="display: flex; align-items: center; gap: 10px; margin-top: 10px"
        >
          <div style="width: 26px; height: 26px; border: 1.5px dashed #c2c2bd; border-radius: 8px; flex: none" />
          <span class="grow ell" style="font-size: 14px; font-weight: 700; color: var(--ink-3)">
            {{ i.name }}
          </span>
          <span class="small muted">{{ t('list.freeText') }}</span>
          <button class="link" style="color: #b00020" @click="remove(i.id)">×</button>
        </div>
      </div>
    </template>

    <!-- D1 · One stop -->
    <template v-else>
      <div v-for="c in oneStop" :key="c.store.id" class="pad" style="margin-top: 8px">
        <div class="box">
          <div class="ghead" :class="chainClass(c.store.id)">
            <span class="ell">{{ c.store.name }}</span>
            <span>{{ t('list.from', { v: money(c.total) }) }}</span>
          </div>
          <div class="lrow" style="padding: 8px 12px">
            <div class="s grow">
              {{ t('list.known', { k: c.known, m: c.known + c.missing, n: c.missing }) }}
            </div>
          </div>
          <div v-for="l in c.lines" :key="l.item.id" class="lrow" style="padding: 7px 12px; gap: 7px">
            <ProductThumb v-if="l.special ?? thumbFor(l.item.key)" :special="(l.special ?? thumbFor(l.item.key))!" variant="sq" class="list-tn" />
            <div v-else class="tn sq list-tn" />
            <div class="grow" style="min-width: 0">
              <div class="t ell" style="font-size: 13.5px">{{ l.item.name }} × {{ l.item.qty }}</div>
              <div v-if="!l.special" class="s ell">{{ t('cmp.noSpecial') }}</div>
              <div v-if="!l.special && altText(c.store.id, l.item.key)" class="s ell" style="color: var(--ink-2)">
                {{ altText(c.store.id, l.item.key) }}
              </div>
            </div>
            <div v-if="l.special" class="p" style="font-size: 17px">{{ money(l.total) }}</div>
            <div v-else class="small muted" style="flex: none">—</div>
          </div>
        </div>
      </div>
      <div v-if="!activeStores.length" class="pad" style="margin-top: 12px">
        <div class="note sub">{{ t('stores.noWeekData') }}</div>
      </div>
    </template>

    <div v-if="picking" class="footbar pickbar">
      <span>{{ t('ai.picked', { n: pickedNames.length }) }}</span>
      <button class="link" :disabled="!pickedNames.length" :style="{ opacity: pickedNames.length ? 1 : 0.4 }" @click="openSheet">
        {{ t('ai.go') }}
      </button>
    </div>
    <div v-else class="footbar">
      <span>{{ t('list.saved') }}</span>
      <button v-if="isIn && items.length" class="link" @click="share">{{ shared === 'copied' ? t('list.shared') : t('list.share') }}</button>
      <RouterLink v-else-if="!isIn && items.length" class="link" to="/signin">{{ t('list.shareSignIn') }}</RouterLink>
      <span v-else>{{ t('common.items', { n: items.length }) }}</span>
    </div>

    <Teleport to="body">
      <Transition name="sheet">
        <div v-if="sheet" class="sheetwrap">
          <AiDirectionsSheet :items="pickedNames" @close="sheet = false" />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.pickrow {
  width: 100%;
  text-align: left;
  background: var(--paper);
  color: inherit;
}
.rb {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
  position: relative;
}
.rb.on {
  border-color: var(--ink);
  background: var(--ink);
}
.rb.on::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: var(--paper);
}
.pickbar .link {
  font-weight: 800;
  color: var(--ink);
}
</style>
