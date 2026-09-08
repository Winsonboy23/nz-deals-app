<script setup lang="ts">
// 第二層：一道完整食譜。要買的食材先在你選的店裡找本週特價，有就帶價格、可一鍵加清單。
import { computed, onMounted, ref } from 'vue'
import { AiError, fetchRecipe, type AiRecipe, type Direction, type Prefs } from '../lib/aiRecipe'
import { useSpecials } from '../composables/useSpecials'
import { useList } from '../composables/useList'
import { dealPrice } from '../lib/compare'
import { chainName, displayName, money } from '../lib/format'
import { lang, t } from '../composables/useI18n'
import type { Group } from '../lib/types'

const { rows, groups } = useSpecials()
const { add, addFreeText } = useList()

const recipe = ref<AiRecipe | null>(null)
const loading = ref(true)
const error = ref<'quota' | 'failed' | 'lost' | 'signIn' | null>(null)
const added = ref(false)
const zh = computed(() => lang.value === 'zh')

interface Ctx {
  direction: Direction
  items: string[]
  prefs: Prefs
}
const ctx = ref<Ctx | null>(null)

async function load(fresh = false) {
  loading.value = true
  error.value = null
  const c = ctx.value
  if (!c) {
    error.value = 'lost'
    loading.value = false
    return
  }
  try {
    recipe.value = await fetchRecipe(c.items, c.prefs, c.direction, fresh)
    added.value = false
  } catch (e) {
    error.value = e instanceof AiError && (e.code === 'quota' || e.code === 'signIn') ? e.code : 'failed'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  try {
    const raw = sessionStorage.getItem('ai:direction')
    if (raw) ctx.value = JSON.parse(raw) as Ctx
  } catch {
    /* ignore */
  }
  void load()
})

/** 「要買」的食材：在你選的店這週的特價裡找最接近的，找不到就 null（顯示「本週無特價」，§8）。 */
function findSpecial(name: string): Group | null {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2)
  if (!words.length) return null
  // 先比「同類名稱」（family_name_en，例如 Grated parmesan）——那是乾淨的通用名，
  // 比商品名可靠得多：拿商品名比，"parmesan cheese" 會對到「四種起司帕瑪森麵包丁湯」。
  // 同分再挑最便宜的，因為這是比價 App。
  let best: { key: string; fam: number; name: number; price: number } | null = null
  for (const { special } of rows.value) {
    if (!special.product_key) continue
    const fam = special.family_name_en?.toLowerCase() ?? ''
    const famHits = fam ? words.filter((w) => fam.includes(w)).length : 0
    const hay = `${special.brand ?? ''} ${special.name}`.toLowerCase()
    const nameHits = words.filter((w) => hay.includes(w)).length
    if (!famHits && !nameHits) continue
    const price = dealPrice(special)
    const better =
      !best ||
      famHits > best.fam ||
      (famHits === best.fam && (nameHits > best.name || (nameHits === best.name && price < best.price)))
    if (better) best = { key: special.product_key, fam: famHits, name: nameHits, price }
  }
  return best ? groups.value.get(best.key) ?? null : null
}

interface Line {
  name: string
  qty: string
  from: 'list' | 'buy' | 'staple'
  group: Group | null
}
const lines = computed<Line[]>(() =>
  (recipe.value?.ingredients ?? []).map((i) => ({
    name: zh.value ? i.name_zh : i.name_en,
    qty: zh.value ? i.qty_zh : i.qty_en,
    from: i.from,
    group: i.from === 'buy' ? findSpecial(i.name_en) : null,
  })),
)
const buys = computed(() => lines.value.filter((l) => l.from === 'buy'))
const staples = computed(() => lines.value.filter((l) => l.from === 'staple'))
const buyCost = computed(() => buys.value.reduce((s, l) => s + (l.group ? dealPrice(l.group.best.special) : 0), 0))
/** GPT 偶爾多吐一個空步驟，濾掉才不會出現一個空的編號。 */
const steps = computed(() =>
  ((zh.value ? recipe.value?.steps_zh : recipe.value?.steps_en) ?? []).map((s) => s.trim()).filter(Boolean),
)

