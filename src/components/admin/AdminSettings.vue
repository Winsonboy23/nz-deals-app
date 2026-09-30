<script setup lang="ts">
// 後台「開關」（docs/admin-spec.md §2.6）：settings 表五個鍵。App 和 Edge Function 會讀這裡。
// 另一區是每週食譜的設定 recipe_weekly（值是 JSON 字串）：Mac mini 每週一跑爬蟲 repo 的 src/recipes-weekly.ts 照它產食譜，預設值跟那邊的 DEFAULT_CFG 一樣。
import { computed, onMounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { useSiteSettings } from '../../composables/useSiteSettings'
import Loading from '../Loading.vue'

const err = ref('')
const saved = ref(false)
const loading = ref(true)
const restarted = ref(false)

const livePrices = ref(true)
const aiRecipes = ref(true)
const aiCap = ref('300')
const priceCap = ref('5000')
const announce = ref('')

// ---- 每週食譜（recipe_weekly） ----
/** 七個區塊：key、中文名、預設幾道、白話說明 */
const RW_BLOCKS = [
  { key: 'best-value', name: '本週最划算', def: 2, hint: '主角至少 2 樣是這週最多店有特價的食材。' },
  { key: 'one-pot', name: '一鍋到底', def: 2, hint: '從頭到尾只用一個鍋或容器。' },
  { key: 'batch', name: '煮一鍋吃三天', def: 2, hint: '一次煮一大鍋（肉醬、滷肉、咖哩、燉牛肉、湯底、免開火鮪魚拌料挑一種），放幾天換著吃。' },
  { key: 'assembly', name: '組裝輕食點心', def: 1, hint: '幾乎不用煮，把現成的組起來：拼盤、捲餅、三明治、沾醬盤。' },
  { key: 'air-fryer-micro', name: '氣炸鍋／微波爐', def: 1, hint: '主要用氣炸鍋或微波爐、30 分鐘內做好、一次吃完的一餐。' },
  { key: 'breakfast', name: '早餐', def: 1, hint: '早餐吃的。' },
  { key: 'rotating', name: '輪替區塊', def: 2, hint: 'Date Night、週末烘焙、免開火三個輪流出，每週換起點。' },
]
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** 輸入框的值 → 整數、夾在範圍內（type="number" 的 v-model 清空時是 ''，當 0） */
const int = (x: unknown, min: number, max = Infinity) => Math.min(max, Math.max(min, Math.floor(Number(x) || 0)))

/** 設定 → 表單（Kiwi 比例換成百分比）。缺的、不對的欄位用預設；blocks 有給就照給的，沒列的區塊是 0 道（跟 recipes-weekly.ts 的 parseCfg 一樣） */
function rwForm(v: Record<string, unknown>) {
  const num = (x: unknown, def: number, min = 0) => (typeof x === 'number' && x >= min ? x : def)
  const b = isObj(v.blocks) ? v.blocks : null
  return {
    total: num(v.total, 15, 1),
    blocks: Object.fromEntries(RW_BLOCKS.map((k) => [k.key, b ? num(b[k.key], 0) : k.def] as const)),
    min_specials: num(v.min_specials, 3),
    same_store: typeof v.same_store === 'boolean' ? v.same_store : true,
    kiwi_pct: Math.round(Math.min(1, num(v.kiwi_ratio, 0.7)) * 100),
    baby_min: num(v.baby_min, 2),
    reuse_images_max: num(v.reuse_images_max, 4),
    no_repeat_weeks: num(v.no_repeat_weeks, 4),
  }
}
const rw = ref(rwForm({}))
/** 表裡原本的值（解開的物件）：存的時候表單沒有的欄位、區塊照留，不會被按「存」順手刪掉 */
let rwOrig: Record<string, unknown> = {}
/** 表裡的值解不開（或不是物件）：表單用預設，存檔會蓋掉 */
const rwBad = ref(false)
const rwTotal = computed(() => int(rw.value.total, 1, 30))
const rwSum = computed(() => RW_BLOCKS.reduce((s, k) => s + int(rw.value.blocks[k.key], 0), 0))
const rwKiwi = computed(() => Math.round(rwTotal.value * (int(rw.value.kiwi_pct, 0, 100) / 100)))

/** 表單 → 存進 settings 的 JSON 字串 */
function rwValue(): string {
  const f = rw.value
  return JSON.stringify({
    ...rwOrig,
    total: rwTotal.value,
    blocks: { ...(isObj(rwOrig.blocks) ? rwOrig.blocks : {}), ...Object.fromEntries(RW_BLOCKS.map((k) => [k.key, int(f.blocks[k.key], 0)])) },
    min_specials: int(f.min_specials, 0),
    same_store: f.same_store,
    kiwi_ratio: int(f.kiwi_pct, 0, 100) / 100,
    baby_min: int(f.baby_min, 0),
    reuse_images_max: int(f.reuse_images_max, 0),
    no_repeat_weeks: int(f.no_repeat_weeks, 0),
  })
}

async function load() {
  const { data, error } = await supabase.from('settings').select('key,value')
  if (error) {
    err.value = error.message
    loading.value = false
    return
  }
  const v = new Map(((data ?? []) as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]))
  livePrices.value = v.get('live_prices') !== 'off'
  aiRecipes.value = v.get('ai_recipes') !== 'off'
  aiCap.value = v.get('ai_daily_cap') ?? '300'
  priceCap.value = v.get('price_daily_cap') ?? '5000'
  announce.value = v.get('announce') ?? ''
  // 每週食譜：表裡沒有這個鍵就用預設；有但解不開也用預設，並提醒存檔會蓋掉
  const raw = v.get('recipe_weekly')
  let cfg: unknown = {}
  try {
    if (raw !== undefined) cfg = JSON.parse(raw)
  } catch {
    cfg = null
  }
  rwBad.value = !isObj(cfg)
  rwOrig = isObj(cfg) ? cfg : {}
  rw.value = rwForm(rwOrig)
  loading.value = false
}

