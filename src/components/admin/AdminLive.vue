<script setup lang="ts">
// 後台「即時查價現況」（docs/admin-spec.md §2.3）：查價單、名字配對統計、Mac mini 心跳。每 30 秒重讀。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { useStores } from '../../composables/useStores'
import { nzMonday, nzToday } from '../../lib/week'

const { all } = useStores()
const storeName = computed(() => new Map(all.value.map((s) => [s.id, s.name])))
const err = ref('')

interface Req {
  id: string
  store_id: string
  product_ids: string[] | null
  product_keys: string[] | null
  status: string
  error: string | null
  created_at: string
  done_at: string | null
}
interface Health {
  at: string
  load: number | null
  top: Array<{ cpu: number; name: string }> | null
  chrome: number | null
  orphan: number | null
  mem_free_mb: number | null
}
const reqs = ref<Req[]>([])
const counts = ref<Record<string, number>>({})
const beat = ref<{ at: string; info: any } | null>(null)
const health = ref<Health[]>([])
const now = ref(Date.now())

const nzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' })
const nzDay = (iso: string) => nzFmt.format(new Date(iso))
const today = computed(() => reqs.value.filter((r) => nzDay(r.created_at) === nzToday()))
const week = computed(() => reqs.value.filter((r) => nzMonday(nzDay(r.created_at)) === nzMonday()))

function stat(rows: Req[]) {
  const done = rows.filter((r) => r.status === 'done')
  const secs = done
    .map((r) => (r.done_at ? (new Date(r.done_at).getTime() - new Date(r.created_at).getTime()) / 1000 : null))
    .filter((n): n is number => n != null)
  return {
    total: rows.length,
    done: done.length,
    failed: rows.filter((r) => r.status === 'failed').length,
    pending: rows.filter((r) => r.status === 'pending' || r.status === 'running').length,
    avg: secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length : null,
  }
}
const summary = computed(() => [
  { label: '今天', s: stat(today.value) },
  { label: '本週', s: stat(week.value) },
])

/** 後台把即時查價關掉時，worker 的心跳會帶 paused。 */
const paused = computed(() => !!beat.value?.info?.paused)

/** Mac mini 健康（ops/health.sh 每 10 分鐘一列）：最新一列 + 24 小時負載折線。 */
const latest = computed<Health | null>(() => health.value[0] ?? null)
const loadLine = computed(() => {
  const pts = health.value.map((h) => Number(h.load ?? 0)).reverse()
  if (pts.length < 2) return ''
  const max = Math.max(4, ...pts)
  return pts.map((v, i) => `${(i / (pts.length - 1)) * 300},${60 - (v / max) * 56}`).join(' ')
})
const loadMax = computed(() => Math.max(4, ...health.value.map((h) => Number(h.load ?? 0))))

/** 超過 5 分鐘沒回報就是紅的（§2.3）。 */
const beatMins = computed(() => (beat.value ? Math.floor((now.value - new Date(beat.value.at).getTime()) / 60000) : null))
const beatDead = computed(() => beatMins.value == null || beatMins.value >= 5)

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-TW', { hour12: false })

async function load() {
  now.value = Date.now()
  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const [{ data: rows, error }, { data: hb }, { data: hl }] = await Promise.all([
    supabase.from('price_requests').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
    supabase.from('heartbeats').select('at,info').eq('name', 'price-worker').limit(1),
    supabase.from('health').select('at,load,top,chrome,orphan,mem_free_mb').order('at', { ascending: false }).limit(144),
  ])
  if (error) err.value = error.message
  reqs.value = (rows ?? []) as Req[]
  beat.value = ((hb ?? [])[0] as any) ?? null
  health.value = (hl ?? []) as Health[]
  const got: Record<string, number> = {}
  for (const s of ['matched', 'review', 'none']) {
    const { count } = await supabase.from('name_matches').select('*', { count: 'exact', head: true }).eq('status', s)
    got[s] = count ?? 0
  }
  counts.value = got
}

