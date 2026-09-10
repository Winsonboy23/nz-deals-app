<script setup lang="ts">
// 後台「每週報告 + 重跑」（docs/admin-spec.md §2.2）：crawl_runs / crawl_stores 列表，三顆按鈕都是插一張 admin_jobs。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { useStores } from '../../composables/useStores'

const { all } = useStores()
const storeName = computed(() => new Map(all.value.map((s) => [s.id, s.name])))
const err = ref('')

interface Run {
  id: string
  kind: string
  started_at: string | null
  ms: number | null
  stores_ok: number | null
  stores_failed: number | null
  rows: number | null
  needs_review: number | null
  added?: number | null
  changed?: number | null
  removed?: number | null
  requests: number | null
  report: any
}
interface RunStore {
  store_id: string
  ok: boolean
  items: number | null
  rows: number | null
  needs_review: number | null
  added?: number | null
  changed?: number | null
  removed?: number | null
  requests: number | null
  ms: number | null
  error: string | null
}
interface Job {
  id: string
  kind: string
  payload: any
  status: string
  log: string | null
  created_at: string
  done_at: string | null
}

const runs = ref<Run[]>([])
const runsLoading = ref(true)
const openId = ref('')
const runStores = ref<Record<string, RunStore[]>>({})
const picked = ref<Set<string>>(new Set())
const jobs = ref<Job[]>([])

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '—')
const fmtMs = (ms: number | null) => (ms == null ? '—' : ms < 60000 ? `${Math.round(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`)
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-NZ'))

async function loadRuns() {
  const { data, error } = await supabase.from('crawl_runs').select('*').order('started_at', { ascending: false }).limit(20)
  if (error) err.value = error.message
  runs.value = (data ?? []) as Run[]
  runsLoading.value = false
}
async function toggleRun(r: Run) {
  if (openId.value === r.id) {
    openId.value = ''
    return
  }
  openId.value = r.id
  if (runStores.value[r.id]) return
  const { data, error } = await supabase.from('crawl_stores').select('*').eq('run_id', r.id).order('ok')
  if (error) err.value = error.message
  runStores.value = { ...runStores.value, [r.id]: (data ?? []) as RunStore[] }
}
function pick(storeId: string) {
  const next = new Set(picked.value)
  if (next.has(storeId)) next.delete(storeId)
  else next.add(storeId)
  picked.value = next
}

async function loadJobs() {
  const { data, error } = await supabase.from('admin_jobs').select('*').order('created_at', { ascending: false }).limit(20)
  if (error) err.value = error.message
  jobs.value = (data ?? []) as Job[]
}
async function addJobs(rows: { kind: string; payload?: any }[]) {
  if (!rows.length) return
  const { error } = await supabase.from('admin_jobs').insert(rows)
  if (error) {
    err.value = error.message
    return
  }
  await loadJobs()
}
async function refetchPicked() {
  await addJobs([...picked.value].map((store_id) => ({ kind: 'refetch_store', payload: { store_id } })))
  picked.value = new Set()
}

let timer = 0
onMounted(() => {
  void loadRuns()
  void loadJobs()
  timer = window.setInterval(loadJobs, 10000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div>
    <div v-if="err" class="note" style="margin-bottom: 12px; color: #b00020">{{ err }}</div>

    <div class="chips" style="margin-bottom: 14px">
      <button class="chip" :class="{ on: picked.size }" :disabled="!picked.size" @click="refetchPicked">
        重跑勾選的失敗店（{{ picked.size }}）
      </button>
      <button class="chip" @click="addJobs([{ kind: 'prices' }])">重新查價</button>
      <button class="chip" @click="addJobs([{ kind: 'notify_test' }])">發測試推播</button>
    </div>

    <div class="sec" style="margin-bottom: 8px">每週抓取報告</div>
    <div v-if="runsLoading" class="sub muted">載入中…</div>
    <div v-else-if="!runs.length" class="empty"><div class="h3">還沒有跑過</div></div>
    <div v-for="r in runs" :key="r.id" class="box" style="margin-bottom: 8px">
      <button class="lrow tap" style="padding: 12px 14px" @click="toggleRun(r)">
        <div class="grow">
          <div class="t">{{ fmtTime(r.started_at) }} · {{ r.kind }}</div>
          <div class="s">
            成功 {{ num(r.stores_ok) }} 店 · 失敗 {{ num(r.stores_failed) }} · {{ num(r.rows) }} 筆 ·
            needs_review {{ num(r.needs_review) }} · {{ num(r.requests) }} 請求 · {{ fmtMs(r.ms) }}
          </div>
        </div>
        <div class="link">{{ openId === r.id ? '▾' : '▸' }}</div>
      </button>

      <template v-if="openId === r.id">
        <div v-if="(r.report?.unmappedCategories ?? []).length" class="lrow" style="display: block; padding: 10px 14px">
          <div class="sec">對不到的分類路徑</div>
          <div v-for="u in r.report.unmappedCategories" :key="u.chain + u.path" class="s">
            {{ u.chain }} · {{ u.path }} — {{ u.rows }} 筆 / {{ u.stores }} 店
          </div>
        </div>
        <div v-for="s in runStores[r.id] ?? []" :key="s.store_id" class="lrow" style="padding: 8px 14px">
          <button v-if="!s.ok" class="cb" :class="{ on: picked.has(s.store_id) }" style="width: 22px; height: 22px; border-radius: 6px; font-size: 12px" @click="pick(s.store_id)">✓</button>
          <div v-else style="width: 22px; flex: none" />
          <div class="grow">
            <div class="t" :style="s.ok ? '' : 'color:#B00020'">{{ storeName.get(s.store_id) ?? s.store_id }}</div>
            <div class="s" :style="s.ok ? '' : 'color:#B00020'">
              <template v-if="s.ok">{{ num(s.rows) }} 筆<template v-if="s.added != null">（新 {{ num(s.added) }} · 改價 {{ num(s.changed ?? null) }} · 下架 {{ num(s.removed ?? null) }}）</template> · needs_review {{ num(s.needs_review) }} · {{ num(s.requests) }} 請求 · {{ fmtMs(s.ms) }}</template>
              <template v-else>{{ s.error }}</template>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="sec" style="margin: 22px 0 8px">最近的派工單（每 10 秒自動更新）</div>
    <div v-if="!jobs.length" class="sub muted">還沒派過工。</div>
    <div v-else class="box">
      <div v-for="j in jobs" :key="j.id" class="lrow" style="padding: 10px 14px">
        <div class="grow">
          <div class="t">
            {{ j.kind }}
            <span v-if="j.payload?.store_id" class="muted" style="font-weight: 400">· {{ storeName.get(j.payload.store_id) ?? j.payload.store_id }}</span>
            <span v-else-if="j.payload?.dict_key" class="muted" style="font-weight: 400">· {{ j.payload.dict_key }} · {{ j.payload.same ? '一樣' : '都不一樣' }}</span>
          </div>
          <div class="s">{{ fmtTime(j.created_at) }}<template v-if="j.log"> · {{ j.log }}</template></div>
        </div>
        <span class="tag" :class="j.status === 'failed' ? 'club' : j.status === 'done' ? 'half' : 'low'" style="flex: none">{{ j.status }}</span>
      </div>
    </div>
  </div>
</template>
