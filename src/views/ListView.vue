<script setup lang="ts">
import { computed, ref } from 'vue'
import { useList } from '../composables/useList'
import { useSpecials } from '../composables/useSpecials'
import { chainClass, chainName, displayName, money, unitLabel } from '../lib/format'
import { dealPrice } from '../lib/compare'
import { t } from '../composables/useI18n'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'

const { items, addFreeText, remove, setQty, toggle, split, oneStop, oneStopFrom } = useList()
const { activeStores, groups, familyAlt } = useSpecials()
/** One stop：這家沒有這樣東西時，推薦它最便宜的同類（§8）。只是建議，不算進總價。 */
const alt = (storeId: string, key: string | null) => (key ? familyAlt(groups.value.get(key), storeId) : null)

const mode = ref<'split' | 'one'>('split')
const { isIn } = useAuth()
const { shareUrl } = useSync()
const shared = ref<'idle' | 'copied' | 'failed'>('idle')
async function share() {
  const url = await shareUrl()
  if (!url) { shared.value = 'failed'; return }
  try { await navigator.clipboard.writeText(url); shared.value = 'copied' } catch { prompt('', url); shared.value = 'copied' }
  setTimeout(() => (shared.value = 'idle'), 2500)
}
const draft = ref('')

const empty = computed(() => items.value.length === 0)

function submit() {
  addFreeText(draft.value)
  draft.value = ''
}
</script>

<template>
  <div class="screen with-footbar">
    <div class="pad hrow" style="margin-top: 8px">
      <div class="h1">{{ t('list.title') }}</div>
      <div class="link">{{ t('common.items', { n: items.length }) }}</div>
    </div>

    <div class="pad" style="margin-top: 8px">
      <div class="seg">
        <div :class="{ on: mode === 'split' }" @click="mode = 'split'">
          {{ t('list.split', { v: money(split.total) }) }}
        </div>
        <div :class="{ on: mode === 'one' }" @click="mode = 'one'">
          {{ t('list.oneStop', { v: money(oneStopFrom) }) }}
        </div>
      </div>
    </div>

    <div class="pad" style="margin-top: 10px; display: flex; gap: 10px">
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

    <div v-if="empty" class="pad" style="margin-top: 20px">
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
            <div class="grow" style="min-width: 0">
              <div class="t ell" style="font-size: 13.5px">{{ l.item.name }} × {{ l.item.qty }}</div>
              <div v-if="!l.special" class="s ell">{{ t('cmp.noSpecial') }}</div>
              <div v-if="!l.special && alt(c.store.id, l.item.key)" class="s ell" style="color: var(--ink-2)">
                {{ t('cmp.familyAlt', { n: displayName(alt(c.store.id, l.item.key)!.special), v: unitLabel(alt(c.store.id, l.item.key)!.special) ?? money(dealPrice(alt(c.store.id, l.item.key)!.special)) }) }}
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

    <div class="footbar">
      <span>{{ t('list.saved') }}</span>
      <button v-if="isIn && items.length" class="link" @click="share">{{ shared === 'copied' ? t('list.shared') : t('list.share') }}</button>
      <RouterLink v-else-if="!isIn && items.length" class="link" to="/signin">{{ t('list.shareSignIn') }}</RouterLink>
      <span v-else>{{ t('common.items', { n: items.length }) }}</span>
    </div>
  </div>
</template>
