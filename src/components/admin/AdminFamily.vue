<script setup lang="ts">
// 後台「同類」待審（docs/admin-spec.md §2.1 第三列）：
//  ① GPT 沒把握的（family_dict.confidence < 0.6）
//  ② 一個同類塞太多樣的（≥ 30 樣，可能混到不同東西）
// 改了寫回 family_dict（source manual、confidence 1），再插一張 family_apply 派工單把 products 三欄跟著改。
// 這頁只求能用。
import { onMounted, onUnmounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'

const err = ref('')
const BIG = 30

interface FRow {
  product_key: string
  family_key: string
  name_en: string | null
  name_zh: string | null
  confidence: number | null
  cat2: string | null
}
const COLS = 'product_key,family_key,name_en,name_zh,confidence,cat2'

/** product_key → products.display_name */
const names = ref<Map<string, string>>(new Map())
async function loadNames(keys: string[]) {
  const need = keys.filter((k) => !names.value.has(k))
  if (!need.length) return
  const next = new Map(names.value)
  for (let i = 0; i < need.length; i += 100) {
    const { data } = await supabase.from('products').select('key,display_name').in('key', need.slice(i, i + 100))
    for (const p of (data ?? []) as Array<{ key: string; display_name: string }>) next.set(p.key, p.display_name)
  }
  names.value = next
}
const nameOf = (k: string) => names.value.get(k) ?? k.replace(/_/g, ' ')

/* ---------- ① 沒把握的 ---------- */
const low = ref<FRow[]>([])
const lowLoading = ref(true)
async function loadLow() {
  const { data, error } = await supabase.from('family_dict').select(COLS).lt('confidence', 0.6).order('confidence').limit(200)
  if (error) err.value = error.message
  low.value = (data ?? []) as FRow[]
  lowLoading.value = false
  await loadNames(low.value.map((r) => r.product_key))
}

/* ---------- ② 塞太多樣的：整表讀 family_key 在前端算 ---------- */
const big = ref<Array<{ family_key: string; n: number }>>([])
const bigLoading = ref(true)
async function loadBig() {
  const count = new Map<string, number>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('family_dict').select('family_key').range(from, from + 999)
    if (error) {
      err.value = error.message
      break
    }
    const rows = (data ?? []) as Array<{ family_key: string }>
    for (const r of rows) count.set(r.family_key, (count.get(r.family_key) ?? 0) + 1)
    if (rows.length < 1000) break
  }
  big.value = [...count.entries()]
    .filter(([, n]) => n >= BIG)
    .map(([family_key, n]) => ({ family_key, n }))
    .sort((a, b) => b.n - a.n)
  bigLoading.value = false
}

/** 展開哪個同類 → 它的成員 */
const open = ref('')
const members = ref<Record<string, FRow[]>>({})
async function toggleFamily(fk: string) {
  if (open.value === fk) {
    open.value = ''
    return
  }
  open.value = fk
  if (members.value[fk]) return
  const { data, error } = await supabase.from('family_dict').select(COLS).eq('family_key', fk).limit(500)
  if (error) err.value = error.message
  const rows = (data ?? []) as FRow[]
  members.value = { ...members.value, [fk]: rows }
  if (!rename.value[fk]) rename.value = { ...rename.value, [fk]: { en: rows[0]?.name_en ?? '', zh: rows[0]?.name_zh ?? '' } }
  await loadNames(rows.map((r) => r.product_key))
}

/* ---------- 操作 ---------- */
const STAMP = () => ({ source: 'manual', confidence: 1, updated_at: new Date().toISOString() })
const msg = ref('')

/** 改完之後叫 worker 把 family_dict 寫進 products 的三欄 */
async function apply(productKeys: string[], what: string) {
  if (!productKeys.length) return
  const { error } = await supabase.from('admin_jobs').insert({ kind: 'family_apply', payload: { product_keys: productKeys } })
  if (error) {
    err.value = error.message
    return
  }
  msg.value = `${what}：${productKeys.length} 樣，已派工`
  await loadJobs()
}

/** 改同類名：同 family_key 的每一列都改。草稿在展開那個同類時填好（見 toggleFamily）。 */
const rename = ref<Record<string, { en: string; zh: string }>>({})
async function doRename(fk: string) {
  const d = rename.value[fk]
  if (!d || (!d.en && !d.zh)) return
  const { data, error } = await supabase
    .from('family_dict')
    .update({ name_en: d.en || null, name_zh: d.zh || null, ...STAMP() })
    .eq('family_key', fk)
    .select('product_key')
  if (error) {
    err.value = error.message
    return
  }
  const keys = ((data ?? []) as Array<{ product_key: string }>).map((r) => r.product_key)
  for (const list of Object.values(members.value)) for (const r of list) if (r.family_key === fk) { r.name_en = d.en || null; r.name_zh = d.zh || null }
  await apply(keys, `改名 ${fk}`)
}