async function save() {
  const now = new Date().toISOString()
  const rows = [
    { key: 'live_prices', value: livePrices.value ? 'on' : 'off', updated_at: now },
    { key: 'ai_recipes', value: aiRecipes.value ? 'on' : 'off', updated_at: now },
    { key: 'ai_daily_cap', value: String(Number(aiCap.value) || 0), updated_at: now },
    { key: 'price_daily_cap', value: String(Number(priceCap.value) || 0), updated_at: now },
    { key: 'announce', value: announce.value, updated_at: now },
    { key: 'recipe_weekly', value: rwValue(), updated_at: now },
  ]
  const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' })
  if (error) {
    err.value = error.message
    return
  }
  err.value = ''
  rwBad.value = false
  saved.value = true
  setTimeout(() => (saved.value = false), 2500)
  // 這個分頁自己也照新設定走，不用重新整理
  const site = useSiteSettings()
  site.livePrices.value = livePrices.value
  site.aiRecipes.value = aiRecipes.value
  site.announce.value = announce.value
}

async function restart() {
  if (!confirm('要叫 Mac mini 上的 price-worker 重啟嗎？（launchd 會自動把它開回來）')) return
  const { error } = await supabase.from('admin_jobs').insert({ kind: 'restart_worker', payload: {} })
  if (error) {
    err.value = error.message
    return
  }
  restarted.value = true
  setTimeout(() => (restarted.value = false), 4000)
}

onMounted(() => void load())
</script>