function addBuys() {
  for (const l of buys.value) {
    if (l.group) add(l.group.key, displayName(l.group.best.special))
    else addFreeText(l.name)
  }
  added.value = true
}
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px">
      <RouterLink class="back" to="/list">{{ t('ai.backList') }}</RouterLink>
    </div>

    <div v-if="loading" class="pad" style="margin-top: 16px">
      <div class="skel" style="height: 36px; width: 78%" />
      <div class="skel" style="height: 18px; width: 46%; margin-top: 10px" />
      <div class="skel" style="height: 200px; margin-top: 18px" />
      <div class="s muted" style="margin-top: 12px; text-align: center">{{ t('ai.cooking') }}</div>
    </div>

    <div v-else-if="error" class="pad" style="margin-top: 18px">
      <div class="empty sub">
        {{ error === 'quota' ? t('ai.quota') : error === 'signIn' ? t('ai.needSignIn') : error === 'lost' ? t('ai.lost') : t('ai.failed') }}
        <div style="margin-top: 12px">
          <RouterLink v-if="error === 'signIn'" class="btn ghost" to="/signin" style="height: 42px; font-size: 15px">
            {{ t('common.signIn') }}
          </RouterLink>
          <RouterLink v-else-if="error === 'lost'" class="btn ghost" to="/list" style="height: 42px; font-size: 15px">
            {{ t('ai.backList') }}
          </RouterLink>
          <button v-else-if="error !== 'quota'" class="btn ghost" style="height: 42px; font-size: 15px" @click="load(true)">
            {{ t('ai.retry') }}
          </button>
        </div>
      </div>
    </div>

    <template v-else-if="recipe">
      <div class="pad" style="margin-top: 8px">
        <span class="tag low">{{ t('ai.badge') }}</span>
        <div class="h1" style="margin-top: 8px">{{ zh ? recipe.title_zh : recipe.title_en }}</div>
        <div class="sub" style="margin-top: 8px">
          {{ t('recipes.meta', { serves: recipe.serves, min: recipe.minutes }) }} ·
          {{ t('recipes.' + recipe.difficulty) }}
        </div>
      </div>

      <div class="pad" style="margin-top: 20px">
        <div class="h2">{{ t('recipes.ingredients') }}</div>
        <div class="box" style="margin-top: 10px">
          <div v-for="(l, i) in lines.filter((x) => x.from !== 'staple')" :key="i" class="lrow">
            <span class="pin" :class="l.from === 'list' ? 'have' : 'buy'">{{ l.from === 'list' ? '✓' : '+' }}</span>
            <div class="grow">
              <div class="t">{{ l.name }}<span class="qty">{{ l.qty }}</span></div>
              <div class="s ell">
                <template v-if="l.from === 'list'">{{ t('ai.inList') }}</template>
                <template v-else-if="l.group">
                  {{ chainName(l.group.best.store.id) }} · {{ displayName(l.group.best.special) }}
                </template>
                <template v-else>{{ t('ai.buyNoSpecial') }}</template>
              </div>
            </div>
            <div v-if="l.group" class="p">{{ money(dealPrice(l.group.best.special)) }}</div>
            <span v-else-if="l.from === 'buy'" class="tag low">{{ t('recipes.notOnSpecial') }}</span>
          </div>
        </div>
        <div v-if="staples.length" class="s muted" style="margin-top: 10px; font-size: 13px; line-height: 1.4">
          {{ t('recipes.staples', { s: staples.map((l) => l.name).join('、') }) }}
        </div>
        <div v-if="buys.length" style="margin-top: 14px">
          <RouterLink v-if="added" class="btn ghost" to="/list" style="font-size: 16px">{{ t('recipes.added') }}</RouterLink>
          <button v-else class="btn" style="font-size: 16px" @click="addBuys">
            {{ buyCost ? t('ai.addBuys', { n: buys.length, v: money(buyCost) }) : t('recipes.addNoPrice', { n: buys.length }) }}
          </button>
        </div>
      </div>

      <div class="pad" style="margin-top: 24px">
        <div class="h2">{{ t('recipes.method') }}</div>
        <div v-for="(s, i) in steps" :key="i" class="rstep">
          <b>{{ i + 1 }}</b><span>{{ s }}</span>
        </div>
        <div class="tipbox">
          <b>{{ t('recipes.tip') }}</b> {{ zh ? recipe.tip_zh : recipe.tip_en }}
        </div>
        <button class="btn ghost" style="height: 46px; font-size: 15px; margin-top: 16px" @click="load(true)">
          {{ t('ai.anotherDish') }}
        </button>
        <div class="s muted" style="margin-top: 12px; font-size: 12px; line-height: 1.45">{{ t('ai.disclaimer') }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pin {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 13px;
}
.pin.have { background: var(--ink); color: #fff; }
.pin.buy { border: 1.5px dashed #b5b5b0; color: var(--ink-2); }
.qty { margin-left: 8px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.rstep { display: flex; gap: 12px; margin-top: 12px; font-size: 15.5px; line-height: 1.45; }
.rstep b { flex: none; width: 16px; font-family: 'Inter Tight', Inter, sans-serif; font-weight: 900; }
.tipbox {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: var(--r);
  background: var(--paper-2);
  font-size: 14px;
  line-height: 1.45;
}
</style>