/** 搬到別的同類：只改這一列，名字沿用目標同類的 */
const moveTo = ref<Record<string, string>>({})
async function doMove(r: FRow) {
  const target = (moveTo.value[r.product_key] ?? '').trim()
  if (!target || target === r.family_key) return
  const { data: t } = await supabase.from('family_dict').select('name_en,name_zh').eq('family_key', target).limit(1)
  const got = ((t ?? [])[0] ?? null) as { name_en: string | null; name_zh: string | null } | null
  if (!got) {
    err.value = `沒有「${target}」這個同類（要先有一樣東西在裡面）`
    return
  }
  err.value = ''
  const { error } = await supabase
    .from('family_dict')
    .update({ family_key: target, name_en: got.name_en, name_zh: got.name_zh, ...STAMP() })
    .eq('product_key', r.product_key)
  if (error) {
    err.value = error.message
    return
  }
  r.family_key = target
  r.name_en = got.name_en
  r.name_zh = got.name_zh
  await apply([r.product_key], `搬到 ${target}`)
}

/** 合併：A 同類的每一列都改成 B */
const mergeTo = ref<Record<string, string>>({})
async function doMerge(fk: string) {
  const target = (mergeTo.value[fk] ?? '').trim()
  if (!target || target === fk) return
  const { data: t } = await supabase.from('family_dict').select('name_en,name_zh').eq('family_key', target).limit(1)
  const got = ((t ?? [])[0] ?? null) as { name_en: string | null; name_zh: string | null } | null
  if (!got) {
    err.value = `沒有「${target}」這個同類`
    return
  }
  err.value = ''
  const { data, error } = await supabase
    .from('family_dict')
    .update({ family_key: target, name_en: got.name_en, name_zh: got.name_zh, ...STAMP() })
    .eq('family_key', fk)
    .select('product_key')
  if (error) {
    err.value = error.message
    return
  }
  const keys = ((data ?? []) as Array<{ product_key: string }>).map((r) => r.product_key)
  big.value = big.value.filter((b) => b.family_key !== fk)
  await apply(keys, `合併 ${fk} → ${target}`)
}

/* ---------- 派工單 ---------- */
interface Job {
  id: string
  status: string
  log: string | null
  created_at: string
  payload: any
}
const jobs = ref<Job[]>([])
async function loadJobs() {
  const { data } = await supabase
    .from('admin_jobs')
    .select('id,status,log,created_at,payload')
    .eq('kind', 'family_apply')
    .order('created_at', { ascending: false })
    .limit(10)
  jobs.value = (data ?? []) as Job[]
}
const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-TW', { hour12: false })
const pct = (c: number | null) => (c == null ? '—' : `${Math.round(c * 100)}%`)

