<script setup lang="ts">
// 清單最下面「AI 食譜」進來。兩段：
// ① 表單分兩頁（KiteWise 3-7，網址不變，用「下一步／上一步」切，每次進來都從第 1 頁開始）：
//    第 1 頁：清單裡的東西一列列可勾（食物預設全勾、飲料零食灰掉）、手打補食材、問卷（人份／時間／辣度／難度／飲食需求／料理類型／心情／預算／喜好）
//    第 2 頁：家裡有哪些廚具（9 格，預設全選），最下面「AI 食譜」按了才生成
// ② 結果：只顯示食譜（最多 2 道）、「再想 2 道」；返回回到表單。用網址 ?r=1 記段落，手機返回鍵也會回表單。
// 每道後端都存進「我的 → 食譜紀錄」。
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AiError, CUISINES, DIETS, HISTORY_MAX, KITCHEN, MOODS, buildPool, fetchRecipes, historyCount, isCookingCategory, loadPrefs, savePrefs, type AiRecipe, type Anchor, type Prefs } from '../lib/aiRecipe'
import AiRecipeCard from '../components/AiRecipeCard.vue'
import GradientButton from '../components/GradientButton.vue'
import { useSpecials } from '../composables/useSpecials'
import { useList } from '../composables/useList'
import { useAuth } from '../composables/useAuth'
import { displayName } from '../lib/format'
import { lang, t } from '../composables/useI18n'

const MAX_ANCHORS = 10
const route = useRoute()
const router = useRouter()
const { groups } = useSpecials()
const { items } = useList()
const { isIn } = useAuth()

/** 一站「大包裝剩下的做成明天的菜」帶來的食材（?anchor=<product_key>&name=…）：清單裡有就只勾它，沒有就多一列勾起來。 */
const qAnchor = typeof route.query.anchor === 'string' ? route.query.anchor : ''
const qName = typeof route.query.name === 'string' ? route.query.name.slice(0, 60) : ''
/** 清單每一項：食物（可勾）或不算食材（灰掉）。清單裡沒對到特價的、手打的一律算食物。 */
const rows = computed(() => {
  const out: Array<{ id: string; key: string | null; name: string; food: boolean; extra?: boolean }> = items.value.map((i) => {
    const g = i.key ? groups.value.get(i.key) : undefined
    return { id: i.id, key: i.key, name: g ? displayName(g.best.special) : i.name, food: !g || isCookingCategory(g.best.special.category_id) }
  })
  if (qAnchor && !items.value.some((i) => i.key === qAnchor)) out.push({ id: `q:${qAnchor}`, key: qAnchor, name: qName || qAnchor, food: true, extra: true })
  return out
})
const anchorRow = qAnchor ? rows.value.find((r) => r.key === qAnchor) : undefined
const sel = ref<Set<string>>(new Set(anchorRow ? [anchorRow.id] : rows.value.filter((r) => r.food).slice(0, MAX_ANCHORS).map((r) => r.id)))
const extras = ref<string[]>([])
const draft = ref('')
const prefs = ref<Prefs>(loadPrefs())
/** 表單第幾頁：1 食材和偏好、2 廚具 */
const page = ref<1 | 2>(1)
const recipes = ref<AiRecipe[]>([])
const asked = ref(false)
const loading = ref(false)
const error = ref<'quota' | 'signIn' | 'few' | 'failed' | 'paused' | null>(null)
const open = ref<number | null>(null)
/** 紀錄幾筆了（滿了再生成會刪最舊的，先講） */
const histCount = ref(0)
const trimmed = ref(0)
onMounted(async () => { if (isIn.value) histCount.value = await historyCount() })
const full = computed(() => sel.value.size + extras.value.length >= MAX_ANCHORS)
/** 結果段：網址有 ?r=1 而且真的問過。重整後 asked 是 false → 回表單。 */
const showResult = computed(() => route.query.r === '1' && asked.value)
watch(showResult, (v) => { if (v) window.scrollTo({ top: 0 }) })

