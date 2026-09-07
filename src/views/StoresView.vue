<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStores, MAX_STORES } from '../composables/useStores'
import { useSpecials } from '../composables/useSpecials'
import { chainClass, chainOf } from '../lib/format'
import { t } from '../composables/useI18n'
import type { RankedStore } from '../composables/useStores'

const router = useRouter()
const { loaded, locating, coords, query, ranked, selectedIds, islands, loadStores, locate, toggle, preselect } =
  useStores()
const { load } = useSpecials()

const splash = computed(() => locating.value === 'busy' && !selectedIds.value.length)

onMounted(async () => {
  if (!loaded.value) await loadStores()
  if (!coords.value && locating.value === 'idle') await locate()
  if (!selectedIds.value.length) preselect()
})

function subtitle(r: RankedStore): string {
  const bits: string[] = []
  bits.push(r.km == null ? t('stores.unknownDistance') : `${r.km.toFixed(1)} km`)
  if (!r.hasData) bits.push(t('stores.noData'))
  else if (chainOf(r.store.id) === 'newworld') bits.push('Clubcard')
  return bits.join(' · ')
}

/** 三家超市標籤：點了只列那幾家，可同時點多家；都不點 = 全部。 */
const CHAINS = [
  { id: 'newworld', label: 'New World', cls: 'nw' },
  { id: 'woolworths', label: 'Woolworths', cls: 'ww' },
  { id: 'paknsave', label: "PAK'nSAVE", cls: 'pns' },
] as const
const chains = ref<string[]>([])
function toggleChain(id: string) {
  chains.value = chains.value.includes(id)
    ? chains.value.filter((c) => c !== id)
    : [...chains.value, id]
}
const matchChain = (r: RankedStore) => !chains.value.length || chains.value.includes(r.store.chain_id)

const chosen = computed(() => ranked.value.filter((r) => r.selected))
const candidates = computed(() => ranked.value.filter((r) => !r.selected && matchChain(r)))
const nearby = computed(() =>
  candidates.value.slice(0, query.value.trim() || chains.value.length ? 60 : 20),
)
const hidden = computed(() => candidates.value.length - nearby.value.length)

function typeTownInstead() {
  locating.value = 'denied'
}

async function done() {
  await load()
  void router.push('/')
}
</script>

