<script setup lang="ts">
// 清單最下面「AI 食譜」進來：先選要用清單裡的哪些（食物預設全勾、飲料零食灰掉）、可以手打補食材、
// 選人份／時間／辣度、寫喜好，按「AI 食譜」才生成，最多 2 道。每道後端都存進「我的 → 食譜紀錄」。
import { computed, ref } from 'vue'
import { AiError, buildPool, fetchRecipes, isCookingCategory, loadPrefs, savePrefs, type AiRecipe, type Anchor, type Prefs } from '../lib/aiRecipe'
import AiRecipeCard from '../components/AiRecipeCard.vue'
import { useSpecials } from '../composables/useSpecials'
import { useList } from '../composables/useList'
import { useAuth } from '../composables/useAuth'
import { displayName } from '../lib/format'
import { lang, t } from '../composables/useI18n'

const MAX_ANCHORS = 10
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
const full = computed(() => sel.value.size + extras.value.length >= MAX_ANCHORS)

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

const anchors = computed<Anchor[]>(() => [
  ...rows.value.filter((r) => sel.value.has(r.id)).map((r) => (r.key && groups.value.has(r.key) ? { id: r.key, name: r.name } : { id: `free:${r.name}`, name: r.name })),
  ...extras.value.map((n) => ({ id: `free:${n}`, name: n })),
])
const pool = computed(() => buildPool(groups.value, new Set(anchors.value.map((a) => a.id))))

async function generate() {
  if (loading.value) return
  loading.value = true
  error.value = null
  asked.value = true
  open.value = null
  try {
    recipes.value = await fetchRecipes(anchors.value, pool.value, prefs.value, lang.value)
    if (recipes.value.length === 1) open.value = 0
  } catch (e) {
    error.value = e instanceof AiError ? e.code : 'failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px">
      <RouterLink class="back" to="/list">{{ t('ai.backList') }}</RouterLink>
    </div>
    <div class="pad" style="margin-top: 8px">
      <span class="tag low">{{ t('ai.badge') }}</span>
      <div class="h1" style="margin-top: 8px">{{ t('ai.title') }}</div>
      <div class="sub" style="margin-top: 8px">{{ t('ai.pickSub') }}</div>
    </div>

    <!-- ① 清單裡的東西 -->
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

    <!-- ② 手打補食材 -->
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

    <!-- ③ 偏好 -->
    <div class="pad chips" style="margin-top: 14px">
      <button v-for="n in [2, 4]" :key="'s' + n" class="chip" :class="{ on: prefs.serves === n }" @click="setPref('serves', n)">{{ t('ai.serves', { n }) }}</button>
      <button v-for="m in [20, 40]" :key="'m' + m" class="chip" :class="{ on: prefs.maxMinutes === m }" @click="setPref('maxMinutes', m)">{{ t('ai.under', { m }) }}</button>
      <button v-for="sp in (['mild', 'medium', 'hot'] as const)" :key="sp" class="chip" :class="{ on: prefs.spice === sp }" @click="setPref('spice', sp)">{{ t('ai.spice.' + sp) }}</button>
    </div>
    <div class="pad" style="margin-top: 10px">
      <div class="field" style="height: 44px">
        <input :value="prefs.notes" :placeholder="t('ai.notesPlaceholder')" style="flex: 1" maxlength="80" @change="setPref('notes', ($event.target as HTMLInputElement).value.slice(0, 80))" />
      </div>
    </div>

    <!-- ④ 按了才生成 -->
    <div class="pad" style="margin-top: 16px">
      <RouterLink v-if="!isIn" class="btn ghost" to="/signin" style="font-size: 17px">{{ t('list.aiBtnSignIn') }}</RouterLink>
      <button v-else class="btn" style="font-size: 17px" :disabled="loading || !anchors.length" :style="{ opacity: anchors.length ? 1 : 0.45 }" @click="generate">
        {{ loading ? t('ai.thinking') : asked ? t('ai.regenerate') : t('ai.generate') }}
      </button>
      <div class="s muted" style="margin-top: 8px; text-align: center; font-size: 12.5px">
        {{ anchors.length ? t('ai.poolSub', { n: pool.length }) : t('ai.pickOne') }}
      </div>
    </div>

    <div v-if="loading" class="pad" style="margin-top: 14px">
      <div v-for="i in 2" :key="i" class="skel" style="height: 92px; margin-top: 10px" />
    </div>

    <div v-else-if="error" class="pad" style="margin-top: 14px">
      <div class="empty sub">
        {{ error === 'quota' ? t('ai.quota') : error === 'signIn' ? t('ai.needSignIn') : error === 'few' ? t('ai.few') : t('ai.failed') }}
        <div v-if="error === 'signIn' || (error === 'few' && !pool.length)" style="margin-top: 12px">
          <RouterLink class="btn ghost" :to="error === 'signIn' ? '/signin' : '/stores'" style="height: 42px; font-size: 15px">{{ error === 'signIn' ? t('common.signIn') : t('stores.title') }}</RouterLink>
        </div>
      </div>
    </div>

    <template v-else-if="asked">
      <div v-if="!recipes.length" class="pad" style="margin-top: 14px">
        <div class="empty sub">{{ t('ai.none') }}</div>
      </div>
      <div v-for="(r, i) in recipes" :key="r.dbId ?? i" class="pad" style="margin-top: 10px">
        <AiRecipeCard :recipe="r" :open="open === i" @toggle="open = open === i ? null : i" />
      </div>
      <div v-if="recipes.length" class="pad" style="margin-top: 12px">
        <RouterLink v-if="recipes[0].dbId" class="s" to="/me/recipes" style="color: var(--ink-2); text-decoration: underline">{{ t('ai.savedNote') }}</RouterLink>
        <div class="s muted" style="margin-top: 10px; font-size: 12px; line-height: 1.45">{{ t('ai.disclaimer') }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.srow { width: 100%; text-align: left; background: var(--paper); color: inherit; }
.srow.off { opacity: 0.5; }
.nm { min-width: 0; font-size: 14px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
