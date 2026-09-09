<script setup lang="ts">
// 一道 AI 食譜的卡片：收起是摘要（照片、菜系 · 分鐘 · 你有 N 樣 · 要買 M 樣 · 約 $X），展開是食材、加清單、做法、小撇步。
// AI 食譜頁和「我的 → 食譜紀錄」都用這張。
// 「同一家 · 最便宜」切換：同一家＝挑能買到最多樣的那家店（同一樣商品，沒有就同類替代），那家沒有的才標「別家」；最便宜＝每樣各挑最便宜的店。
import { computed, ref } from 'vue'
import type { AiIngredient, AiRecipe } from '../lib/aiRecipe'
import { useSpecials } from '../composables/useSpecials'
import { useList } from '../composables/useList'
import { chainName, displayName, money } from '../lib/format'
import { dealPrice } from '../lib/compare'
import { t } from '../composables/useI18n'
import type { Group, Offer, Store } from '../lib/types'

const props = defineProps<{ recipe: AiRecipe; open: boolean; static?: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { groups, activeStores, familyAlt } = useSpecials()
const { add, addFreeText, has } = useList()
const added = ref(false)
const mode = ref<'one' | 'cheap'>('one')

type Kind = 'have' | 'buy' | 'off' | 'staple'
interface Base { ing: AiIngredient; kind: Kind; group: Group | null }
const base = computed<Base[]>(() =>
  props.recipe.ingredients.map((ing) => {
    if (ing.staple) return { ing, kind: 'staple', group: null }
    if (!ing.id) return { ing, kind: 'off', group: null }
    const group = groups.value.get(ing.id) ?? null
    if (ing.id.startsWith('free:') || has(ing.id)) return { ing, kind: 'have', group }
    return { ing, kind: 'buy', group }
  }),
)

/** 這家店買得到嗎：同一樣商品優先，沒有就同類替代（§8 family）。 */
function pickAt(g: Group, storeId: string): { offer: Offer; alt: boolean } | null {
  const same = g.offers.find((o) => o.store.id === storeId)
  if (same) return { offer: same, alt: false }
  const alt = familyAlt(g, storeId)
  return alt ? { offer: alt, alt: true } : null
}
/** 同一家：哪家能買到最多樣要買的（同分挑便宜的）。 */
const oneStore = computed<{ store: Store; n: number; cost: number; m: number } | null>(() => {
  const buys = base.value.filter((b) => b.kind === 'buy' && b.group)
  if (!buys.length) return null
  let best: { store: Store; n: number; cost: number; m: number } | null = null
  for (const d of activeStores.value) {
    let n = 0
    let cost = 0
    for (const b of buys) {
      const p = pickAt(b.group as Group, d.store.id)
      if (p) {
        n += 1
        cost += dealPrice(p.offer.special)
      }
    }
    if (!best || n > best.n || (n === best.n && cost < best.cost)) best = { store: d.store, n, cost, m: buys.length }
  }
  return best && best.n ? best : null
})

interface Line {
  name: string
  qty: string
  kind: Kind
  price: number | null
  store: string | null
  link: string
  note: string
  /** 加清單用的 product_key（有特價的才有） */
  key: string | null
}
const lines = computed<Line[]>(() =>
  base.value.map(({ ing, kind, group }) => {
    const plain = (name: string): Line => ({ name, qty: ing.qty, kind, price: null, store: null, link: '', note: '', key: null })
    if (kind === 'staple' || kind === 'off') return plain(ing.name)
    if (kind === 'have') return { ...plain(group ? displayName(group.best.special) : ing.name), link: group ? `/p/${encodeURIComponent(group.key)}` : '' }
    // 要買
    if (!group) return { ...plain(ing.name), price: ing.price, store: ing.store, note: '' }   // 紀錄裡、這週已經沒特價的：用當時存的
    const asLine = (o: Offer, note: string): Line => ({
      name: displayName(o.special),
      qty: ing.qty,
      kind,
      price: dealPrice(o.special),
      store: chainName(o.store.id),
      link: o.special.product_key ? `/p/${encodeURIComponent(o.special.product_key)}` : '',
      note,
      key: o.special.product_key,
    })
    if (mode.value === 'one' && oneStore.value) {
      const p = pickAt(group, oneStore.value.store.id)
      if (p) return asLine(p.offer, p.alt ? t('ai.similar') : '')
      return asLine(group.best, t('ai.otherStore', { s: chainName(group.best.store.id) }))
    }
    return asLine(group.best, '')
  }),
)
const have = computed(() => lines.value.filter((l) => l.kind === 'have').length)
const buys = computed(() => lines.value.filter((l) => l.kind === 'buy' || l.kind === 'off'))
const staples = computed(() => lines.value.filter((l) => l.kind === 'staple'))
const cost = computed(() => buys.value.reduce((s, l) => s + (l.price ?? 0), 0))
const stores = computed(() => [...new Set(buys.value.map((l) => l.store).filter((s): s is string => !!s))])

function addBuys() {
  for (const l of buys.value) {
    if (l.key) {
      if (!has(l.key)) add(l.key, l.name)
    } else addFreeText(l.name)
  }
  added.value = true
}
</script>

<template>
  <div class="rcard">
    <component :is="static ? 'div' : 'button'" class="rhead" @click="!static && emit('toggle')">
      <div class="hrow" style="align-items: flex-start; gap: 12px">
        <div class="grow" style="min-width: 0">
          <div class="hrow">
            <span class="tag low">{{ recipe.cuisine }}</span>
            <span class="s muted" style="font-size: 12px">{{ t('recipes.meta', { serves: recipe.serves, min: recipe.minutes }) }} · {{ t('recipes.' + recipe.difficulty) }}</span>
          </div>
          <div class="h3" style="margin-top: 6px">{{ recipe.title }}</div>
          <div class="s" style="margin-top: 5px">
            <template v-if="recipe.kcal">{{ t('recipes.kcal', { n: recipe.kcal }) }} · </template>
            <template v-if="have">{{ t('ai.have', { n: have }) }} · </template>
            <template v-if="buys.length">{{ t('ai.buy', { n: buys.length }) }}<template v-if="cost"> · {{ t('ai.approx', { v: money(cost) }) }}</template><template v-if="stores.length"> · {{ stores.join(' / ') }}</template></template>
            <template v-else>{{ t('ai.noBuy') }}</template>
          </div>
          <div v-if="!static" class="s muted" style="margin-top: 6px; font-size: 12.5px">{{ open ? t('ai.collapse') : t('ai.expand') }}</div>
        </div>
        <img v-if="recipe.image?.url" class="ph" :src="recipe.image.url" alt="" loading="lazy" decoding="async" />
      </div>
    </component>

    <div v-if="open" class="rbody">
      <div v-if="recipe.image?.url" class="hero"><img :src="recipe.image.url" alt="" decoding="async" /></div>
      <a v-if="recipe.image?.link" class="credit" :href="recipe.image.link" target="_blank" rel="noopener">{{ t('recipes.photo', { p: recipe.image.photographer }) }}</a>

      <div class="hrow" style="margin-top: 14px">
        <div class="h2" style="font-size: 15px">{{ t('recipes.ingredients') }}</div>
      </div>
      <div v-if="oneStore" class="seg" style="margin-top: 8px">
        <div :class="{ on: mode === 'one' }" @click="mode = 'one'">{{ t('ai.oneStore', { s: chainName(oneStore.store.id), n: oneStore.n, m: oneStore.m }) }}</div>
        <div :class="{ on: mode === 'cheap' }" @click="mode = 'cheap'">{{ t('ai.cheapest') }}</div>
      </div>
      <div class="box" style="margin-top: 8px">
        <component :is="l.link ? 'RouterLink' : 'div'" v-for="(l, j) in lines.filter((x) => x.kind !== 'staple')" :key="j" class="lrow irow" :class="{ tap: l.link }" :to="l.link || undefined">
          <span class="pin" :class="l.kind === 'have' ? 'have' : 'buy'">{{ l.kind === 'have' ? '✓' : '+' }}</span>
          <div class="grow" style="min-width: 0">
            <div class="t">{{ l.name }}<span class="qty">{{ l.qty }}</span></div>
            <div class="s ell">
              <template v-if="l.kind === 'have'">{{ t('ai.inList') }}</template>
              <template v-else-if="l.store">{{ l.store }}<template v-if="l.note"> · {{ l.note }}</template></template>
              <template v-else>{{ t('ai.buyNoSpecial') }}</template>
            </div>
          </div>
          <div v-if="l.price != null" class="p">{{ money(l.price) }}</div>
          <span v-else-if="l.kind !== 'have'" class="tag low">{{ t('recipes.notOnSpecial') }}</span>
        </component>
      </div>
      <template v-if="staples.length">
        <div class="hrow" style="margin-top: 14px">
          <div class="h2" style="font-size: 15px">{{ t('ai.staplesTitle') }}</div>
          <div class="s muted" style="font-size: 12.5px">{{ t('ai.staplesSub') }}</div>
        </div>
        <div class="box stbox" style="margin-top: 8px">
          <div v-for="(l, j) in staples" :key="j" class="lrow" style="padding: 8px 12px">
            <span class="pin st">·</span>
            <div class="grow" style="min-width: 0"><div class="t">{{ l.name }}<span class="qty">{{ l.qty }}</span></div></div>
          </div>
        </div>
      </template>
      <div v-if="buys.length" style="margin-top: 12px">
        <RouterLink v-if="added" class="btn ghost" to="/list" style="font-size: 16px">{{ t('recipes.added') }}</RouterLink>
        <button v-else class="btn" style="font-size: 16px" @click="addBuys">
          {{ cost ? t('ai.addBuys', { n: buys.length, v: money(cost) }) : t('recipes.addNoPrice', { n: buys.length }) }}
        </button>
      </div>

      <div class="h2" style="font-size: 15px; margin-top: 18px">{{ t('recipes.method') }}</div>
      <div v-for="(s, k) in recipe.steps" :key="k" class="rstep"><b>{{ k + 1 }}</b><span>{{ s }}</span></div>
      <div v-if="recipe.tip" class="tipbox"><b>{{ t('recipes.tip') }}</b> {{ recipe.tip }}</div>
    </div>
  </div>
</template>

<style scoped>
.rcard { border: 1px solid var(--line); border-radius: var(--r); background: var(--paper); overflow: hidden; }
.rhead { display: block; width: 100%; text-align: left; padding: 12px 14px; background: var(--paper); color: inherit; }
button.rhead:active { background: var(--paper-2); }
.ph { width: 72px; height: 72px; border-radius: 10px; object-fit: cover; flex: none; background: var(--paper-2); }
.rbody { padding: 12px 14px 16px; border-top: 1px solid var(--line); }
.hero { border-radius: var(--r); overflow: hidden; aspect-ratio: 16 / 10; background: var(--paper-2); }
.hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
.credit { display: block; margin-top: 6px; font-size: 11px; color: var(--ink-3); text-decoration: none; }
.irow { color: inherit; text-decoration: none; }
.pin { width: 24px; height: 24px; border-radius: 8px; flex: none; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; }
.pin.have { background: var(--ink); color: #fff; }
.pin.buy { border: 1.5px dashed #b5b5b0; color: var(--ink-2); }
.pin.st { background: var(--paper-2); color: var(--ink-3); }
.stbox { background: var(--paper-2); border-style: dashed; }
.stbox .t { font-weight: 600; color: var(--ink-2); }
.qty { margin-left: 8px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.rstep { display: flex; gap: 12px; margin-top: 12px; font-size: 15.5px; line-height: 1.45; }
.rstep b { flex: none; width: 16px; font-family: 'Inter Tight', Inter, sans-serif; font-weight: 900; }
.tipbox { margin-top: 16px; padding: 12px 14px; border-radius: var(--r); background: var(--paper-2); font-size: 14px; line-height: 1.45; }
</style>
