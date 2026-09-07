<script setup lang="ts">
import { computed } from 'vue'
import StorePill from '../components/StorePill.vue'
import ProductCard from '../components/ProductCard.vue'
import MiniCard from '../components/MiniCard.vue'
import StaleBanner from '../components/StaleBanner.vue'
import { useSpecials } from '../composables/useSpecials'
import { toOffer } from '../lib/compare'
import { chainClass, displayName, money } from '../lib/format'
import { daysLeft } from '../lib/week'
import { catName, chainBadge, t } from '../composables/useI18n'
import { useCategories } from '../composables/useCategories'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'
import { dealPrice } from '../lib/compare'

const { loading, activeStores, totalSpecials, top, deepDiscounts, freshByKg, biggestSaving, whereToGo } =
  useSpecials()
const { nameOf } = useCategories()
const { isIn, name, avatar } = useAuth()
const { watched } = useSync()
const { groups } = useSpecials()
/** J1 · 你關注的有特價：關注的 product_key 這週在你的店有特價的 */
const watchedHits = computed(() => [...watched.value].map((k) => groups.value.get(k)).filter((g): g is NonNullable<typeof g> => !!g).slice(0, 8))

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
        <RouterLink v-if="isIn" class="iconbtn" to="/me" aria-label="Me" style="padding: 0; overflow: hidden">
          <img v-if="avatar" :src="avatar" alt="" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover" referrerpolicy="no-referrer" />
          <span v-else style="font-weight: 800">{{ name.slice(0, 1) }}</span>
        </RouterLink>
        <RouterLink v-else class="pill soft" to="/signin">{{ t('common.signIn') }}</RouterLink>
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

      <!-- §10 這週去哪家：一句話結論，按第一層分類 -->
      <template v-if="whereToGo.length">
        <div class="pad" style="margin-top: 22px"><div class="h2">{{ t('home.where') }}</div></div>
        <div class="pad" style="margin-top: 8px">
          <div class="box">
            <div v-for="w in whereToGo" :key="w.cat" class="lrow" style="padding: 10px 12px">
              <div class="grow" style="min-width: 0">
                <div class="t ell" style="font-size: 15px">{{ catName(nameOf(w.cat)) }}</div>
                <div class="s ell">{{ t('home.whereWins', { w: w.wins, n: w.total }) }}</div>
              </div>
              <span class="tag best" :class="chainClass(w.store.id)" style="flex: none">✓ {{ chainBadge(w.store.id) }}</span>
            </div>
          </div>
        </div>
      </template>

      <template v-if="isIn && watchedHits.length">
        <div class="pad hrow" style="margin-top: 22px">
          <div class="h2">{{ t('home.watched') }}</div>
          <div class="link">{{ watchedHits.length }}</div>
        </div>
        <div class="pad" style="margin-top: 8px">
          <div class="box">
            <RouterLink v-for="g in watchedHits" :key="g.key" class="lrow tap" :to="`/p/${encodeURIComponent(g.key)}`" style="padding: 10px 12px">
              <span class="dot" :class="chainClass(g.best.store.id)" />
              <div class="grow" style="min-width: 0">
                <div class="t ell" style="font-size: 14px">{{ displayName(g.best.special) }}</div>
                <div class="s ell">{{ g.best.store.name }}</div>
              </div>
              <div class="p" style="font-size: 17px">{{ money(dealPrice(g.best.special)) }}</div>
            </RouterLink>
          </div>
        </div>
      </template>

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
        {{ t('me.footnote') }}
      </div>
    </template>
  </div>
</template>
