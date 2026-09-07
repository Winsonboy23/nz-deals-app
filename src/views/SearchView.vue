<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StoreOfferCard from '../components/StoreOfferCard.vue'
import { useSpecials } from '../composables/useSpecials'
import { chainClass, displayName, money, unitLabel } from '../lib/format'
import { dealPrice } from '../lib/compare'
import { t } from '../composables/useI18n'
import type { Group, Offer } from '../lib/types'

const route = useRoute()
const router = useRouter()
const { rows, groups, activeStores, familyAlt } = useSpecials()

const q = ref(String(route.query.q ?? ''))
watch(q, (v) => {
  void router.replace({ path: '/search', query: v ? { q: v } : {} })
})

/** Match on the store's own name, brand and the shared product key. */
const results = computed<Group[]>(() => {
  const needle = q.value.trim().toLowerCase()
  if (needle.length < 2) return []
  const hits = new Map<string, number>()
  for (const { special } of rows.value) {
    const key = special.product_key
    if (!key) continue
    const hay = `${special.brand ?? ''} ${special.name}`.toLowerCase()
    const at = hay.indexOf(needle)
    if (at < 0) continue
    const score = Math.min(hits.get(key) ?? 99, at)
    hits.set(key, score)
  }
  return [...hits.entries()]
    .map(([k, score]) => ({ g: groups.value.get(k), score }))
    .filter((x): x is { g: Group; score: number } => !!x.g)
    .sort(
      (a, b) =>
        a.score - b.score || b.g.offers.length - a.g.offers.length || a.g.best.deal - b.g.best.deal,
    )
    .slice(0, 20)
    .map((x) => x.g)
})

function missing(g: Group): string[] {
  return activeStores.value
    .filter((d) => !g.offers.some((o) => o.store.id === d.store.id))
    .map((d) => d.store.name)
}
/** 沒特價的店：各列一個最便宜的同類；同一樣東西在幾家店就合成一行（最便宜的那家）。 */
function alts(g: Group): Array<{ best: Offer; n: number }> {
  const byKey = new Map<string, Offer[]>()
  for (const d of activeStores.value) {
    if (g.offers.some((o) => o.store.id === d.store.id)) continue
    const o = familyAlt(g, d.store.id)
    if (!o) continue
    const k = o.special.product_key ?? o.special.product_id
    const list = byKey.get(k)
    if (list) list.push(o)
    else byKey.set(k, [o])
  }
  return [...byKey.values()].map((offers) => {
    offers.sort((a, b) => a.deal - b.deal)
    return { best: offers[0], n: offers.length }
  })
}
/** 單位一樣才寫每公斤／每公升價（$20/kg 對 $2.47 ea 比不了）；不一樣只寫價格。 */
function altPrice(g: Group, o: Offer): string {
  const same = !!o.unitUnit && o.unitUnit === g.best.unitUnit
  return (same && unitLabel(o.special)) || money(dealPrice(o.special))
}
function missingClasses(g: Group): string[] {
  return activeStores.value
    .filter((d) => !g.offers.some((o) => o.store.id === d.store.id))
    .map((d) => chainClass(d.store.id))
}
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 10px">
      <div class="field solid" style="height: 56px">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          v-model="q"
          :placeholder="t('search.placeholder')"
          style="flex: 1; margin-left: 4px; font-size: 17px; font-weight: 700"
        />
        <button v-if="q" class="link" @click="q = ''">{{ t('search.clear') }}</button>
      </div>
    </div>

    <div v-if="q.trim().length >= 2 && !results.length" class="pad" style="margin-top: 22px">
      <div class="empty">
        <div style="font-size: 22px; color: #c4c4c0; line-height: 1">?</div>
        <div class="h3" style="margin-top: 9px; font-size: 15.5px">
          {{ t('search.empty', { q: q.trim() }) }}
        </div>
        <div class="s" style="margin-top: 3px">{{ t('search.emptyHint') }}</div>
      </div>
    </div>

    <template v-for="g in results" :key="g.key">
      <div class="pad" style="margin-top: 14px">
        <div class="sec ell">
          {{ t('search.lowToHigh', { n: displayName(g.best.special) }) }}
        </div>
      </div>
      <div class="pad">
        <StoreOfferCard
          v-for="o in g.offers"
          :key="o.store.id"
          :offer="o"
          :best="g.offers.length >= 2 && o === g.best"
        />
        <div v-if="g.offers.length < 2" style="margin-top: 7px">
          <span class="tag only" style="font-size: 10px">{{ t('cmp.only') }}</span>
        </div>
      </div>
      <div v-if="missing(g).length" class="pad" style="margin-top: 8px">
        <div class="note" style="display: flex; align-items: center; gap: 10px">
          <span class="dots">
            <span
              v-for="(c, i) in missingClasses(g)"
              :key="i"
              class="dot"
              :class="c"
              style="opacity: 0.42"
            />
          </span>
          <span style="font-size: 12px; font-weight: 600; color: var(--ink-2); line-height: 1.35">
            {{ t('cmp.noSpecialAt', { s: missing(g).join(', ') }) }}
          </span>
        </div>
        <RouterLink
          v-for="a in alts(g)"
          :key="a.best.special.product_key ?? a.best.special.product_id"
          class="note"
          :to="`/p/${encodeURIComponent(a.best.special.product_key ?? '')}`"
          style="margin-top: 6px; display: flex; align-items: center; gap: 10px"
        >
          <span class="dot" :class="chainClass(a.best.store.id)" />
          <span class="ell" style="font-size: 12px; font-weight: 600; color: var(--ink-2)">
            {{ a.n > 1
              ? t('cmp.familyAltMany', { k: a.n, n: displayName(a.best.special), v: altPrice(g, a.best) })
              : t('cmp.familyAltAt', { s: a.best.store.name, n: displayName(a.best.special), v: altPrice(g, a.best) }) }}
          </span>
        </RouterLink>
      </div>
    </template>
  </div>
</template>
