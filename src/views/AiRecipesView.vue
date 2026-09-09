<script setup lang="ts">
// 清單勾食材（或食譜頁「用本週特價」）→ 一次出 3 道完整食譜。
// 食材全部來自你勾的東西和你的店這週的特價，所以每樣都有價格、可以一鍵加清單（docs/recipes-ai-design.md §5）。
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { AiError, buildPool, fetchRecipes, isCookingCategory, loadPrefs, savePrefs, type AiRecipe, type Anchor, type Prefs } from '../lib/aiRecipe'
import { useSpecials } from '../composables/useSpecials'
import { useList } from '../composables/useList'
import { chainName, displayName, money } from '../lib/format'
import { dealPrice } from '../lib/compare'
import { lang, t } from '../composables/useI18n'
import type { Group } from '../lib/types'

const route = useRoute()
const { groups, loading: specialsLoading } = useSpecials()
const { add, addFreeText, has } = useList()

/** 從食譜頁進來：沒有錨，只用本週特價。 */
const fromWeek = computed(() => route.query.from === 'week')

interface Picked {
  key: string | null
  name: string
}
const picked = ref<Picked[]>([])
const prefs = ref<Prefs>(loadPrefs())
const recipes = ref<AiRecipe[]>([])
const loading = ref(true)
const error = ref<'quota' | 'signIn' | 'few' | 'failed' | null>(null)
const open = ref<number | null>(null)
const added = ref<Set<number>>(new Set())

/** 勾的東西分兩堆：食材（送給 AI）、不算食材（飲料零食，灰掉不送）。清單裡沒對到特價的自由項當「已經有」的食材。 */
const anchors = computed<Anchor[]>(() =>
  picked.value
    .filter((p) => {
      const g = p.key ? groups.value.get(p.key) : undefined
      return !g || isCookingCategory(g.best.special.category_id)
    })
    .map((p) => {
      const g = p.key ? groups.value.get(p.key) : undefined
      return g ? { id: g.key, name: displayName(g.best.special) } : { id: `free:${p.name}`, name: p.name }
    }),
)
const notFood = computed(() =>
  picked.value.filter((p) => {
    const g = p.key ? groups.value.get(p.key) : undefined
    return !!g && !isCookingCategory(g.best.special.category_id)
  }),
)
const pool = computed(() => buildPool(groups.value, new Set(anchors.value.map((a) => a.id))))
const anchorName = computed(() => new Map(anchors.value.map((a) => [a.id, a.name])))
const poolName = computed(() => new Map(pool.value.map((p) => [p.id, p.name])))

async function load(fresh = false) {
  loading.value = true
  error.value = null
  open.value = null
  added.value = new Set()
  try {
    recipes.value = await fetchRecipes(anchors.value, pool.value, prefs.value, lang.value, fresh)
    if (recipes.value.length === 1) open.value = 0
  } catch (e) {
    error.value = e instanceof AiError ? e.code : 'failed'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!fromWeek.value) {
    try {
      picked.value = JSON.parse(sessionStorage.getItem('ai:picked') ?? '[]') as Picked[]
    } catch {
      picked.value = []
    }
  }
  // 冷開（重整）時特價還在載，等它好了再問，不然池是空的。
  if (specialsLoading.value) {
    const stop = watch(specialsLoading, (v) => {
      if (!v) {
        stop()
        void load()
      }
    })
  } else void load()
})

function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs.value = { ...prefs.value, [k]: v }
  savePrefs(prefs.value)
  void load()
}

interface Line {
  name: string
  qty: string
  kind: 'have' | 'buy' | 'off' | 'staple'
  group: Group | null
}
interface Card {
  r: AiRecipe
  lines: Line[]
  have: number
  buys: Line[]
  staples: Line[]
  cost: number
  chains: string[]
}
const cards = computed<Card[]>(() =>
  recipes.value.map((r) => {
    const lines: Line[] = r.ingredients.map((i) => {
      if (i.staple) return { name: i.name, qty: i.qty, kind: 'staple', group: null }
      if (i.id && anchorName.value.has(i.id)) return { name: anchorName.value.get(i.id) as string, qty: i.qty, kind: 'have', group: null }
      const g = i.id ? groups.value.get(i.id) : undefined
      if (g) return { name: displayName(g.best.special), qty: i.qty, kind: 'buy', group: g }
      // 池外食材；萬一編號對不到現在的特價（店換了），至少把池裡的名字顯示出來
      return { name: i.name || (i.id && poolName.value.get(i.id)) || '', qty: i.qty, kind: 'off', group: null }
    })
    const buys = lines.filter((l) => l.kind === 'buy' || l.kind === 'off')
    const cost = buys.reduce((s, l) => s + (l.group ? dealPrice(l.group.best.special) : 0), 0)
    const chains = [...new Set(buys.map((l) => (l.group ? chainName(l.group.best.store.id) : '')).filter(Boolean))]
    return { r, lines, have: lines.filter((l) => l.kind === 'have').length, buys, staples: lines.filter((l) => l.kind === 'staple'), cost, chains }
  }),
)

