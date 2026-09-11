<script setup lang="ts">
// 後台「待審」（docs/admin-spec.md §2.1）：跨店配對 / 名字配對 / 同類（Phase B）。
// 跨店配對點了不直接寫字典 —「都不一樣」要重算規則 key，改成插一張 admin_jobs（kind decide_pair）給 Mac mini 的 worker 做。
import { computed, onMounted, ref } from 'vue'
import AdminFamily from './AdminFamily.vue'
import ProductThumb from '../ProductThumb.vue'
import { supabase } from '../../lib/supabase'
import { money } from '../../lib/format'
import type { Special } from '../../lib/types'

type Sub = 'pairs' | 'names' | 'family'
const sub = ref<Sub>('pairs')
const err = ref('')

/* ---------- 跨店配對 ---------- */
const SPECIAL_COLS =
  'store_id,name,brand,size,price,price_unit,was_price,unit_price,unit_price_unit,promo_type,club_only,category_id,image_url'

interface Pair {
  dictKey: string
  productKey: string
  confidence: number
  matchedTo: string
  a: Special
  b: Special
  aMissing: boolean
  bMissing: boolean
  sent: '' | 'same' | 'diff'
}
const pairs = ref<Pair[]>([])
const pairsLoading = ref(true)
const openPairs = computed(() => pairs.value.filter((p) => !p.sent))
const sentPairs = computed(() => pairs.value.filter((p) => p.sent))

/** specials 那列（本週、任一店）→ 前端的 Special；沒有那列就只留編號和備援名字，照片會退回分類佔位。 */
function toSpecial(r: any, productId: string, storeId: string, fallbackName: string): Special {
  return {
    store_id: r?.store_id ?? storeId,
    product_id: productId,
    product_key: null,
    family_key: null,
    family_name_en: null,
    family_name_zh: null,
    name: r?.name ?? fallbackName,
    brand: r?.brand ?? null,
    size: r?.size ?? null,
    price: Number(r?.price ?? 0),
    price_unit: r?.price_unit ?? 'each',
    was_price: r?.was_price == null ? null : Number(r.was_price),
    unit_price: r?.unit_price == null ? null : Number(r.unit_price),
    unit_price_unit: r?.unit_price_unit ?? null,
    multi_buy: null,
    promo_type: r?.promo_type ?? null,
    club_only: !!r?.club_only,
    category_id: r?.category_id ?? null,
    image_url: r?.image_url ?? null,
    product_url: null,
  }
}
/** specials 沒有 product_id 的索引，一次一個編號 limit 1 最快（整批 in() 會把 288 家店的列全撈出來）。 */
async function sideRow(productId: string) {
  const { data } = await supabase.from('specials').select(SPECIAL_COLS).eq('product_id', productId).limit(1)
  return (data ?? [])[0] as any | undefined
}

async function loadPairs() {
  pairsLoading.value = true
  const { data, error } = await supabase
    .from('product_dict')
    .select('dict_key,product_key,confidence,matched_to')
    .eq('source', 'ai')
    .not('matched_to', 'is', null)
    .lt('confidence', 0.8)
    .order('confidence')
    .limit(50)
  if (error) {
    err.value = error.message
    pairsLoading.value = false
    return
  }
  const rows = (data ?? []) as any[]
  const { data: prods } = await supabase
    .from('products')
    .select('key,display_name')
    .in('key', rows.map((r) => r.product_key))
  const displayOf = new Map((prods ?? []).map((p: any) => [p.key as string, p.display_name as string]))
  pairs.value = await Promise.all(
    rows.map(async (r) => {
      const aid = String(r.dict_key).split('|')[1]
      const [ra, rb] = await Promise.all([sideRow(aid), sideRow(r.matched_to)])
      const fallback = displayOf.get(r.product_key) ?? String(r.product_key).replace(/_/g, ' ')
      return {
        dictKey: r.dict_key,
        productKey: r.product_key,
        confidence: Number(r.confidence ?? 0),
        matchedTo: r.matched_to,
        a: toSpecial(ra, aid, 'newworld:?', fallback),
        b: toSpecial(rb, r.matched_to, 'woolworths:?', fallback),
        aMissing: !ra,
        bMissing: !rb,
        sent: '' as const,
      }
    }),
  )
  pairsLoading.value = false
}

