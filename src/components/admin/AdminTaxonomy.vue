<script setup lang="ts">
// 後台「分類」（docs/admin-spec.md §2.4）：
//  上半 — 最新一次抓取對不到的 Woolworths 分類路徑，選一個 Foodstuffs 分類存進 taxonomy_map；「回填本週」插一張 recat_week 派工單。
//  下半 — 分類中文（taxonomy_zh）兩欄可改，失焦就存。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { useCategories } from '../../composables/useCategories'
import type { Category } from '../../lib/types'

const { byId, loadCategories } = useCategories()
const err = ref('')
const today = new Date().toISOString().slice(0, 10)

/* ---------- 下拉用的 Foodstuffs 路徑（只列第二、三層） ---------- */
const fsPaths = computed(() => {
  const out: string[] = []
  for (const c of Object.values(byId.value) as Category[]) {
    if (c.level < 2) continue
    const parts: string[] = []
    let cur: Category | undefined = c
    while (cur) {
      parts.unshift(cur.name)
      cur = cur.parent_id ? (byId.value[cur.parent_id] as Category | undefined) : undefined
    }
    out.push(parts.join(' > '))
  }
  return out.sort()
})
const fsSet = computed(() => new Set(fsPaths.value))

/* ---------- 對不到的路徑 ---------- */
interface Un {
  chain: string
  path: string
  rows: number
  stores: number
}
const unmapped = ref<Un[]>([])
const runAt = ref('')
const pick = ref<Record<string, string>>({})
const done = ref<Record<string, boolean>>({})
const rowKey = (u: Un) => `${u.chain}|${u.path}`

async function loadUnmapped() {
  const { data, error } = await supabase.from('crawl_runs').select('started_at,report').order('started_at', { ascending: false }).limit(1)
  if (error) {
    err.value = error.message
    return
  }
  const run = (data ?? [])[0] as { started_at: string; report: any } | undefined
  runAt.value = run?.started_at ?? ''
  unmapped.value = ((run?.report?.unmappedCategories ?? []) as Un[]).slice()
}

async function saveMap(u: Un) {
  const fs = (pick.value[rowKey(u)] ?? '').trim()
  if (!fsSet.value.has(fs)) {
    err.value = `找不到分類「${fs}」，要從下拉選一個現成的路徑`
    return
  }
  err.value = ''
  const level = u.path.split('>').length >= 3 ? 3 : 2
  const { error } = await supabase.from('taxonomy_map').upsert(
    { level, ww_path: u.path, fs_path: fs, status: 'manual', note: `後台 ${today}`, updated_at: new Date().toISOString() },
    { onConflict: 'level,ww_path' },
  )
  if (error) {
    err.value = error.message
    return
  }
  done.value = { ...done.value, [rowKey(u)]: true }
  void loadManual()
}

/* ---------- 已經手動對過的 ---------- */
interface MapRow {
  level: number
  ww_path: string
  fs_path: string | null
  note: string | null
  updated_at: string
}
const manual = ref<MapRow[]>([])
async function loadManual() {
  const { data, error } = await supabase
    .from('taxonomy_map')
    .select('level,ww_path,fs_path,note,updated_at')
    .eq('status', 'manual')
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) err.value = error.message
  manual.value = (data ?? []) as MapRow[]
}

/* ---------- 回填本週（recat_week 派工單） ---------- */
interface Job {
  id: string
  kind: string
  status: string
  log: string | null
  created_at: string
}
const jobs = ref<Job[]>([])
async function loadJobs() {
  const { data } = await supabase
    .from('admin_jobs')
    .select('id,kind,status,log,created_at')
    .eq('kind', 'recat_week')
    .order('created_at', { ascending: false })
    .limit(5)
  jobs.value = (data ?? []) as Job[]
}
async function recat() {
  const { error } = await supabase.from('admin_jobs').insert({ kind: 'recat_week', payload: {} })
  if (error) {
    err.value = error.message
    return
  }
  await loadJobs()
}

/* ---------- 分類中文 ---------- */
interface ZhRow {
  name: string
  zh: string
}
const zh = ref<ZhRow[]>([])
const zhQuery = ref('')
const zhSaved = ref<Record<string, boolean>>({})
const zhShown = computed(() => {
  const q = zhQuery.value.trim().toLowerCase()
  if (!q) return zh.value
  return zh.value.filter((r) => r.name.toLowerCase().includes(q) || r.zh.includes(zhQuery.value.trim()))
})
async function loadZh() {
  const { data, error } = await supabase.from('taxonomy_zh').select('name,zh').order('name')
  if (error) err.value = error.message
  zh.value = (data ?? []) as ZhRow[]
}
async function saveZh(r: ZhRow, e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (!v || v === r.zh) return
  const { error } = await supabase.from('taxonomy_zh').update({ zh: v, updated_at: new Date().toISOString() }).eq('name', r.name)
  if (error) {
    err.value = error.message
    return
  }
  r.zh = v
  zhSaved.value = { ...zhSaved.value, [r.name]: true }
}