<template>
  <!-- A1 · Locating -->
  <div v-if="splash" class="screen">
    <div class="pad" style="margin-top: 56px">
      <div class="h1" style="font-size: 54px; line-height: 0.96">NZ<br />Deals</div>
      <div class="sub" style="margin-top: 24px; font-size: 16px; line-height: 1.45">
        {{ t('stores.tagline') }}<br />New World · Woolworths · PAK'nSAVE.
      </div>
    </div>
    <div class="pad" style="margin-top: 58px; display: flex; align-items: center; gap: 18px">
      <svg width="46" height="46" viewBox="0 0 46 46" style="flex: none" class="spin">
        <circle
          cx="23"
          cy="23"
          r="19"
          fill="none"
          stroke="#111"
          stroke-width="3"
          stroke-linecap="round"
          stroke-dasharray="86 120"
        />
      </svg>
      <div>
        <div class="h3" style="font-size: 19px">{{ t('stores.locating') }}</div>
      </div>
    </div>
    <div class="pad" style="margin-top: 58px; text-align: center">
      <button class="link" style="border-bottom: 2px solid #111" @click="typeTownInstead">
        {{ t('stores.typeTown') }}
      </button>
    </div>
  </div>

  <!-- A2 · Stores -->
  <div v-else class="screen" style="padding-bottom: 120px">
    <div class="pad" style="margin-top: 18px"><div class="h1">{{ t('stores.title') }}</div></div>

    <div class="pad" style="margin-top: 14px; display: flex; gap: 10px">
      <div class="field solid" style="flex: 1">
        <input v-model="query" :placeholder="t('stores.placeholder')" style="flex: 1" />
      </div>
      <button
        style="
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: #111;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: none;
        "
        :aria-label="t('stores.locating')"
        @click="locate"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
          <circle cx="12" cy="10" r="2.6" />
        </svg>
      </button>
    </div>

    <div v-if="locating === 'denied'" class="pad" style="margin-top: 10px">
      <div class="note sub">{{ t('stores.denied') }}</div>
    </div>

    <div v-if="islands.length === 1" class="pad" style="margin-top: 12px">
      <div
        style="
          background: var(--paper-2);
          border-radius: 12px;
          padding: 9px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        "
      >
        <span class="tag" style="background: #111; color: #fff; height: 22px">
          {{ t('stores.island.' + islands[0]) }}
        </span>
        <span class="sub" style="font-size: 13px">{{ t('stores.islandNote') }}</span>
      </div>
    </div>
    <div v-else-if="islands.length > 1" class="pad" style="margin-top: 12px">
      <div class="note sub" style="font-size: 13px">⚠ {{ t('stores.islandWarn') }}</div>
    </div>

    <div class="pad chips" style="margin-top: 14px">
      <button
        v-for="c in CHAINS"
        :key="c.id"
        class="chip"
        :class="[c.cls, { on: chains.includes(c.id) }]"
        @click="toggleChain(c.id)"
      >
        <span class="dot" :class="c.cls" />{{ c.label }}
      </button>
    </div>

    <div class="pad hrow" style="margin-top: 16px; margin-bottom: 8px">
      <div style="font-size: 13px; font-weight: 700; color: var(--ink-2)">
        {{ t('stores.nearestFirst') }}
      </div>
      <div style="font-size: 13px; font-weight: 800">
        {{ t('stores.selected', { n: selectedIds.length }) }}
      </div>
    </div>

    <div class="pad">
      <div v-if="!ranked.length" class="empty sub">{{ t('stores.none') }}</div>
      <template v-else>
        <div v-if="chosen.length" class="box">
          <button
            v-for="r in chosen"
            :key="r.store.id"
            class="lrow tap"
            style="height: 66px"
            @click="toggle(r.store.id)"
          >
            <div class="bar" :class="chainClass(r.store.id)" style="height: 38px; align-self: center" />
            <div class="grow">
              <div class="t ell" style="font-size: 16px">{{ r.store.name }}</div>
              <div class="s ell">{{ subtitle(r) }}</div>
            </div>
            <div class="cb on">✓</div>
          </button>
        </div>
        <div v-if="chosen.length" class="sec" style="margin: 16px 0 8px">
          {{ t('stores.nearby') }}
        </div>
        <div class="box">
          <button
            v-for="r in nearby"
            :key="r.store.id"
            class="lrow tap"
            :class="{ 'dim-row': !r.hasData }"
            style="height: 66px"
            :disabled="!r.hasData"
            @click="toggle(r.store.id)"
          >
            <div class="bar" :class="chainClass(r.store.id)" style="height: 38px; align-self: center" />
            <div class="grow">
              <div class="t ell" style="font-size: 16px">{{ r.store.name }}</div>
              <div class="s ell">{{ subtitle(r) }}</div>
            </div>
            <div class="cb" :class="{ off: !r.hasData }">✓</div>
          </button>
        </div>
        <div v-if="hidden > 0" class="sub muted" style="margin-top: 8px; font-size: 12.5px">
          {{ t('stores.more', { n: hidden }) }}
        </div>
      </template>
      <div
        v-if="selectedIds.length >= MAX_STORES"
        class="sub muted"
        style="margin-top: 8px; font-size: 12.5px"
      >
        {{ t('stores.maxWarn') }}
      </div>
    </div>

    <div
      style="
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: 0;
        width: 100%;
        max-width: 480px;
        padding: 12px var(--gutter) calc(20px + env(safe-area-inset-bottom));
        background: var(--paper);
        border-top: 1px solid var(--line);
        z-index: 20;
      "
    >
      <button class="btn" style="width: 100%" :disabled="!selectedIds.length" @click="done">
        {{ t('stores.cta') }}
      </button>
    </div>
  </div>
</template>