async function decidePair(p: Pair, same: boolean) {
  const { error } = await supabase.from('admin_jobs').insert({ kind: 'decide_pair', payload: { dict_key: p.dictKey, same } })
  if (error) {
    err.value = error.message
    return
  }
  p.sent = same ? 'same' : 'diff'
}

/* ---------- 名字配對 ---------- */
interface Cand {
  product_id: string
  name: string
  size?: string
  price?: number
  score?: number
}
interface NameRow {
  chain: string
  productKey: string
  name: string
  term: string
  candidates: Cand[]
  status: string
  sent: '' | 'same' | 'diff'
}
const nameRows = ref<NameRow[]>([])
const namesLoading = ref(true)
const recheckOpen = ref(false)
const toReview = computed(() => nameRows.value.filter((r) => r.status === 'review' && !r.sent))
const toRecheck = computed(() => nameRows.value.filter((r) => r.status === 'none' && !r.sent && r.candidates.length))
const nameSent = computed(() => nameRows.value.filter((r) => r.sent).length)
const chainLabel = (c: string) => (c === 'woolworths' ? 'Woolworths' : "New World / PAK'nSAVE")

async function loadNames() {
  namesLoading.value = true
  const { data, error } = await supabase
    .from('name_matches')
    .select('chain,product_key,status,candidates,term,searched_at')
    .in('status', ['review', 'none'])
    .order('searched_at', { ascending: false })
    .limit(200)
  if (error) {
    err.value = error.message
    namesLoading.value = false
    return
  }
  const rows = (data ?? []) as any[]
  const { data: prods } = await supabase
    .from('products')
    .select('key,display_name')
    .in('key', rows.map((r) => r.product_key))
  const displayOf = new Map((prods ?? []).map((p: any) => [p.key as string, p.display_name as string]))
  nameRows.value = rows.map((r) => ({
    chain: r.chain,
    productKey: r.product_key,
    name: displayOf.get(r.product_key) ?? String(r.product_key).replace(/_/g, ' '),
    term: r.term ?? '',
    candidates: (r.candidates ?? []) as Cand[],
    status: r.status,
    sent: '' as const,
  }))
  namesLoading.value = false
}

/** 候選的縮圖：Foodstuffs 用編號組公開圖網址（format.imageFor），Woolworths 沒有圖只能佔位。 */
function candSpecial(r: NameRow, c: Cand): Special {
  const store = r.chain === 'woolworths' ? 'woolworths:?' : 'newworld:?'
  return toSpecial({ name: c.name, size: c.size, price: c.price }, c.product_id, store, c.name)
}

async function nameSame(r: NameRow, c: Cand) {
  const chains = r.chain === 'woolworths' ? ['woolworths'] : ['newworld', 'paknsave']
  const { error: e1 } = await supabase
    .from('product_ids')
    .upsert(chains.map((ch) => ({ chain: ch, product_id: c.product_id, product_key: r.productKey })), { onConflict: 'chain,product_id' })
  if (e1) {
    err.value = e1.message
    return
  }
  const { error: e2 } = await supabase
    .from('name_matches')
    .update({ status: 'matched', product_id: c.product_id, decided_by: 'manual' })
    .eq('chain', r.chain)
    .eq('product_key', r.productKey)
  if (e2) {
    err.value = e2.message
    return
  }
  r.sent = 'same'
}
async function nameNone(r: NameRow) {
  const { error } = await supabase
    .from('name_matches')
    .update({ status: 'none', decided_by: 'manual' })
    .eq('chain', r.chain)
    .eq('product_key', r.productKey)
  if (error) {
    err.value = error.message
    return
  }
  r.sent = 'diff'
}

