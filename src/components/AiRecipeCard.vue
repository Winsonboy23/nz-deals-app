<script setup lang="ts">
// 一道 AI 食譜的卡片：收起是摘要（菜系 · 分鐘 · 你有 N 樣 · 要買 M 樣 · 約 $X），展開是食材、加清單、做法、小撇步。
// AI 食譜頁和「我的 → 食譜紀錄」都用這張。食材編號對得到本週特價就用現在的價格和店，對不到就用生成當下存的。
import { computed, ref } from 'vue'
import type { AiRecipe } from '../lib/aiRecipe'
import { useSpecials } from '../composables/useSpecials'
import { useList } from '../composables/useList'
import { chainName, displayName, money } from '../lib/format'
import { dealPrice } from '../lib/compare'
import { t } from '../composables/useI18n'
import type { Group } from '../lib/types'

const props = defineProps<{ recipe: AiRecipe; open: boolean; static?: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { groups } = useSpecials()
const { add, addFreeText, has } = useList()
const added = ref(false)

interface Line {
  name: string
  qty: string
  kind: 'have' | 'buy' | 'off' | 'staple'
  group: Group | null
  price: number | null
  store: string | null
  link: string
}
const lines = computed<Line[]>(() =>
  props.recipe.ingredients.map((i) => {
    if (i.staple) return { name: i.name, qty: i.qty, kind: 'staple', group: null, price: null, store: null, link: '' }
    if (!i.id) return { name: i.name, qty: i.qty, kind: 'off', group: null, price: null, store: null, link: '' }
    const g = groups.value.get(i.id) ?? null
    const name = g ? displayName(g.best.special) : i.name
    const link = g ? `/p/${encodeURIComponent(i.id)}` : ''
    // 你有：手打的、或現在還在清單裡的
    if (i.id.startsWith('free:') || has(i.id)) return { name, qty: i.qty, kind: 'have', group: g, price: null, store: null, link }
    return {
      name,
      qty: i.qty,
      kind: 'buy',
      group: g,
      price: g ? dealPrice(g.best.special) : i.price,
      store: g ? chainName(g.best.store.id) : i.store,
      link,
    }
  }),
)
const have = computed(() => lines.value.filter((l) => l.kind === 'have').length)
const buys = computed(() => lines.value.filter((l) => l.kind === 'buy' || l.kind === 'off'))
const staples = computed(() => lines.value.filter((l) => l.kind === 'staple'))
const cost = computed(() => buys.value.reduce((s, l) => s + (l.price ?? 0), 0))
const stores = computed(() => [...new Set(buys.value.map((l) => l.store).filter((s): s is string => !!s))])

function addBuys() {
  for (const l of buys.value) {
    if (l.group) {
      if (!has(l.group.key)) add(l.group.key, displayName(l.group.best.special))
    } else addFreeText(l.name)
  }
  added.value = true
}
</script>

<template>
  <div class="rcard">
    <component :is="static ? 'div' : 'button'" class="rhead" @click="!static && emit('toggle')">
      <div class="hrow">
        <span class="tag low">{{ recipe.cuisine }}</span>
        <span class="s muted" style="font-size: 12px">
          {{ t('recipes.meta', { serves: recipe.serves, min: recipe.minutes }) }} · {{ t('recipes.' + recipe.difficulty) }}<template v-if="recipe.kcal"> · {{ t('recipes.kcal', { n: recipe.kcal }) }}</template>
        </span>
      </div>
      <div class="h3" style="margin-top: 6px">{{ recipe.title }}</div>
      <div class="s" style="margin-top: 5px">
        <template v-if="have">{{ t('ai.have', { n: have }) }} · </template>
        <template v-if="buys.length">{{ t('ai.buy', { n: buys.length }) }}<template v-if="cost"> · {{ t('ai.approx', { v: money(cost) }) }}</template><template v-if="stores.length"> · {{ stores.join(' / ') }}</template></template>
        <template v-else>{{ t('ai.noBuy') }}</template>
      </div>
      <div v-if="!static" class="s muted" style="margin-top: 6px; font-size: 12.5px">{{ open ? t('ai.collapse') : t('ai.expand') }}</div>
    </component>

    <div v-if="open" class="rbody">
      <div class="h2" style="font-size: 15px">{{ t('recipes.ingredients') }}</div>
      <div class="box" style="margin-top: 8px">
        <component :is="l.link ? 'RouterLink' : 'div'" v-for="(l, j) in lines.filter((x) => x.kind !== 'staple')" :key="j" class="lrow irow" :class="{ tap: l.link }" :to="l.link || undefined">
          <span class="pin" :class="l.kind === 'have' ? 'have' : 'buy'">{{ l.kind === 'have' ? '✓' : '+' }}</span>
          <div class="grow" style="min-width: 0">
            <div class="t">{{ l.name }}<span class="qty">{{ l.qty }}</span></div>
            <div class="s ell">
              <template v-if="l.kind === 'have'">{{ t('ai.inList') }}</template>
              <template v-else-if="l.store">{{ l.store }}</template>
              <template v-else>{{ t('ai.buyNoSpecial') }}</template>
            </div>
          </div>
          <div v-if="l.price != null" class="p">{{ money(l.price) }}</div>
          <span v-else-if="l.kind !== 'have'" class="tag low">{{ t('recipes.notOnSpecial') }}</span>
        </component>
      </div>
      <div v-if="staples.length" class="s muted" style="margin-top: 8px; font-size: 13px; line-height: 1.4">
        {{ t('recipes.staples', { s: staples.map((l) => l.name).join('、') }) }}
      </div>
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
.rbody { padding: 4px 14px 16px; border-top: 1px solid var(--line); }
.irow { color: inherit; text-decoration: none; }
.pin { width: 24px; height: 24px; border-radius: 8px; flex: none; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; }
.pin.have { background: var(--ink); color: #fff; }
.pin.buy { border: 1.5px dashed #b5b5b0; color: var(--ink-2); }
.qty { margin-left: 8px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.rstep { display: flex; gap: 12px; margin-top: 12px; font-size: 15.5px; line-height: 1.45; }
.rstep b { flex: none; width: 16px; font-family: 'Inter Tight', Inter, sans-serif; font-weight: 900; }
.tipbox { margin-top: 16px; padding: 12px 14px; border-radius: var(--r); background: var(--paper-2); font-size: 14px; line-height: 1.45; }
</style>