<template>
  <div>
    <div v-if="err" class="note" style="margin-bottom: 12px; color: #b00020">{{ err }}</div>
    <Loading v-if="loading" inline />

    <template v-else>
      <div class="box" style="margin-bottom: 16px">
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">即時查價（live_prices）</div>
            <div class="s muted">關掉之後 App 的一站不送單，顯示「即時查價暫停中」。</div>
          </div>
          <button class="tg" :class="{ off: !livePrices }" style="flex: none" @click="livePrices = !livePrices" />
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">AI 食譜（ai_recipes）</div>
            <div class="s muted">關掉之後清單底部的按鈕變灰，函式直接回 503。</div>
          </div>
          <button class="tg" :class="{ off: !aiRecipes }" style="flex: none" @click="aiRecipes = !aiRecipes" />
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">AI 每天全站上限（ai_daily_cap）</div>
            <div class="s muted">一次約 NZ$0.01–0.02。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="aiCap" type="number" min="0" step="10" style="flex: 1; min-width: 0" />
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">查價單每天全站上限（price_daily_cap）</div>
            <div class="s muted">超過就回 busy。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="priceCap" type="number" min="0" step="100" style="flex: 1; min-width: 0" />
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px; display: block">
          <div class="t">首頁公告（announce）</div>
          <div class="s muted" style="margin-bottom: 8px">留空 = 不顯示。使用者關掉之後，同一句不再出現。</div>
          <textarea v-model="announce" rows="2" maxlength="200" style="width: 100%; box-sizing: border-box; font: inherit; padding: 8px 10px; border: 1.5px solid var(--line); border-radius: 12px" />
        </div>
      </div>

      <div class="sec" style="margin-bottom: 4px; text-transform: none">每週食譜（recipe_weekly）</div>
      <div class="small muted" style="margin-bottom: 8px">Mac mini 每週一照這份自動產食譜。改了下週一產的那批才會用到。</div>
      <div v-if="rwBad" class="note" style="margin-bottom: 8px; color: #b00020">目前的值格式不對，存檔會蓋掉。</div>
      <div class="box" style="margin-bottom: 16px">
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">每週幾道（total）</div>
            <div class="s muted">1–30。產完都是待審，後台「食譜」頁審過才上架。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="rw.total" type="number" min="1" max="30" step="1" style="flex: 1; min-width: 0" />
          </div>
        </div>
        <div v-for="b in RW_BLOCKS" :key="b.key" class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">{{ b.name }}（{{ b.key }}）</div>
            <div class="s muted">{{ b.hint }}</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="rw.blocks[b.key]" type="number" min="0" step="1" style="flex: 1; min-width: 0" />
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="s" :style="{ color: rwSum > rwTotal ? '#b00020' : undefined }">
            區塊加總 {{ rwSum }} 道 / 每週 {{ rwTotal }} 道<template v-if="rwSum > rwTotal">：超過了，排在後面的 {{ rwSum - rwTotal }} 道不會產</template><template v-else-if="rwSum < rwTotal">：剩下 {{ rwTotal - rwSum }} 道不限區塊（一般家常晚餐）</template>
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">每道至少幾樣特價食材（min_specials）</div>
            <div class="s muted">主食材（肉、魚、菜、蛋奶、澱粉）至少幾樣是這週特價，鹽糖香料不算；不夠的那道丟掉重產。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="rw.min_specials" type="number" min="0" step="1" style="flex: 1; min-width: 0" />
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">盡量同一家買齊（same_store）</div>
            <div class="s muted">開著：同一道菜的特價食材盡量挑同一家連鎖都有特價的，買菜不用跑兩家。</div>
          </div>
          <button class="tg" :class="{ off: !rw.same_store }" style="flex: none" @click="rw.same_store = !rw.same_store" />
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">Kiwi 家常菜比例（kiwi_ratio）</div>
            <div class="s muted">其餘是亞洲菜（中、日、韓、東南亞、印度）。每週 {{ rwTotal }} 道裡 {{ rwKiwi }} 道 Kiwi。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="rw.kiwi_pct" type="number" min="0" max="100" step="5" style="flex: 1; min-width: 0" />
            <span class="muted">%</span>
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">每週至少幾道能開寶寶支線（baby_min）</div>
            <div class="s muted">這幾道會做成最後才調味，能先取出寶寶那份；6／9／12 個月的做法要另外寫，寫了 App 才會出現寶寶支線。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="rw.baby_min" type="number" min="0" step="1" style="flex: 1; min-width: 0" />
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">一週最多沿用幾張舊圖（reuse_images_max）</div>
            <div class="s muted">跟以前的菜主食材八成一樣、做法相同，就沿用那張照片，不另外找圖或生圖（省錢）。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="rw.reuse_images_max" type="number" min="0" step="1" style="flex: 1; min-width: 0" />
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">幾週內不重複同一道菜（no_repeat_weeks）</div>
            <div class="s muted">跟最近這幾週產過的菜比，同名、或主食材八成一樣又同做法的整道丟掉重產；常備庫一律會比，0 = 只比常備庫。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="rw.no_repeat_weeks" type="number" min="0" step="1" style="flex: 1; min-width: 0" />
          </div>
        </div>
      </div>

      <div class="chips" style="margin-bottom: 22px">
        <button class="chip on" @click="save">存</button>
        <span v-if="saved" class="tag half">已存</span>
      </div>

      <div class="sec" style="margin-bottom: 8px">Mac mini</div>
      <div class="box">
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">重啟 price-worker</div>
            <div class="s muted">插一張 restart_worker 派工單；worker 收到就自己結束，launchd 會重開。</div>
          </div>
          <button class="chip" style="flex: none" @click="restart">重啟</button>
        </div>
        <div v-if="restarted" class="lrow" style="padding: 10px 14px"><div class="s">派工單送出了。</div></div>
      </div>
    </template>
  </div>
</template>