onMounted(() => {
  void loadPairs()
  void loadNames()
})
</script>

<template>
  <div>
    <div class="chips" style="margin-bottom: 14px">
      <button class="chip" :class="{ on: sub === 'pairs' }" @click="sub = 'pairs'">跨店配對 {{ openPairs.length }}</button>
      <button class="chip" :class="{ on: sub === 'names' }" @click="sub = 'names'">名字配對 {{ toReview.length }}</button>
      <button class="chip" :class="{ on: sub === 'family' }" @click="sub = 'family'">同類</button>
    </div>
    <div v-if="err" class="note" style="margin-bottom: 12px; color: #b00020">{{ err }}</div>

    <!-- 跨店配對：週一 GPT 配對但把握 < 0.8 的 -->
    <template v-if="sub === 'pairs'">
      <div class="sub" style="margin-bottom: 10px">
        左邊 New World / PAK'nSAVE，右邊 Woolworths。點完會插一張派工單，Mac mini 上的 worker 10 秒內接走改字典。
      </div>
      <div v-if="pairsLoading" class="sub muted">載入中…</div>
      <div v-else-if="!openPairs.length" class="empty">
        <div class="h3">沒有待審的跨店配對</div>
        <div class="s" style="margin-top: 4px">週一 GPT 配對把握 &lt; 0.8 的才會進來。</div>
      </div>
      <div v-for="p in openPairs" :key="p.dictKey" class="prow">
        <div class="side">
          <ProductThumb :special="p.a" variant="tn" class="big" />
          <div style="min-width: 0">
            <div class="t">{{ [p.a.brand, p.a.name, p.a.size].filter(Boolean).join(' ') }}</div>
            <div class="s">{{ p.aMissing ? '本週特價表沒有這筆（用商品標準名）' : money(p.a.price) + ' · ' + (p.a.category_id ?? '') }}</div>
            <div class="s muted">{{ p.dictKey }}</div>
          </div>
        </div>
        <div class="mid">
          <div class="pct" :class="{ lo: p.confidence < 0.5 }">{{ Math.round(p.confidence * 100) }}%</div>
          <div class="s muted">GPT 把握</div>
          <div style="display: flex; gap: 8px; justify-content: center; margin-top: 8px">
            <button class="chip on" @click="decidePair(p, true)">一樣</button>
            <button class="chip" @click="decidePair(p, false)">都不一樣</button>
          </div>
          <div class="s muted" style="margin-top: 6px; word-break: break-all">{{ p.productKey }}</div>
        </div>
        <div class="side r">
          <div style="min-width: 0; text-align: right">
            <div class="t">{{ [p.b.brand, p.b.name, p.b.size].filter(Boolean).join(' ') }}</div>
            <div class="s">{{ p.bMissing ? '本週特價表沒有這筆（用商品標準名）' : money(p.b.price) + ' · ' + (p.b.category_id ?? '') }}</div>
            <div class="s muted">woolworths|{{ p.matchedTo }}</div>
          </div>
          <ProductThumb :special="p.b" variant="tn" class="big" />
        </div>
      </div>
      <div v-if="sentPairs.length" class="sub muted" style="margin-top: 12px">
        已送出 {{ sentPairs.length }} 張派工單：
        <span v-for="p in sentPairs" :key="p.dictKey" style="margin-right: 10px">
          {{ p.productKey }} · {{ p.sent === 'same' ? '一樣' : '都不一樣' }} ✓
        </span>
      </div>
    </template>

    <!-- 名字配對：即時查價用名字搜、規則沒把握的 -->
    <template v-else-if="sub === 'names'">
      <div class="sub" style="margin-bottom: 10px">
        清單裡的商品在那家連鎖沒有編號時，worker 用名字去搜；規則判不出來的留在這裡。點「一樣」會直接寫進 product_ids。
      </div>
      <div v-if="namesLoading" class="sub muted">載入中…</div>
      <div v-else-if="!toReview.length" class="empty">
        <div class="h3">沒有待審的名字配對</div>
      </div>
      <div v-for="r in toReview" :key="r.chain + r.productKey" class="nrow">
        <div class="hrow">
          <div class="grow">
            <div class="t">{{ r.name }}</div>
            <div class="s muted">{{ chainLabel(r.chain) }} · 搜「{{ r.term }}」</div>
          </div>
          <button class="chip" @click="nameNone(r)">都不一樣</button>
        </div>
        <div v-for="c in r.candidates" :key="c.product_id" class="lrow" style="gap: 10px">
          <ProductThumb :special="candSpecial(r, c)" variant="tn" />
          <div class="grow">
            <div class="t">{{ c.name }} <span class="muted" style="font-weight: 400">{{ c.size }}</span></div>
            <div class="s muted">{{ c.product_id }} · 像 {{ Math.round((c.score ?? 0) * 100) }}%</div>
          </div>
          <div class="p">{{ c.price != null ? money(c.price) : '' }}</div>
          <button class="chip on" style="flex: none" @click="nameSame(r, c)">一樣</button>
        </div>
      </div>

      <div style="margin-top: 20px">
        <button class="chip" @click="recheckOpen = !recheckOpen">
          {{ recheckOpen ? '▾' : '▸' }} 複查搜不到的（{{ toRecheck.length }}）
        </button>
        <template v-if="recheckOpen">
          <div v-for="r in toRecheck" :key="r.chain + r.productKey" class="nrow" style="margin-top: 10px">
            <div class="hrow">
              <div class="grow">
                <div class="t">{{ r.name }}</div>
                <div class="s muted">{{ chainLabel(r.chain) }} · 搜「{{ r.term }}」· 目前判「沒有」</div>
              </div>
            </div>
            <div v-for="c in r.candidates" :key="c.product_id" class="lrow" style="gap: 10px">
              <ProductThumb :special="candSpecial(r, c)" variant="tn" />
              <div class="grow">
                <div class="t">{{ c.name }} <span class="muted" style="font-weight: 400">{{ c.size }}</span></div>
                <div class="s muted">{{ c.product_id }} · 像 {{ Math.round((c.score ?? 0) * 100) }}%</div>
              </div>
              <div class="p">{{ c.price != null ? money(c.price) : '' }}</div>
              <button class="chip on" style="flex: none" @click="nameSame(r, c)">一樣</button>
            </div>
          </div>
        </template>
      </div>
      <div v-if="nameSent" class="sub muted" style="margin-top: 12px">這次已處理 {{ nameSent }} 組 ✓</div>
    </template>

    <!-- 同類（family_dict） -->
    <AdminFamily v-else />
  </div>
</template>

<style scoped>
.prow {
  display: grid;
  grid-template-columns: 1fr 210px 1fr;
  gap: 16px;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 14px;
  margin-bottom: 10px;
}
.side {
  display: flex;
  gap: 12px;
  align-items: center;
  min-width: 0;
}
.side.r {
  flex-direction: row-reverse;
}
.side :deep(.big) {
  width: 64px;
  height: 64px;
}
.t {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.25;
}
.s {
  font-size: 12px;
  color: var(--ink-2);
  margin-top: 3px;
  line-height: 1.3;
}
.mid {
  text-align: center;
}
.pct {
  font-family: 'Inter Tight', Inter, sans-serif;
  font-weight: 900;
  font-size: 24px;
}
.pct.lo {
  color: #b00020;
}
.nrow {
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 12px 14px;
  margin-bottom: 10px;
}
.nrow .lrow {
  padding: 8px 0;
}
@media (max-width: 720px) {
  .prow {
    grid-template-columns: 1fr;
  }
  .side.r {
    flex-direction: row;
  }
  .side.r > div {
    text-align: left !important;
  }
}
</style>