function toggleSel(id: string) {
  const next = new Set(sel.value)
  if (next.has(id)) next.delete(id)
  else if (!full.value) next.add(id)
  sel.value = next
}
function addExtra() {
  const n = draft.value.trim().slice(0, 40)
  if (n && !full.value && !extras.value.includes(n)) extras.value = [...extras.value, n]
  draft.value = ''
}
function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs.value = { ...prefs.value, [k]: v }
  savePrefs(prefs.value)
}
/** 幾人份：1–12，可以按 −/＋ 也可以直接打 */
function setServes(n: number) {
  const v = Math.round(n)
  setPref('serves', Number.isFinite(v) ? Math.min(12, Math.max(1, v)) : prefs.value.serves)
}
/** 多選（飲食需求、料理類型、廚具）：點了加、再點取消 */
function toggleIn(k: 'diet' | 'cuisines' | 'appliances', v: string) {
  const cur = prefs.value[k]
  setPref(k, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])
}
/** 每週預算：正整數 NZ$，空白或 0 = 不填 */
function setBudget(s: string) {
  const n = Math.round(Number(s))
  setPref('budget', Number.isFinite(n) && n > 0 ? n : null)
}
/** 第 2 頁下面那排：已選的廚具，照格子順序 */
const kitOn = computed(() => KITCHEN.filter((a) => prefs.value.appliances.includes(a.key)))
function goPage(n: 1 | 2) {
  page.value = n
  window.scrollTo({ top: 0 })
}

const anchors = computed<Anchor[]>(() => [
  ...rows.value.filter((r) => sel.value.has(r.id)).map((r) => (r.key && (r.extra || groups.value.has(r.key)) ? { id: r.key, name: r.name } : { id: `free:${r.name}`, name: r.name })),
  ...extras.value.map((n) => ({ id: `free:${n}`, name: n })),
])
const pool = computed(() => buildPool(groups.value, new Set(anchors.value.map((a) => a.id))))

async function generate() {
  if (loading.value || !anchors.value.length) return
  loading.value = true
  error.value = null
  asked.value = true
  open.value = null
  if (route.query.r !== '1') void router.push({ query: { r: '1' } })
  try {
    const out = await fetchRecipes(anchors.value, pool.value, prefs.value, lang.value)
    recipes.value = out.recipes
    trimmed.value = out.trimmed
    histCount.value = Math.min(HISTORY_MAX, histCount.value + out.recipes.length)
    if (recipes.value.length === 1) open.value = 0
  } catch (e) {
    error.value = e instanceof AiError ? e.code : 'failed'
  } finally {
    loading.value = false
  }
}
function backToForm() {
  if (route.query.r === '1') router.back()
  else void router.replace({ query: {} })
}
</script>

