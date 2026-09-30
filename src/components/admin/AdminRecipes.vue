<script setup lang="ts">
// 後台「食譜」（Phase 6 #25，migrations/008-recipes.sql）：recipes 表一列一道，整份食譜放在 data。
//  列表：待上架（published=false，多半是每週 AI 產的）→ 本週 → 常備庫 →（有的話）其他週已上架的。
//  每列直接切「上架／審過」；「編輯」在那一列下面展開，改文字和標籤（食材先只看不改），也可以刪。
//  RLS 只讓 is_admin() 改；被擋時 update / delete 不會回 error、只是一列都沒動到，所以都帶 .select('id') 拿回動到的列來判斷。
//  改成功就叫 App 重讀一次表（useRecipes().loadRecipes），切到食譜頁就是新的，不用重新整理。
import { computed, onMounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { nzMonday } from '../../lib/week'
import { recipeImg, useRecipes, type Appliance, type Block, type Recipe } from '../../composables/useRecipes'
import Loading from '../Loading.vue'

type Data = Omit<Recipe, 'weekStart'>
interface Row {
  id: string
  week_start: string | null
  source: string
  published: boolean
  reviewed: boolean
  data: Data
}

const BLOCK_ZH: Record<Block, string> = {
  'best-value': '本週最划算',
  'one-pot': '一鍋煮',
  batch: '煮一鍋吃三天',
  assembly: '組裝輕食',
  'air-fryer-micro': '氣炸鍋／微波爐',
  breakfast: '早餐',
  'date-night': 'Date Night',
  'weekend-baking': '週末烘焙',
  'no-cook': '免開火',
  holiday: '節日限定',
}
const APPLIANCE_ZH: Record<Appliance, string> = {
  'air-fryer': '氣炸鍋',
  'rice-cooker': '電子鍋',
  'slow-cooker': '慢燉鍋',
  toaster: '烤麵包機',
  stovetop: '爐台',
  blender: '果汁機',
  oven: '烤箱',
  microwave: '微波爐',
  bbq: 'BBQ',
}
const DIFF_ZH: Record<Data['difficulty'], string> = { easy: '簡單', medium: '中等', hard: '困難' }
const BLOCKS = Object.keys(BLOCK_ZH) as Block[]
const APPLIANCES = Object.keys(APPLIANCE_ZH) as Appliance[]
const DIFFS = Object.keys(DIFF_ZH) as Data['difficulty'][]

const { loadRecipes } = useRecipes()
const monday = nzMonday()
const rows = ref<Row[]>([])
const loading = ref(true)
const err = ref('')
/** 各列操作的結果，顯示在那一列下面（失敗紅字） */
const note = ref<Record<string, { text: string; bad: boolean }>>({})
const say = (id: string, text: string, bad = true) => {
  note.value = { ...note.value, [id]: { text, bad } }
}

async function load() {
  const { data, error } = await supabase
    .from('recipes')
    .select('id,week_start,source,published,reviewed,data')
    .order('week_start', { ascending: false, nullsFirst: false })
    .order('id')
  loading.value = false
  if (error) {
    err.value = error.message
    return
  }
  rows.value = (data ?? []) as Row[]
}

const groups = computed(() => {
  const other = rows.value.filter((r) => r.published && !!r.week_start && r.week_start !== monday)
  return [
    { title: '待上架', sub: '還沒上架的，多半是每週 AI 產的：看過沒問題就打開「上架」。', rows: rows.value.filter((r) => !r.published) },
    { title: `本週（${monday}）`, sub: '', rows: rows.value.filter((r) => r.published && r.week_start === monday) },
    { title: '常備庫', sub: '', rows: rows.value.filter((r) => r.published && !r.week_start) },
    ...(other.length ? [{ title: '其他週（已上架）', sub: '別週的精選還上架著，App 會把它們排在「常備食譜」那段。', rows: other }] : []),
  ]
})
const blocksText = (d: Data) => (d.blocks ?? []).map((b) => BLOCK_ZH[b] ?? b).join('、') || '沒有區塊'

/** update / delete 之後：有 error，或一列都沒動到（RLS 擋住），就在那一列下面寫原因 */
function failed(id: string, res: { error: { message: string } | null; data: unknown[] | null }): boolean {
  if (!res.error && res.data?.length) return false
  say(id, res.error?.message ?? '沒改到：可能沒有權限（登入過期？），或這道已經被刪了')
  return true
}

/** 上架／審過：直接改那一欄 */
async function flip(r: Row, key: 'published' | 'reviewed') {
  const v = !r[key]
  const res = await supabase.from('recipes').update({ [key]: v, updated_at: new Date().toISOString() }).eq('id', r.id).select('id')
  if (failed(r.id, res)) return
  r[key] = v
  say(r.id, '', false)
  if (key === 'published') void loadRecipes()
}

/* ---------- 編輯 ---------- */
interface Draft {
  titleZh: string
  titleEn: string
  /** type="number" 的 v-model 會自己轉成數字，清空時是 '' */
  serves: number | string
  minutes: number | string
  kcal: number | string
  pots: number | string
  difficulty: Data['difficulty']
  blocks: Block[]
  appliances: Appliance[]
  canDelay: boolean
  tipZh: string
  tipEn: string
  /** 一行一步 */
  stepsZh: string
  stepsEn: string
}
const toDraft = (d: Partial<Data>): Draft => ({
  titleZh: d.title?.zh ?? '',
  titleEn: d.title?.en ?? '',
  serves: d.serves ?? '',
  minutes: d.minutes ?? '',
  kcal: d.kcal ?? '',
  pots: d.pot_count ?? 0,
  difficulty: d.difficulty ?? 'easy',
  blocks: [...(d.blocks ?? [])],
  appliances: [...(d.appliances ?? [])],
  canDelay: !!d.can_delay_seasoning,
  tipZh: d.tip?.zh ?? '',
  tipEn: d.tip?.en ?? '',
  stepsZh: (d.steps?.zh ?? []).join('\n'),
  stepsEn: (d.steps?.en ?? []).join('\n'),
})
/** 展開的是哪一列；草稿在展開時從那一列複製一份 */
const open = ref('')
const draft = ref<Draft>(toDraft({}))

function edit(r: Row) {
  say(r.id, '', false)
  if (open.value === r.id) {
    open.value = ''
    return
  }
  draft.value = toDraft(r.data)
  open.value = r.id
}

/** 多選：有就拿掉、沒有就加上（不認得的舊值原樣留著） */
function toggleIn<T>(list: T[], v: T) {
  const i = list.indexOf(v)
  if (i >= 0) list.splice(i, 1)
  else list.push(v)
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const num = (v: number | string) => (String(v).trim() === '' ? NaN : Number(v))
const isInt = (n: number, min: number) => Number.isInteger(n) && n >= min

function problem(d: Draft): string {
  if (!d.titleZh.trim() || !d.titleEn.trim()) return '標題中英都要填'
  if (!lines(d.stepsZh).length || !lines(d.stepsEn).length) return '做法中英都要至少一步'
  if (!isInt(num(d.serves), 1) || !isInt(num(d.minutes), 1)) return '人份、分鐘要是 1 以上的整數'
  if (!isInt(num(d.pots), 0)) return '鍋數要是 0 以上的整數'
  if (String(d.kcal).trim() && !(num(d.kcal) > 0)) return '熱量留空，或填大於 0 的數字'
  return ''
}

/** 存 = 整份 data 換掉（沒編輯到的欄位照原樣帶著），updated_at 換成現在 */
async function save(r: Row) {
  const d = draft.value
  const bad = problem(d)
  if (bad) return say(r.id, bad)
  const data: Data = {
    ...r.data,
    title: { zh: d.titleZh.trim(), en: d.titleEn.trim() },
    serves: num(d.serves),
    minutes: num(d.minutes),
    kcal: String(d.kcal).trim() ? num(d.kcal) : undefined,   // 留空 = 拿掉
    difficulty: d.difficulty,
    blocks: [...d.blocks],
    appliances: [...d.appliances],
    pot_count: num(d.pots),
    can_delay_seasoning: d.canDelay,
    // 兩個都清空就拿掉，不然詳情頁會出現空的「小撇步」框
    tip: d.tipZh.trim() || d.tipEn.trim() ? { zh: d.tipZh.trim(), en: d.tipEn.trim() } : undefined,
    steps: { zh: lines(d.stepsZh), en: lines(d.stepsEn) },
  }
  const res = await supabase.from('recipes').update({ data, updated_at: new Date().toISOString() }).eq('id', r.id).select('id')
  if (failed(r.id, res)) return
  r.data = data
  open.value = ''
  say(r.id, '已存', false)
  void loadRecipes()
}

async function remove(r: Row) {
  if (!confirm(`刪掉「${r.data.title?.zh || r.id}」？刪了就沒有了（常備庫的可以重跑匯入腳本補回來）。`)) return
  const res = await supabase.from('recipes').delete().eq('id', r.id).select('id')
  if (failed(r.id, res)) return
  rows.value = rows.value.filter((x) => x.id !== r.id)
  open.value = ''
  void loadRecipes()
}

onMounted(() => void load())
</script>

<template>
  <div>
    <div v-if="err" class="note" style="margin-bottom: 12px; color: #b00020">{{ err }}</div>
    <Loading v-if="loading" inline />

    <template v-else>
      <div class="s muted" style="margin-bottom: 14px">App 只讀「上架」的。食材這裡先不能改。</div>
      <template v-for="g in groups" :key="g.title">
        <div class="sec" style="margin-bottom: 8px">{{ g.title }}（{{ g.rows.length }}）</div>
        <div v-if="g.sub" class="s muted" style="margin-bottom: 8px">{{ g.sub }}</div>
        <div v-if="!g.rows.length" class="sub muted" style="margin-bottom: 22px">沒有。</div>
        <div v-else class="box" style="margin-bottom: 22px">
          <div v-for="r in g.rows" :key="r.id" class="rrow">
            <div class="lrow" style="padding: 10px 14px; flex-wrap: wrap">
              <img class="rthumb" :src="recipeImg(r.data.image)" alt="" loading="lazy" decoding="async" />
              <div class="grow" style="min-width: 220px">
                <div class="t">{{ r.data.title?.zh || r.id }}</div>
                <div class="s">{{ r.data.minutes }} 分鐘 · {{ blocksText(r.data) }}</div>
                <div class="s muted">{{ r.id }}<template v-if="r.week_start"> · 週 {{ r.week_start }}</template> · {{ r.source === 'ai' ? 'AI 產' : '手動' }}</div>
              </div>
              <div class="sw"><span class="s">上架</span><button class="tg" :class="{ off: !r.published }" @click="flip(r, 'published')" /></div>
              <div class="sw"><span class="s">審過</span><button class="tg" :class="{ off: !r.reviewed }" @click="flip(r, 'reviewed')" /></div>
              <button class="chip" :class="{ on: open === r.id }" style="flex: none" @click="edit(r)">{{ open === r.id ? '收起' : '編輯' }}</button>
            </div>
            <div v-if="note[r.id]?.text" class="rnote" :class="{ bad: note[r.id].bad }">{{ note[r.id].text }}</div>

            <div v-if="open === r.id" class="edit">
              <div class="frow">
                <label class="fl wide">中文標題<input v-model="draft.titleZh" /></label>
                <label class="fl wide">英文標題<input v-model="draft.titleEn" /></label>
              </div>
              <div class="frow">
                <label class="fl">人份<input v-model="draft.serves" type="number" min="1" step="1" /></label>
                <label class="fl">分鐘<input v-model="draft.minutes" type="number" min="1" step="1" /></label>
                <label class="fl">每份 kcal<input v-model="draft.kcal" type="number" min="1" placeholder="可留空" /></label>
                <label class="fl">用幾個鍋<input v-model="draft.pots" type="number" min="0" step="1" /></label>
                <div class="fl">
                  難度
                  <div class="chips">
                    <button v-for="k in DIFFS" :key="k" class="chip" :class="{ on: draft.difficulty === k }" @click="draft.difficulty = k">{{ DIFF_ZH[k] }}</button>
                  </div>
                </div>
                <div class="fl">
                  最後才調味（can_delay_seasoning）
                  <button class="tg" :class="{ off: !draft.canDelay }" @click="draft.canDelay = !draft.canDelay" />
                </div>
              </div>
              <div class="fl">
                區塊
                <div class="chips">
                  <button v-for="k in BLOCKS" :key="k" class="chip" :class="{ on: draft.blocks.includes(k) }" @click="toggleIn(draft.blocks, k)">{{ BLOCK_ZH[k] }}</button>
                </div>
              </div>
              <div class="fl">
                廚具
                <div class="chips">
                  <button v-for="k in APPLIANCES" :key="k" class="chip" :class="{ on: draft.appliances.includes(k) }" @click="toggleIn(draft.appliances, k)">{{ APPLIANCE_ZH[k] }}</button>
                </div>
              </div>
              <div class="frow">
                <label class="fl wide">做法（中文，一行一步）<textarea v-model="draft.stepsZh" rows="7" /></label>
                <label class="fl wide">做法（英文，一行一步）<textarea v-model="draft.stepsEn" rows="7" /></label>
              </div>
              <div class="frow">
                <label class="fl wide">小撇步（中文）<textarea v-model="draft.tipZh" rows="2" /></label>
                <label class="fl wide">小撇步（英文）<textarea v-model="draft.tipEn" rows="2" /></label>
              </div>
              <div class="fl">
                食材（唯讀）
                <div class="ings">
                  <div v-for="(g2, i) in r.data.ingredients ?? []" :key="i">
                    {{ g2.name?.zh }}
                    <span class="muted">{{ g2.name?.en }} · {{ (g2.families ?? []).join(', ') || '沒有同類 key' }}<template v-if="g2.optional"> · 選配</template></span>
                  </div>
                </div>
              </div>
              <div class="chips" style="margin-top: 14px">
                <button class="chip on" @click="save(r)">存</button>
                <button class="chip" @click="edit(r)">取消</button>
                <button class="chip danger" style="margin-left: auto" @click="remove(r)">刪除這道</button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.rrow + .rrow { border-top: 1px solid var(--line); }
.rthumb { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; flex: none; background: var(--paper-2); }
.sw { display: flex; align-items: center; gap: 6px; flex: none; }
.sw .s { margin-top: 0; }
.rnote { padding: 0 14px 10px; font-size: 12.5px; color: var(--ink-2); }
.rnote.bad { color: #b00020; }
.edit { padding: 4px 14px 14px; background: var(--paper-2); border-top: 1px solid var(--line); }
.frow { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
.fl { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; font-size: 12px; font-weight: 700; color: var(--ink-2); }
.fl.wide { flex: 1; min-width: 260px; }
.fl input,
.fl textarea {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 14px;
  font-weight: 400;
  color: var(--ink);
  padding: 8px 10px;
  border: 1.5px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
}
.fl input[type='number'] { width: 110px; }
.ings { font-size: 13px; font-weight: 400; color: var(--ink); line-height: 1.5; }
.chip.danger { border-color: #b00020; color: #b00020; }
</style>
