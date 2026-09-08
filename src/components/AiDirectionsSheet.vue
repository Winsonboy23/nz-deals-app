<script setup lang="ts">
// 第一層：選好食材後問 GPT「可以做什麼方向」，回 4 張卡。點一張進第二層。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AiError, fetchDirections, loadPrefs, savePrefs, type Direction, type Prefs } from '../lib/aiRecipe'
import { lang, t } from '../composables/useI18n'

const props = defineProps<{ items: string[] }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()

const prefs = ref<Prefs>(loadPrefs())
const dirs = ref<Direction[]>([])
const loading = ref(false)
const error = ref<'quota' | 'failed' | null>(null)
const zh = computed(() => lang.value === 'zh')

async function load(fresh = false) {
  loading.value = true
  error.value = null
  try {
    dirs.value = await fetchDirections(props.items, prefs.value, fresh)
  } catch (e) {
    error.value = e instanceof AiError && e.code === 'quota' ? 'quota' : 'failed'
  } finally {
    loading.value = false
  }
}
onMounted(() => load())

function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs.value = { ...prefs.value, [k]: v }
  savePrefs(prefs.value)
  void load()
}

function pick(d: Direction) {
  // 方向存在 sessionStorage，網址只帶菜名，重整不會壞。
  try {
    sessionStorage.setItem('ai:direction', JSON.stringify({ direction: d, items: props.items, prefs: prefs.value }))
  } catch {
    /* 隱私模式 */
  }
  emit('close')
  void router.push(`/ai-recipe/${encodeURIComponent(d.dish_en)}`)
}
</script>

<template>
  <div class="dim" @click="emit('close')" />
  <div class="bsheet ai-sheet">
    <div class="grab" />
    <div class="hrow">
      <div class="h2">{{ t('ai.dirTitle') }}</div>
      <button class="link" @click="emit('close')">{{ t('common.done') }}</button>
    </div>
    <div class="s muted" style="margin-top: 4px; font-size: 12.5px">
      {{ t('ai.dirSub', { n: items.length }) }}
    </div>

    <div class="chips" style="margin-top: 12px">
      <button v-for="n in [2, 4]" :key="'s' + n" class="chip" :class="{ on: prefs.serves === n }" @click="setPref('serves', n)">
        {{ t('ai.serves', { n }) }}
      </button>
      <button v-for="m in [20, 40]" :key="'m' + m" class="chip" :class="{ on: prefs.maxMinutes === m }" @click="setPref('maxMinutes', m)">
        {{ t('ai.under', { m }) }}
      </button>
      <button
        v-for="sp in (['mild', 'medium', 'hot'] as const)"
        :key="sp"
        class="chip"
        :class="{ on: prefs.spice === sp }"
        @click="setPref('spice', sp)"
      >
        {{ t('ai.spice.' + sp) }}
      </button>
    </div>
    <div class="field" style="margin-top: 10px; height: 44px">
      <input
        :value="prefs.avoid"
        :placeholder="t('ai.avoidPlaceholder')"
        style="flex: 1"
        @change="setPref('avoid', ($event.target as HTMLInputElement).value.slice(0, 60))"
      />
    </div>

    <div v-if="loading" style="margin-top: 14px">
      <div v-for="i in 4" :key="i" class="skel" style="height: 72px; margin-top: 8px" />
      <div class="s muted" style="margin-top: 10px; text-align: center">{{ t('ai.thinking') }}</div>
    </div>

    <div v-else-if="error" class="empty sub" style="margin-top: 14px">
      {{ error === 'quota' ? t('ai.quota') : t('ai.failed') }}
      <div v-if="error !== 'quota'" style="margin-top: 10px">
        <button class="btn ghost" style="height: 42px; font-size: 15px" @click="load(true)">{{ t('ai.retry') }}</button>
      </div>
    </div>

    <template v-else>
      <button v-for="d in dirs" :key="d.dish_en" class="dcard" @click="pick(d)">
        <div class="hrow">
          <span class="tag low">{{ zh ? d.cuisine_zh : d.cuisine_en }}</span>
          <span class="s muted" style="font-size: 12px">{{ d.minutes }} min</span>
        </div>
        <div class="h3" style="margin-top: 6px">{{ zh ? d.dish_zh : d.dish_en }}</div>
        <div class="s" style="margin-top: 3px">{{ zh ? d.why_zh : d.why_en }}</div>
        <div class="s muted" style="margin-top: 5px; font-size: 12px">
          {{ t('ai.uses', { n: d.uses.length, m: items.length }) }}
          <template v-if="d.missing_en.length"> · {{ t('ai.missing', { s: d.missing_en.join(', ') }) }}</template>
        </div>
      </button>
      <button class="btn ghost" style="height: 46px; font-size: 15px; margin-top: 12px" @click="load(true)">
        {{ t('ai.another') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.ai-sheet {
  max-height: 88vh;
  overflow-y: auto;
  padding-bottom: calc(26px + env(safe-area-inset-bottom));
}
.dcard {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 11px 13px;
  margin-top: 9px;
  background: var(--paper);
}
.dcard:active {
  transform: scale(0.985);
}
</style>
