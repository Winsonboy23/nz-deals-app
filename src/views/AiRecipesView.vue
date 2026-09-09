<script setup lang="ts">
// 清單最下面「AI 食譜」進來。兩段：
// ① 表單：清單裡的東西一列列可勾（食物預設全勾、飲料零食灰掉）、手打補食材、問卷（人份／時間／辣度／喜好）、「AI 食譜」按了才生成
// ② 結果：只顯示食譜（最多 2 道）、「再想 2 道」；返回回到表單。用網址 ?r=1 記段落，手機返回鍵也會回表單。
// 每道後端都存進「我的 → 食譜紀錄」。
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AiError, HISTORY_MAX, buildPool, fetchRecipes, historyCount, isCookingCategory, loadPrefs, savePrefs, type AiRecipe, type Anchor, type Prefs } from '../lib/aiRecipe'
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

/** 清單每一項：食物（可勾）或不算食材（灰掉）。清單裡沒對到特價的、手打的一律算食物。 */
const rows = computed(() =>
  items.value.map((i) => {
    const g = i.key ? groups.value.get(i.key) : undefined
    return { id: i.id, key: i.key, name: g ? displayName(g.best.special) : i.name, food: !g || isCookingCategory(g.best.special.category_id) }
  }),
)
const sel = ref<Set<string>>(new Set(rows.value.filter((r) => r.food).slice(0, MAX_ANCHORS).map((r) => r.id)))
const extras = ref<string[]>([])
const draft = ref('')
const prefs = ref<Prefs>(loadPrefs())
const recipes = ref<AiRecipe[]>([])
const asked = ref(false)
const loading = ref(false)
const error = ref<'quota' | 'signIn' | 'few' | 'failed' | null>(null)
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

const anchors = computed<Anchor[]>(() => [
  ...rows.value.filter((r) => sel.value.has(r.id)).map((r) => (r.key && groups.value.has(r.key) ? { id: r.key, name: r.name } : { id: `free:${r.name}`, name: r.name })),
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
          {{ error === 'quota' ? t('ai.quota') : error === 'signIn' ? t('ai.needSignIn') : error === 'few' ? t('ai.few') : t('ai.failed') }}
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

    <!-- ① 表單 -->
    <template v-else>
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
            <div class="ql"><b>5</b>{{ t('ai.q4') }}</div>
            <div class="field" style="height: 42px; font-size: 14px">
              <input :value="prefs.notes" :placeholder="t('ai.notesPlaceholder')" style="flex: 1" maxlength="80" @change="setPref('notes', ($event.target as HTMLInputElement).value.slice(0, 80))" />
            </div>
          </div>
        </div>
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
</style>
