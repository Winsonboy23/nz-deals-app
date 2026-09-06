<script setup lang="ts">
import { computed } from 'vue'
import StorePill from '../components/StorePill.vue'
import ProductCard from '../components/ProductCard.vue'
import MiniCard from '../components/MiniCard.vue'
import StaleBanner from '../components/StaleBanner.vue'
import { useSpecials } from '../composables/useSpecials'
import { useStores } from '../composables/useStores'
import { toOffer } from '../lib/compare'
import { money } from '../lib/format'
import { daysLeft } from '../lib/week'
import { t } from '../composables/useI18n'

const { selectedStores } = useStores()
const { loading, activeStores, totalSpecials, top, deepDiscounts, freshByKg, biggestSaving } =
  useSpecials()

// The headline highlights the saving, so we split the sentence around it.
const MARK = '@@'
const headline = computed(() => {
  const n = totalSpecials.value.toLocaleString('en-NZ')
  const s = activeStores.value.length
  if (!biggestSaving.value) return { a: t('home.headlineNoSave', { n, s }), b: '', save: '' }
  const [a, b] = t('home.headline', { n, s, save: MARK }).split(MARK)
  return { a, b: b ?? '', save: money(biggestSaving.value) }
})

const top6 = computed(() => top.value.slice(0, 6))
const half = computed(() => deepDiscounts.value.slice(0, 12))
const fresh = computed(() => freshByKg.value.slice(0, 12))
</script>

<template>
  <div class="screen">
    <div class="pad row" style="margin-top: 6px">
      <StorePill />
      <div style="display: flex; gap: 8px">
        <RouterLink class="iconbtn" to="/search" aria-label="Search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </RouterLink>
        <RouterLink class="pill soft" to="/me">{{ t('common.signIn') }}</RouterLink>
      </div>
    </div>

    <div v-if="loading && !totalSpecials" class="pad" style="margin-top: 20px">
      <div class="skel" style="height: 34px; width: 82%" />
      <div class="skel" style="height: 34px; width: 62%; margin-top: 8px" />
      <div style="display: flex; gap: 10px; margin-top: 18px">
        <div class="skel" style="flex: 1; height: 150px" />
        <div class="skel" style="flex: 1; height: 150px" />
        <div class="skel" style="flex: 1; height: 150px" />
      </div>
    </div>

    <template v-else>
      <div class="pad" style="margin-top: 16px">
        <div class="h-display">
          {{ headline.a }}<mark v-if="headline.save">{{ headline.save }}</mark>{{ headline.b }}
        </div>
        <div class="sub" style="margin-top: 6px">
          {{ t('home.ends') }} · <b>{{ t('home.daysLeft', { d: daysLeft() }) }}</b>
        </div>
      </div>

      <StaleBanner />

      <div class="pad row" style="margin-top: 14px; margin-bottom: 10px">
        <div class="h2">{{ t('home.best') }}</div>
        <RouterLink class="link" to="/top10">{{ t('home.top10') }}</RouterLink>
      </div>
      <div v-if="top6.length" class="grid3">
        <ProductCard v-for="g in top6" :key="g.key" :offer="g.best" :group="g" />
      </div>
      <div v-else class="pad">
        <div class="note sub">{{ t('home.noCompare') }}</div>
      </div>

      <template v-if="half.length">
        <div class="pad row" style="margin-top: 16px; margin-bottom: 10px">
          <div class="h2">{{ t('home.half') }}</div>
          <RouterLink class="link" to="/half-price">
            {{ t('home.more', { n: deepDiscounts.length }) }}
          </RouterLink>
        </div>
        <div class="hscroll">
          <MiniCard
            v-for="r in half"
            :key="r.store.id + r.special.product_id"
            :offer="toOffer(r.store, r.special)"
          />
        </div>
      </template>

      <template v-if="fresh.length">
        <div class="pad row" style="margin-top: 16px; margin-bottom: 10px">
          <div class="h2">{{ t('home.fresh') }}</div>
          <RouterLink class="link" to="/fresh">
            {{ t('home.more', { n: freshByKg.length }) }}
          </RouterLink>
        </div>
        <div class="hscroll">
          <MiniCard
            v-for="r in fresh"
            :key="r.store.id + r.special.product_id"
            :offer="toOffer(r.store, r.special)"
          />
        </div>
      </template>

      <div class="pad sub muted" style="margin-top: 18px; font-size: 12.5px">
        {{ t('me.footnote') }} · {{ selectedStores.length }} / 5
      </div>
    </template>
  </div>
</template>