<template>
  <div class="screen">
    <!-- ② 結果 -->
    <template v-if="showResult">
      <div class="pad" style="margin-top: 6px">
        <button class="back" style="background: none; padding: 0" @click="backToForm">{{ t('ai.reselect') }}</button>
      </div>
      <div class="pad" style="margin-top: 8px">
        <span class="tag low">{{ t('ai.badge') }}</span>
        <div class="h1" style="margin-top: 8px">{{ loading ? t('ai.thinkingTitle') : t('ai.resultTitle', { n: recipes.length }) }}</div>
      </div>

      <div v-if="loading" class="pad" style="margin-top: 14px">
        <div v-for="i in 2" :key="i" class="skel" style="height: 110px; margin-top: 10px" />
        <div class="s muted" style="margin-top: 12px; text-align: center">{{ t('ai.thinking') }}</div>
      </div>

      <div v-else-if="error" class="pad" style="margin-top: 14px">
        <div class="empty sub">
          {{ error === 'quota' ? t('ai.quota') : error === 'signIn' ? t('ai.needSignIn') : error === 'few' ? t('ai.few') : error === 'paused' ? t('ai.paused') : t('ai.failed') }}
          <div style="margin-top: 12px">
            <RouterLink v-if="error === 'signIn'" class="btn ghost" to="/signin" style="height: 42px; font-size: 15px">{{ t('common.signIn') }}</RouterLink>
            <RouterLink v-else-if="error === 'few' && !pool.length" class="btn ghost" to="/stores" style="height: 42px; font-size: 15px">{{ t('stores.title') }}</RouterLink>
            <button v-else class="btn ghost" style="height: 42px; font-size: 15px" @click="backToForm">{{ t('ai.reselect') }}</button>
          </div>
        </div>
      </div>

      <template v-else>
        <div v-if="!recipes.length" class="pad" style="margin-top: 14px">
          <div class="empty sub">
            {{ t('ai.none') }}
            <div style="margin-top: 12px"><button class="btn ghost" style="height: 42px; font-size: 15px" @click="backToForm">{{ t('ai.reselect') }}</button></div>
          </div>
        </div>
        <div v-for="(r, i) in recipes" :key="r.dbId ?? i" class="pad" style="margin-top: 10px">
          <AiRecipeCard :recipe="r" :open="open === i" @toggle="open = open === i ? null : i" />
        </div>
        <div class="pad" style="margin-top: 16px">
          <GradientButton @click="generate">{{ t('ai.regenerate') }}</GradientButton>
          <RouterLink v-if="recipes[0]?.dbId" class="s" to="/me/recipes" style="display: block; margin-top: 12px; text-align: center; color: var(--ink-2); text-decoration: underline">{{ t('ai.savedNote') }}</RouterLink>
          <div v-if="trimmed" class="note s" style="margin-top: 10px; text-align: center">{{ t('ai.trimmedNote', { n: trimmed }) }}</div>
          <div class="s muted" style="margin-top: 12px; font-size: 12px; line-height: 1.45">{{ t('ai.disclaimer') }}</div>
        </div>
      </template>
    </template>

    <!-- ① 表單第 1 頁：食材和偏好 -->
    <template v-else-if="page === 1">
      <div class="pad" style="margin-top: 6px">
        <RouterLink class="back" to="/list">{{ t('ai.backList') }}</RouterLink>
      </div>
      <div class="pad" style="margin-top: 8px">
        <span class="tag low">{{ t('ai.badge') }}</span>
        <div class="h1" style="margin-top: 8px">{{ t('ai.title') }}</div>
        <div class="sub" style="margin-top: 8px">{{ t('ai.pickSub') }}</div>
      </div>

      <div v-if="rows.length" class="pad" style="margin-top: 12px">
        <div class="box">
          <button v-for="r in rows" :key="r.id" class="lrow tap srow" :class="{ off: !r.food }" :disabled="!r.food" @click="toggleSel(r.id)">
            <span class="cb" :class="r.food ? { on: sel.has(r.id) } : 'off'" style="width: 26px; height: 26px; font-size: 13px">✓</span>
            <span class="t grow nm">{{ r.name }}</span>
            <span v-if="!r.food" class="tag low">{{ t('ai.notFoodTag') }}</span>
          </button>
        </div>
        <div v-if="full" class="s muted" style="margin-top: 6px; font-size: 12.5px">{{ t('ai.maxPicked', { n: MAX_ANCHORS }) }}</div>
      </div>

      <div class="pad" style="margin-top: 12px">
        <div style="display: flex; gap: 8px">
          <div class="field" style="flex: 1; height: 44px">
            <input v-model="draft" :placeholder="t('ai.extraPlaceholder')" style="flex: 1" maxlength="40" @keyup.enter="addExtra" />
          </div>
          <button class="btn ghost" style="width: 72px; height: 44px; font-size: 15px; border-radius: 14px; flex: none" :disabled="!draft.trim() || full" @click="addExtra">{{ t('list.add') }}</button>
        </div>
        <div v-if="extras.length" class="chips" style="margin-top: 8px">
          <button v-for="(x, i) in extras" :key="x" class="chip on" @click="extras = extras.filter((_, j) => j !== i)">{{ x }} ×</button>
        </div>
      </div>

      <!-- 問卷 -->
      <div class="pad" style="margin-top: 16px">
        <div class="box">
          <div class="lrow q">
            <div class="ql"><b>1</b>{{ t('ai.q1') }}</div>
            <div class="step qstep">
              <button :disabled="prefs.serves <= 1" @click="setServes(prefs.serves - 1)"><i>−</i></button>
              <input class="qnum" type="number" inputmode="numeric" min="1" max="12" :value="prefs.serves" @change="setServes(Number(($event.target as HTMLInputElement).value))" />
              <span class="qunit">{{ t('ai.personUnit') }}</span>
              <button :disabled="prefs.serves >= 12" @click="setServes(prefs.serves + 1)"><i>+</i></button>
            </div>
          </div>
          <div class="lrow q">
            <div class="ql"><b>2</b>{{ t('ai.q2') }}</div>
            <div class="seg qs">
              <div v-for="m in [20, 40]" :key="m" :class="{ on: prefs.maxMinutes === m }" @click="setPref('maxMinutes', m)">{{ t('ai.mins', { m }) }}</div>
            </div>
          </div>
          <div class="lrow q">
            <div class="ql"><b>3</b>{{ t('ai.q3') }}</div>
            <div class="seg qs" style="width: 180px">
              <div v-for="sp in (['mild', 'medium', 'hot'] as const)" :key="sp" :class="{ on: prefs.spice === sp }" @click="setPref('spice', sp)">{{ t('ai.spice.' + sp) }}</div>
            </div>
          </div>
          <div class="lrow q">
            <div class="ql"><b>4</b>{{ t('ai.qDiff') }}</div>
            <div class="seg qs" style="width: 180px">
              <div v-for="d in (['easy', 'medium', 'hard'] as const)" :key="d" :class="{ on: prefs.difficulty === d }" @click="setPref('difficulty', d)">{{ t('recipes.' + d) }}</div>
            </div>
          </div>
          <div class="lrow q" style="flex-direction: column; align-items: stretch; gap: 8px">
            <div class="ql"><b>5</b>{{ t('ai.qDiet') }}</div>
            <div class="chips">
              <button v-for="d in DIETS" :key="d" class="chip" :class="{ on: prefs.diet.includes(d) }" @click="toggleIn('diet', d)">{{ t('ai.diet.' + d) }}</button>
            </div>
          </div>
          <div class="lrow q" style="flex-direction: column; align-items: stretch; gap: 8px">
            <div class="ql"><b>6</b>{{ t('ai.qCuisine') }}</div>
            <div class="chips">
              <button v-for="c in CUISINES" :key="c" class="chip" :class="{ on: prefs.cuisines.includes(c) }" @click="toggleIn('cuisines', c)">{{ t('ai.cuisine.' + c) }}</button>
            </div>
          </div>
          <div class="lrow q" style="flex-direction: column; align-items: stretch; gap: 8px">
            <div class="ql"><b>7</b>{{ t('ai.qMood') }}</div>
            <div class="chips">
              <button v-for="m in MOODS" :key="m" class="chip" :class="{ on: prefs.mood === m }" @click="setPref('mood', prefs.mood === m ? null : m)">{{ t('ai.mood.' + m) }}</button>
            </div>
          </div>
          <div class="lrow q">
            <div class="ql"><b>8</b>{{ t('ai.qBudget') }}</div>
            <div class="field qbudget">
              <span class="muted">NZ$</span>
              <input type="number" inputmode="numeric" min="1" :value="prefs.budget ?? ''" :placeholder="t('ai.budgetPlaceholder')" @change="setBudget(($event.target as HTMLInputElement).value)" />
            </div>
          </div>
          <div class="lrow q" style="flex-direction: column; align-items: stretch; gap: 8px">
            <div class="ql"><b>9</b>{{ t('ai.q4') }}</div>
            <div class="field" style="height: 42px; font-size: 14px">
              <input :value="prefs.notes" :placeholder="t('ai.notesPlaceholder')" style="flex: 1" maxlength="80" @change="setPref('notes', ($event.target as HTMLInputElement).value.slice(0, 80))" />
            </div>
          </div>
        </div>
      </div>

      <div class="pad" style="margin-top: 18px">
        <button class="btn" :disabled="!anchors.length" :style="{ opacity: anchors.length ? 1 : 0.35 }" @click="goPage(2)">{{ t('ai.next') }}</button>
        <div v-if="!anchors.length" class="s muted" style="margin-top: 8px; text-align: center; font-size: 12.5px">{{ t('ai.pickOne') }}</div>
      </div>
    </template>

    <!-- ① 表單第 2 頁：家裡有哪些廚具（點了亮起；下面那排是已選的，也能在那裡取消） -->
    <template v-else>
      <div class="pad" style="margin-top: 6px">
        <button class="back" style="background: none; padding: 0" @click="goPage(1)">{{ t('ai.prev') }}</button>
      </div>
      <div class="pad" style="margin-top: 8px">
        <span class="tag low">{{ t('ai.badge') }}</span>
        <div class="h1" style="margin-top: 8px">{{ t('ai.kitTitle') }}</div>
        <div class="sub" style="margin-top: 8px">{{ t('ai.kitSub') }}</div>
      </div>
      <div class="pad" style="margin-top: 14px">
        <div class="kit">
          <button v-for="a in KITCHEN" :key="a.key" class="kcell" :class="{ on: prefs.appliances.includes(a.key) }" @click="toggleIn('appliances', a.key)">
            <span class="em">{{ a.emoji }}</span>
            <span>{{ t('recipes.appliance.' + a.key) }}</span>
          </button>
        </div>
        <div v-if="kitOn.length" class="chips" style="margin-top: 12px">
          <button v-for="a in kitOn" :key="a.key" class="chip on" @click="toggleIn('appliances', a.key)">{{ t('recipes.appliance.' + a.key) }} ×</button>
        </div>
        <div v-else class="note s" style="margin-top: 12px">{{ t('ai.kitNone') }}</div>
      </div>

      <div class="pad" style="margin-top: 18px">
        <RouterLink v-if="!isIn" class="btn ghost" to="/signin" style="font-size: 17px">{{ t('list.aiBtnSignIn') }}</RouterLink>
        <GradientButton v-else :disabled="!anchors.length" @click="generate">{{ t('ai.generate') }}</GradientButton>
        <div class="s muted" style="margin-top: 8px; text-align: center; font-size: 12.5px">
          {{ anchors.length ? t('ai.poolSub', { n: pool.length }) : t('ai.pickOne') }}
        </div>
        <div v-if="isIn && histCount >= HISTORY_MAX - 1" class="note s" style="margin-top: 10px; text-align: center">{{ t('ai.capWarn', { n: histCount, max: HISTORY_MAX }) }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.srow { width: 100%; text-align: left; background: var(--paper); color: inherit; }
.srow.off { opacity: 0.5; }
.nm { min-width: 0; font-size: 14px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.q { padding: 12px 12px; gap: 10px; }
.ql { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.ql b { width: 22px; height: 22px; border-radius: 50%; background: var(--ink); color: #fff; font-size: 12px; font-weight: 900; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.qs { width: 132px; flex: none; }
.qstep { height: 34px; padding: 0 6px; gap: 2px; }
.qstep button { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 16px; background: none; }
.qstep button:disabled { opacity: 0.3; }
.qnum { width: 34px; text-align: center; border: 0; background: none; font: inherit; font-weight: 800; font-size: 15px; padding: 0; -moz-appearance: textfield; }
.qnum::-webkit-outer-spin-button, .qnum::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.qunit { font-size: 13px; color: var(--ink-2); margin-right: 2px; }
.qs > div { padding: 8px 4px; font-size: 13.5px; }
.qbudget { width: 132px; height: 38px; padding: 0 10px; font-size: 14px; flex: none; }
.qbudget input { flex: 1; font-weight: 800; -moz-appearance: textfield; }
.qbudget input::-webkit-outer-spin-button, .qbudget input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
/* 廚具 9 格：沒選是灰的，點了亮起（emoji 上色、黑框、右上角 ✓） */
.kit { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.kcell { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; height: 96px; padding: 0 4px; border: 1.5px solid var(--line); border-radius: var(--r); background: var(--paper-2); color: var(--ink-3); font-size: 13.5px; font-weight: 700; text-align: center; line-height: 1.2; transition: transform 0.28s var(--ease), background-color 0.28s var(--ease), color 0.28s var(--ease), border-color 0.28s var(--ease); }
.kcell:active { transform: scale(0.97); }
.kcell .em { font-size: 32px; line-height: 1; filter: grayscale(1); opacity: 0.45; transition: filter 0.28s var(--ease), opacity 0.28s var(--ease); }
.kcell.on { background: var(--paper); border-color: var(--ink); color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
.kcell.on .em { filter: none; opacity: 1; }
.kcell.on::after { content: '✓'; position: absolute; top: 6px; right: 6px; width: 18px; height: 18px; border-radius: 50%; background: var(--ink); color: #fff; font-size: 11px; font-weight: 900; display: flex; align-items: center; justify-content: center; }
</style>