let timer = 0
onMounted(() => {
  void load()
  timer = window.setInterval(load, 30000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div>
    <div v-if="err" class="note" style="margin-bottom: 12px; color: #b00020">{{ err }}</div>

    <!-- Mac mini 心跳 -->
    <div class="box" style="margin-bottom: 16px">
      <div class="lrow" style="padding: 14px">
        <span class="dot" :style="{ background: beatDead ? '#B00020' : 'var(--ww)', width: '12px', height: '12px' }" />
        <div class="grow">
          <div class="t" :style="beatDead ? 'color:#B00020' : ''">
            Mac mini · price-worker
            <template v-if="beatMins == null">沒回報</template>
            <template v-else-if="beatDead">{{ beatMins }} 分鐘沒回報</template>
            <template v-else>{{ beatMins }} 分鐘前有回報</template>
            <span v-if="paused" class="tag club" style="margin-left: 6px">已暫停（後台開關）</span>
          </div>
          <div class="s">
            瀏覽器 {{ beat?.info?.browsers ?? '—' }} 個 · 排隊 {{ beat?.info?.pending ?? '—' }} 張 ·
            {{ beat?.info?.host ?? '—' }} · 版本 {{ beat?.info?.version ?? '—' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Mac mini 健康（health 表，每 10 分鐘一列） -->
    <div class="sec" style="margin-bottom: 8px">Mac mini 健康</div>
    <div class="box" style="margin-bottom: 16px">
      <div v-if="!latest" class="lrow" style="padding: 12px 14px"><div class="s muted">還沒有記錄。</div></div>
      <template v-else>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">負載 {{ latest.load ?? '—' }} · 記憶體剩 {{ latest.mem_free_mb ?? '—' }} MB · Chrome {{ latest.chrome ?? '—' }} 個（孤兒 {{ latest.orphan ?? '—' }}）</div>
            <div class="s muted">{{ fmtTime(latest.at) }} · 最忙：{{ (latest.top ?? []).map((t) => `${t.name.slice(0, 28)} ${t.cpu}%`).join('、') || '—' }}</div>
          </div>
        </div>
        <div v-if="loadLine" class="lrow" style="padding: 12px 14px; display: block">
          <div class="sec">負載（最近 {{ health.length }} 筆，約 24 小時；上緣 {{ loadMax.toFixed(1) }}）</div>
          <svg viewBox="0 0 300 60" preserveAspectRatio="none" style="width: 100%; height: 60px; margin-top: 6px">
            <polyline :points="loadLine" fill="none" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
          </svg>
        </div>
      </template>
    </div>

    <!-- 查價單 -->
    <div class="sec" style="margin-bottom: 8px">即時查價單</div>
    <div class="box" style="margin-bottom: 16px">
      <div v-for="r in summary" :key="r.label" class="lrow" style="padding: 12px 14px">
        <div class="grow">
          <div class="t">{{ r.label }} {{ r.s.total }} 張</div>
          <div class="s">
            完成 {{ r.s.done }} · 失敗 {{ r.s.failed }} · 排隊中 {{ r.s.pending }} ·
            平均 {{ r.s.avg == null ? '—' : r.s.avg.toFixed(1) + ' 秒' }}
          </div>
        </div>
      </div>
    </div>
    <div class="sub muted" style="margin-bottom: 8px">
      註：worker 每小時會把一天前做完／失敗的單刪掉，所以「本週」通常只看得到最近一天。
    </div>

    <div class="sec" style="margin-bottom: 8px">最近 20 張</div>
    <div v-if="!reqs.length" class="sub muted">沒有單。</div>
    <div v-else class="box" style="margin-bottom: 16px">
      <div v-for="r in reqs.slice(0, 20)" :key="r.id" class="lrow" style="padding: 10px 14px">
        <div class="grow">
          <div class="t">{{ storeName.get(r.store_id) ?? r.store_id }}</div>
          <div class="s">
            {{ (r.product_ids ?? []).length }} 個編號<template v-if="(r.product_keys ?? []).length">
              · {{ (r.product_keys ?? []).length }} 個要配對</template>
            · {{ fmtTime(r.created_at) }}
            <template v-if="r.error"> · <span style="color: #b00020">{{ r.error }}</span></template>
          </div>
        </div>
        <span class="tag" :class="r.status === 'failed' ? 'club' : r.status === 'done' ? 'half' : 'low'" style="flex: none">{{ r.status }}</span>
      </div>
    </div>

    <!-- 名字配對統計 -->
    <div class="sec" style="margin-bottom: 8px">名字配對</div>
    <div class="box">
      <div class="lrow" style="padding: 12px 14px">
        <div class="grow">
          <div class="t">配上 {{ counts.matched ?? 0 }} · 待審 {{ counts.review ?? 0 }} · 沒有 {{ counts.none ?? 0 }}</div>
          <div class="s">待審的在「待審 → 名字配對」那頁點。</div>
        </div>
      </div>
    </div>
  </div>
</template>