let timer = 0
onMounted(() => {
  void loadLow()
  void loadBig()
  void loadJobs()
  timer = window.setInterval(loadJobs, 10000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div>
    <div v-if="err" class="note" style="margin-bottom: 12px; color: #b00020">{{ err }}</div>
    <div v-if="msg" class="note" style="margin-bottom: 12px">{{ msg }}</div>

    <!-- ① 沒把握的 -->
    <div class="sec" style="margin-bottom: 8px">GPT 沒把握的（把握 &lt; 60%）</div>
    <div v-if="lowLoading" class="sub muted">載入中…</div>
    <div v-else-if="!low.length" class="empty"><div class="h3">沒有</div></div>
    <div v-else class="box" style="margin-bottom: 22px; max-height: 460px; overflow: auto">
      <div v-for="r in low" :key="r.product_key" class="lrow" style="padding: 10px 14px; flex-wrap: wrap">
        <div class="grow" style="min-width: 220px">
          <div class="t">{{ nameOf(r.product_key) }}</div>
          <div class="s muted">
            {{ r.family_key }} · {{ r.name_zh ?? '' }} {{ r.name_en ?? '' }} · 把握 {{ pct(r.confidence) }}
            <template v-if="r.cat2"> · {{ r.cat2 }}</template>
          </div>
        </div>
        <div class="field" style="height: 36px; font-size: 14px; width: 220px; flex: none">
          <input
            :value="moveTo[r.product_key] ?? ''"
            placeholder="搬到哪個 family_key"
            style="flex: 1; min-width: 0"
            @change="moveTo = { ...moveTo, [r.product_key]: ($event.target as HTMLInputElement).value }"
          />
        </div>
        <button class="chip" style="flex: none" @click="doMove(r)">搬</button>
      </div>
    </div>

    <!-- ② 塞太多樣的 -->
    <div class="sec" style="margin-bottom: 8px">一個同類塞太多樣（≥ {{ BIG }}）</div>
    <div v-if="bigLoading" class="sub muted">整表讀取中…</div>
    <div v-else-if="!big.length" class="empty"><div class="h3">沒有</div></div>
    <div v-else class="box" style="margin-bottom: 22px">
      <div v-for="b in big" :key="b.family_key">
        <button class="lrow tap" style="padding: 10px 14px; width: 100%" @click="toggleFamily(b.family_key)">
          <div class="grow">
            <div class="t">{{ b.family_key }}</div>
            <div class="s muted">{{ b.n }} 樣</div>
          </div>
          <div class="link">{{ open === b.family_key ? '▾' : '▸' }}</div>
        </button>
        <template v-if="open === b.family_key">
          <div class="lrow" style="padding: 10px 14px; flex-wrap: wrap; background: var(--paper-2)">
            <div class="field" style="height: 36px; font-size: 14px; width: 180px; flex: none">
              <input
                :value="rename[b.family_key]?.en ?? ''"
                placeholder="英文名"
                style="flex: 1; min-width: 0"
                @change="rename = { ...rename, [b.family_key]: { en: ($event.target as HTMLInputElement).value, zh: rename[b.family_key]?.zh ?? '' } }"
              />
            </div>
            <div class="field" style="height: 36px; font-size: 14px; width: 160px; flex: none">
              <input
                :value="rename[b.family_key]?.zh ?? ''"
                placeholder="中文名"
                style="flex: 1; min-width: 0"
                @change="rename = { ...rename, [b.family_key]: { en: rename[b.family_key]?.en ?? '', zh: ($event.target as HTMLInputElement).value } }"
              />
            </div>
            <button class="chip" style="flex: none" @click="doRename(b.family_key)">改名（整個同類）</button>
            <div class="field" style="height: 36px; font-size: 14px; width: 200px; flex: none">
              <input
                :value="mergeTo[b.family_key] ?? ''"
                placeholder="合併到哪個 family_key"
                style="flex: 1; min-width: 0"
                @change="mergeTo = { ...mergeTo, [b.family_key]: ($event.target as HTMLInputElement).value }"
              />
            </div>
            <button class="chip" style="flex: none" @click="doMerge(b.family_key)">合併</button>
          </div>
          <div v-for="r in members[b.family_key] ?? []" :key="r.product_key" class="lrow" style="padding: 8px 14px 8px 28px; flex-wrap: wrap">
            <div class="grow" style="min-width: 200px">
              <div class="t" style="font-size: 14px">{{ nameOf(r.product_key) }}</div>
              <div class="s muted">{{ r.family_key }} · 把握 {{ pct(r.confidence) }}<template v-if="r.cat2"> · {{ r.cat2 }}</template></div>
            </div>
            <div class="field" style="height: 34px; font-size: 13px; width: 200px; flex: none">
              <input
                :value="moveTo[r.product_key] ?? ''"
                placeholder="搬到哪個 family_key"
                style="flex: 1; min-width: 0"
                @change="moveTo = { ...moveTo, [r.product_key]: ($event.target as HTMLInputElement).value }"
              />
            </div>
            <button class="chip" style="flex: none" @click="doMove(r)">搬</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 派工單 -->
    <div class="sec" style="margin-bottom: 8px">最近的 family_apply 派工單</div>
    <div v-if="!jobs.length" class="sub muted">還沒派過工。</div>
    <div v-else class="box">
      <div v-for="j in jobs" :key="j.id" class="lrow" style="padding: 10px 14px">
        <div class="grow">
          <div class="t">{{ (j.payload?.product_keys ?? []).length }} 樣</div>
          <div class="s">{{ fmtTime(j.created_at) }}<template v-if="j.log"> · {{ j.log }}</template></div>
        </div>
        <span class="tag" :class="j.status === 'failed' ? 'club' : j.status === 'done' ? 'half' : 'low'" style="flex: none">{{ j.status }}</span>
      </div>
    </div>
  </div>
</template>