const fmtTime = (iso: string) => (iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '—')

let timer = 0
onMounted(() => {
  void loadCategories()
  void loadUnmapped()
  void loadManual()
  void loadJobs()
  void loadZh()
  timer = window.setInterval(loadJobs, 10000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div>
    <div v-if="err" class="note" style="margin-bottom: 12px; color: #b00020">{{ err }}</div>

    <!-- 對不到的分類路徑 -->
    <div class="hrow" style="margin-bottom: 8px">
      <div class="grow">
        <div class="sec">對不到的分類路徑</div>
        <div class="s muted">最新一次抓取（{{ fmtTime(runAt) }}）的 unmappedCategories。存好之後按「回填本週」把本週資料改過來。</div>
      </div>
      <button class="chip" @click="recat">回填本週</button>
    </div>
    <div v-if="!unmapped.length" class="empty" style="margin-bottom: 16px">
      <div class="h3">沒有對不到的路徑</div>
      <div class="s" style="margin-top: 4px">最新一次抓取每筆都對得到分類。</div>
    </div>
    <div v-else class="box" style="margin-bottom: 16px">
      <div v-for="u in unmapped" :key="rowKey(u)" class="lrow" style="padding: 10px 14px; flex-wrap: wrap">
        <div class="grow" style="min-width: 220px">
          <div class="t">{{ u.path }}</div>
          <div class="s muted">{{ u.chain }} · {{ u.rows }} 筆 / {{ u.stores }} 店</div>
        </div>
        <div class="field" style="height: 40px; font-size: 14px; width: 340px; flex: none">
          <input
            :value="pick[rowKey(u)] ?? ''"
            list="fs-paths"
            placeholder="打字過濾 Foodstuffs 分類…"
            style="flex: 1; min-width: 0"
            @change="pick = { ...pick, [rowKey(u)]: ($event.target as HTMLInputElement).value }"
          />
        </div>
        <button class="chip on" style="flex: none" @click="saveMap(u)">存</button>
        <span v-if="done[rowKey(u)]" class="tag half" style="flex: none">已對</span>
      </div>
    </div>
    <datalist id="fs-paths">
      <option v-for="p in fsPaths" :key="p" :value="p" />
    </datalist>

    <div v-if="jobs.length" class="box" style="margin-bottom: 22px">
      <div v-for="j in jobs" :key="j.id" class="lrow" style="padding: 10px 14px">
        <div class="grow">
          <div class="t">回填本週</div>
          <div class="s">{{ fmtTime(j.created_at) }}<template v-if="j.log"> · {{ j.log }}</template></div>
        </div>
        <span class="tag" :class="j.status === 'failed' ? 'club' : j.status === 'done' ? 'half' : 'low'" style="flex: none">{{ j.status }}</span>
      </div>
    </div>

    <!-- 手動對過的 -->
    <div class="sec" style="margin-bottom: 8px">手動對過的（{{ manual.length }}）</div>
    <div v-if="!manual.length" class="sub muted" style="margin-bottom: 22px">還沒有。</div>
    <div v-else class="box" style="margin-bottom: 22px; max-height: 300px; overflow: auto">
      <div v-for="m in manual" :key="m.level + m.ww_path" class="lrow" style="padding: 8px 14px">
        <div class="grow">
          <div class="t">{{ m.ww_path }}</div>
          <div class="s muted">→ {{ m.fs_path ?? '（對不到）' }} · L{{ m.level }}<template v-if="m.note"> · {{ m.note }}</template></div>
        </div>
        <div class="s muted" style="flex: none">{{ fmtTime(m.updated_at) }}</div>
      </div>
    </div>

    <!-- 分類中文 -->
    <div class="hrow" style="margin-bottom: 8px">
      <div class="grow">
        <div class="sec">分類中文（{{ zh.length }}）</div>
        <div class="s muted">改完點別的地方就存。App 下次開就看得到。</div>
      </div>
      <div class="field" style="height: 40px; font-size: 14px; width: 220px; flex: none">
        <input v-model="zhQuery" placeholder="搜英文或中文…" style="flex: 1; min-width: 0" />
      </div>
    </div>
    <div class="box" style="max-height: 520px; overflow: auto">
      <div v-for="r in zhShown" :key="r.name" class="lrow" style="padding: 6px 14px">
        <div class="grow t" style="font-weight: 600">{{ r.name }}</div>
        <div class="field" style="height: 36px; font-size: 14px; width: 220px; flex: none">
          <input :value="r.zh" style="flex: 1; min-width: 0" @change="saveZh(r, $event)" />
        </div>
        <span class="s muted" style="width: 34px; flex: none">{{ zhSaved[r.name] ? '已存' : '' }}</span>
      </div>
    </div>
  </div>
</template>
