// 我的 → 會員卡：使用者的超市會員卡，到店裡打開給店員掃。只存號碼、不存圖（截圖是個資；App 自己畫條碼，掃得比截圖穩）。
// 只給登入者：存在 loyalty_cards（migrations/007-loyalty-cards.sql，RLS 只有本人讀寫），跨裝置都在；訪客是空的。登入狀態變了就重讀。
// 2026-10-01 Chris 規格：New World、PAK'nSAVE（和 Four Square）共用同一張 Club+（2026-06-15 上線，舊的 New World Clubcard 07-26 停用），
// 兩家的卡合併成一張 'clubplus'（migrations/010-loyalty-clubplus.sql 把舊資料改掉）。
import { ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { t } from './useI18n'

export type CardChain = 'clubplus' | 'woolworths' | 'other'

export interface LoyaltyCard {
  id: string
  chain: CardChain
  /** 自訂名稱（其他用；Club+、Everyday Rewards 是 null） */
  label: string | null
  /** 條碼內容（號碼） */
  code: string
  /** 畫條碼用的 JsBarcode 格式：EAN13 / CODE128 / CODE39 / UPC / ITF */
  format: string
  position: number
}
export type NewCard = Pick<LoyaltyCard, 'chain' | 'label' | 'code' | 'format'>

/** 資料庫的 chain → 卡別。舊值 newworld / paknsave（10-01 前存的、或還開著舊版 App 的人存的）一律當 Club+ */
function toChain(chain: string): CardChain {
  if (chain === 'clubplus' || chain === 'newworld' || chain === 'paknsave') return 'clubplus'
  return chain === 'woolworths' ? 'woolworths' : 'other'
}
const fromRow = (r: LoyaltyCard): LoyaltyCard => ({ ...r, chain: toChain(r.chain) })

/** 卡面上的名字：Club+、Everyday Rewards；其他是自訂名稱 */
export function cardTitle(c: Pick<LoyaltyCard, 'chain' | 'label'>): string {
  if (c.chain === 'clubplus') return 'Club+'
  if (c.chain === 'woolworths') return 'Everyday Rewards'
  return c.label || t('cards.other')
}
/** 卡面底色的 class：cp（Club+ 深色卡面）、ww（綠超色）、other（深灰） */
export function cardCls(c: Pick<LoyaltyCard, 'chain'>): string {
  return c.chain === 'clubplus' ? 'cp' : c.chain === 'woolworths' ? 'ww' : 'other'
}

const COLS = 'id,chain,label,code,format,position'
const { user } = useAuth()
const cards = ref<LoyaltyCard[]>([])
const loading = ref(false)
let started = false

async function load(): Promise<void> {
  const uid = user.value?.id
  if (!uid) {
    cards.value = []
    return
  }
  loading.value = true
  try {
    const { data, error } = await supabase.from('loyalty_cards').select(COLS).eq('user_id', uid).order('position').order('created_at')
    // 讀的時候登出或換了帳號 → 這份不是他的，丟掉
    if (!error && user.value?.id === uid) cards.value = ((data ?? []) as LoyaltyCard[]).map(fromRow)
  } finally {
    loading.value = false
  }
}

/** 新卡排最後。存成功回 true。 */
async function add(c: NewCard): Promise<boolean> {
  const uid = user.value?.id
  if (!uid) return false
  const position = cards.value.reduce((m, x) => Math.max(m, x.position + 1), 0)
  const { data, error } = await supabase.from('loyalty_cards').insert({ ...c, user_id: uid, position }).select(COLS).single()
  if (error || !data) return false
  cards.value = [...cards.value, fromRow(data as LoyaltyCard)]
  return true
}

async function remove(id: string): Promise<void> {
  cards.value = cards.value.filter((c) => c.id !== id)   // 先改畫面再打網路
  const { error } = await supabase.from('loyalty_cards').delete().eq('id', id)
  if (error) await load()   // 沒刪掉 → 照資料庫的重來
}

/** 跟上一張（dir = -1）或下一張（+1）對調。位置重編成 0, 1, 2…，只寫有變的。 */
async function move(id: string, dir: -1 | 1): Promise<void> {
  const list = [...cards.value]
  const i = list.findIndex((c) => c.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  const [c] = list.splice(i, 1)
  list.splice(j, 0, c)
  const before = new Map(cards.value.map((x) => [x.id, x.position]))
  cards.value = list.map((x, position) => ({ ...x, position }))
  const changed = cards.value.filter((x) => before.get(x.id) !== x.position)
  const res = await Promise.all(changed.map((x) => supabase.from('loyalty_cards').update({ position: x.position }).eq('id', x.id)))
  if (res.some((r) => r.error)) await load()
}

function start(): void {
  if (started) return
  started = true
  watch(() => user.value?.id, () => void load(), { immediate: true })
}

export function useCards() {
  start()
  return { cards, loading, load, add, remove, move }
}