function addBuys(i: number) {
  for (const l of cards.value[i].buys) {
    if (l.group) {
      if (!has(l.group.key)) add(l.group.key, displayName(l.group.best.special))
    } else addFreeText(l.name)
  }
  added.value = new Set([...added.value, i])
}
const backTo = computed(() => (fromWeek.value ? '/recipes' : '/list'))
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px">
      <RouterLink class="back" :to="backTo">{{ fromWeek ? t('recipes.back') : t('ai.backList') }}</RouterLink>
    </div>
    <div class="pad" style="margin-top: 8px">
      <span class="tag low">{{ t('ai.badge') }}</span>
      <div class="h1" style="margin-top: 8px">{{ fromWeek ? t('ai.weekTitle') : t('ai.title') }}</div>
      <div v-if="anchors.length" class="sub" style="margin-top: 8px">{{ t('ai.anchors', { s: anchors.map((a) => a.name).join('、') }) }}</div>
      <div v-if="notFood.length" class="s muted" style="margin-top: 4px">{{ t('ai.notFood', { s: notFood.map((p) => p.name).join('、') }) }}</div>
      <div class="s muted" style="margin-top: 6px; font-size: 12.5px">{{ t('ai.poolSub', { n: pool.length }) }}</div>
    </div>

    <div class="pad chips" style="margin-top: 12px">
      <button v-for="n in [2, 4]" :key="'s' + n" class="chip" :class="{ on: prefs.serves === n }" @click="setPref('serves', n)">{{ t('ai.serves', { n }) }}</button>
      <button v-for="m in [20, 40]" :key="'m' + m" class="chip" :class="{ on: prefs.maxMinutes === m }" @click="setPref('maxMinutes', m)">{{ t('ai.under', { m }) }}</button>
      <button v-for="sp in (['mild', 'medium', 'hot'] as const)" :key="sp" class="chip" :class="{ on: prefs.spice === sp }" @click="setPref('spice', sp)">{{ t('ai.spice.' + sp) }}</button>
    </div>
    <div class="pad" style="margin-top: 10px">
      <div class="field" style="height: 44px">
        <input :value="prefs.avoid" :placeholder="t('ai.avoidPlaceholder')" style="flex: 1" @change="setPref('avoid', ($event.target as HTMLInputElement).value.slice(0, 60))" />
      </div>
    </div>

    <div v-if="loading" class="pad" style="margin-top: 14px">
      <div v-for="i in 3" :key="i" class="skel" style="height: 92px; margin-top: 10px" />
      <div class="s muted" style="margin-top: 12px; text-align: center">{{ t('ai.thinking') }}</div>
    </div>

    <div v-else-if="error" class="pad" style="margin-top: 14px">
      <div class="empty sub">
        {{ error === 'quota' ? t('ai.quota') : error === 'signIn' ? t('ai.needSignIn') : error === 'few' ? t('ai.few') : t('ai.failed') }}
        <div style="margin-top: 12px">
          <RouterLink v-if="error === 'signIn'" class="btn ghost" to="/signin" style="height: 42px; font-size: 15px">{{ t('common.signIn') }}</RouterLink>
          <RouterLink v-else-if="error === 'few'" class="btn ghost" :to="pool.length ? backTo : '/stores'" style="height: 42px; font-size: 15px">{{ pool.length ? t('ai.pickMore') : t('stores.title') }}</RouterLink>
          <button v-else-if="error !== 'quota'" class="btn ghost" style="height: 42px; font-size: 15px" @click="load(true)">{{ t('ai.retry') }}</button>
        </div>
      </div>
    </div>

    <template v-else>
      <div v-if="!cards.length" class="pad" style="margin-top: 14px">
        <div class="empty sub">
          {{ t('ai.none') }}
          <div style="margin-top: 12px">
            <RouterLink class="btn ghost" :to="backTo" style="height: 42px; font-size: 15px">{{ t('ai.pickMore') }}</RouterLink>
          </div>
        </div>
      </div>

      <div v-for="(c, i) in cards" :key="i" class="pad" style="margin-top: 10px">
        <div class="rcard">
          <button class="rhead" @click="open = open === i ? null : i">
            <div class="hrow">
              <span class="tag low">{{ c.r.cuisine }}</span>
              <span class="s muted" style="font-size: 12px">{{ t('recipes.meta', { serves: c.r.serves, min: c.r.minutes }) }} · {{ t('recipes.' + c.r.difficulty) }}</span>
            </div>
            <div class="h3" style="margin-top: 6px">{{ c.r.title }}</div>
            <div class="s" style="margin-top: 5px">
              <template v-if="c.have">{{ t('ai.have', { n: c.have }) }} · </template>
              <template v-if="c.buys.length">{{ t('ai.buy', { n: c.buys.length }) }}<template v-if="c.cost"> · {{ t('ai.approx', { v: money(c.cost) }) }}</template><template v-if="c.chains.length"> · {{ c.chains.join(' / ') }}</template></template>
              <template v-else>{{ t('ai.noBuy') }}</template>
            </div>
            <div class="s muted" style="margin-top: 6px; font-size: 12.5px">{{ open === i ? t('ai.collapse') : t('ai.expand') }}</div>
          </button>

          <div v-if="open === i" class="rbody">
            <div class="h2" style="font-size: 15px">{{ t('recipes.ingredients') }}</div>
            <div class="box" style="margin-top: 8px">
              <div v-for="(l, j) in c.lines.filter((x) => x.kind !== 'staple')" :key="j" class="lrow">
                <span class="pin" :class="l.kind === 'have' ? 'have' : 'buy'">{{ l.kind === 'have' ? '✓' : '+' }}</span>
                <div class="grow" style="min-width: 0">
                  <div class="t">{{ l.name }}<span class="qty">{{ l.qty }}</span></div>
                  <div class="s ell">
                    <template v-if="l.kind === 'have'">{{ t('ai.inList') }}</template>
                    <template v-else-if="l.group">{{ chainName(l.group.best.store.id) }}</template>
                    <template v-else>{{ t('ai.buyNoSpecial') }}</template>
                  </div>
                </div>
                <div v-if="l.group" class="p">{{ money(dealPrice(l.group.best.special)) }}</div>
                <span v-else-if="l.kind === 'off'" class="tag low">{{ t('recipes.notOnSpecial') }}</span>
              </div>
            </div>
            <div v-if="c.staples.length" class="s muted" style="margin-top: 8px; font-size: 13px; line-height: 1.4">
              {{ t('recipes.staples', { s: c.staples.map((l) => l.name).join('、') }) }}
            </div>
            <div v-if="c.buys.length" style="margin-top: 12px">
              <RouterLink v-if="added.has(i)" class="btn ghost" to="/list" style="font-size: 16px">{{ t('recipes.added') }}</RouterLink>
              <button v-else class="btn" style="font-size: 16px" @click="addBuys(i)">
                {{ c.cost ? t('ai.addBuys', { n: c.buys.length, v: money(c.cost) }) : t('recipes.addNoPrice', { n: c.buys.length }) }}
              </button>
            </div>

            <div class="h2" style="font-size: 15px; margin-top: 18px">{{ t('recipes.method') }}</div>
            <div v-for="(s, k) in c.r.steps" :key="k" class="rstep"><b>{{ k + 1 }}</b><span>{{ s }}</span></div>
            <div v-if="c.r.tip" class="tipbox"><b>{{ t('recipes.tip') }}</b> {{ c.r.tip }}</div>
          </div>
        </div>
      </div>

      <div class="pad" style="margin-top: 14px">
        <button class="btn ghost" style="height: 46px; font-size: 15px" @click="load(true)">{{ t('ai.rethink') }}</button>
        <div class="s muted" style="margin-top: 12px; font-size: 12px; line-height: 1.45">{{ t('ai.disclaimer') }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rcard { border: 1px solid var(--line); border-radius: var(--r); background: var(--paper); overflow: hidden; }
.rhead { display: block; width: 100%; text-align: left; padding: 12px 14px; background: var(--paper); color: inherit; }
.rhead:active { background: var(--paper-2); }
.rbody { padding: 4px 14px 16px; border-top: 1px solid var(--line); }
.pin { width: 24px; height: 24px; border-radius: 8px; flex: none; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; }
.pin.have { background: var(--ink); color: #fff; }
.pin.buy { border: 1.5px dashed #b5b5b0; color: var(--ink-2); }
.qty { margin-left: 8px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.rstep { display: flex; gap: 12px; margin-top: 12px; font-size: 15.5px; line-height: 1.45; }
.rstep b { flex: none; width: 16px; font-family: 'Inter Tight', Inter, sans-serif; font-weight: 900; }
.tipbox { margin-top: 16px; padding: 12px 14px; border-radius: var(--r); background: var(--paper-2); font-size: 14px; line-height: 1.45; }
</style>
