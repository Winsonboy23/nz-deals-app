// 登入後：選的店、清單、關注 跟帳號同步（CLAUDE.md §7 會員表）。
// 規則：訪客的店和清單在登入時「合併」進帳號（聯集，店最多 5 間）；之後本機一改就推上去；帳號是真相。
import { ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useStores, MAX_STORES, onePerChain } from './useStores'
import { useList, type ListItem } from './useList'

const { user } = useAuth()
const { selectedIds } = useStores()
const { items } = useList()

const watched = ref<Set<string>>(new Set())
const listId = ref<string | null>(null)
const shareToken = ref<string | null>(null)
/** 剛登入、把訪客資料合併進帳號了 → 畫面提示一次 */
const merged = ref(false)
let pulling = false
let pushTimer: ReturnType<typeof setTimeout> | null = null
let started = false

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`)

interface ListRow { id: string; product_key: string | null; free_text: string | null; qty: number | null; checked: boolean | null; position: number | null; price?: number | null }
const toItem = (r: ListRow): ListItem => ({ id: r.id, key: r.product_key, name: r.free_text ?? r.product_key ?? '', qty: Number(r.qty ?? 1), checked: !!r.checked, price: r.price != null ? Number(r.price) : null })
const toRow = (i: ListItem, idx: number) => ({ id: i.id, list_id: listId.value, product_key: i.key, free_text: i.name, qty: i.qty, checked: i.checked, source: i.key ? 'special' : 'manual', position: idx, price: i.price ?? null })
const LIST_COLS = 'id,product_key,free_text,qty,checked,position,price'

async function pull(uid: string): Promise<void> {
  pulling = true
  try {
    let didMerge = false
    // 店：帳號的在前，本機沒在帳號裡的補上；每家超市只留一間、最多 3 間
    const us = await supabase.from('user_stores').select('store_id,position').eq('user_id', uid).order('position')
    const accountStores = (us.data ?? []).map((r) => r.store_id as string)
    const union = onePerChain([...accountStores, ...selectedIds.value]).slice(0, MAX_STORES)
    if (union.join() !== accountStores.join()) {
      await supabase.from('user_stores').delete().eq('user_id', uid)
      if (union.length) await supabase.from('user_stores').insert(union.map((store_id, position) => ({ user_id: uid, store_id, position })))
      if (accountStores.length) didMerge = true
    }
    if (union.join() !== selectedIds.value.join()) { selectedIds.value = union; if (accountStores.length) didMerge = true }

    // 清單：一人一份預設清單
    let list = (await supabase.from('shopping_lists').select('id,share_token').eq('user_id', uid).order('created_at').limit(1)).data?.[0]
    if (!list) list = (await supabase.from('shopping_lists').insert({ user_id: uid }).select('id,share_token').single()).data ?? undefined
    if (!list) return
    listId.value = list.id
    shareToken.value = list.share_token ?? null
    // price 欄是 2026-09-09 加的（schema-ai-history.sql）；沒加就退回舊欄位
    let sel: { data: unknown; error: unknown } = await supabase.from('list_items').select(LIST_COLS).eq('list_id', list.id).order('position')
    if (sel.error) sel = await supabase.from('list_items').select('id,product_key,free_text,qty,checked,position').eq('list_id', list.id).order('position')
    const rows = ((sel.data as ListRow[] | null) ?? [])
    const account = rows.map(toItem)
    const local = items.value.map((i) => (isUuid(i.id) ? i : { ...i, id: uuid() }))
    const seen = new Set(account.map((i) => i.key ?? `t:${i.name.toLowerCase()}`))
    const extra = local.filter((i) => !seen.has(i.key ?? `t:${i.name.toLowerCase()}`))
    const mergedItems = [...account, ...extra]
    if (extra.length && account.length) didMerge = true
    items.value = mergedItems
    if (extra.length) await pushList()

    // 關注
    const w = await supabase.from('watchlist').select('product_key').eq('user_id', uid)
    watched.value = new Set((w.data ?? []).map((r) => r.product_key as string))
    merged.value = didMerge
  } finally {
    pulling = false
  }
}

async function pushStores(): Promise<void> {
  const uid = user.value?.id
  if (!uid || pulling) return
  await supabase.from('user_stores').delete().eq('user_id', uid)
  if (selectedIds.value.length) await supabase.from('user_stores').insert(selectedIds.value.map((store_id, position) => ({ user_id: uid, store_id, position })))
}

async function pushList(): Promise<void> {
  const uid = user.value?.id
  if (!uid || !listId.value) return
  const rows = items.value.map(toRow)
  if (rows.length) {
    let { error } = await supabase.from('list_items').upsert(rows, { onConflict: 'id' })
    // product_key 不在 products 裡（FK）→ 當自由輸入存
    if (error) ({ error } = await supabase.from('list_items').upsert(rows.map((r) => ({ ...r, product_key: null })), { onConflict: 'id' }))
    // price 欄還沒加 → 不存價格
    if (error) await supabase.from('list_items').upsert(rows.map(({ price: _p, ...r }) => ({ ...r, product_key: null })), { onConflict: 'id' })
  }
  const keep = rows.map((r) => r.id)
  const q = supabase.from('list_items').delete().eq('list_id', listId.value)
  await (keep.length ? q.not('id', 'in', `(${keep.join(',')})`) : q)
}
function schedulePush(): void {
  if (pulling || !user.value) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void pushList(), 800)
}

async function toggleWatch(key: string): Promise<void> {
  const uid = user.value?.id
  if (!uid) return
  // 先改畫面再打網路：連按兩個才不會互相蓋掉
  const next = new Set(watched.value)
  const removing = next.has(key)
  if (removing) next.delete(key)
  else next.add(key)
  watched.value = next
  if (removing) await supabase.from('watchlist').delete().eq('user_id', uid).eq('product_key', key)
  else await supabase.from('watchlist').upsert({ user_id: uid, product_key: key }, { onConflict: 'user_id,product_key' })
}
const isWatched = (key: string) => watched.value.has(key)

/** 分享連結：第一次按就產生 token，之後同一條。 */
async function shareUrl(): Promise<string | null> {
  if (!listId.value) return null
  if (!shareToken.value) {
    const token = uuid().replace(/-/g, '').slice(0, 16)
    const { error } = await supabase.from('shopping_lists').update({ share_token: token }).eq('id', listId.value)
    if (error) return null
    shareToken.value = token
  }
  return `${location.origin}${location.pathname}#/s/${shareToken.value}`
}

function start(): void {
  if (started) return
  started = true
  watch(user, (u, prev) => {
    if (u && u.id !== prev?.id) void pull(u.id)
    if (!u) { watched.value = new Set(); listId.value = null; shareToken.value = null; merged.value = false }
  }, { immediate: true })
  watch(selectedIds, () => { if (user.value && !pulling) void pushStores() })
  watch(items, schedulePush, { deep: true })
}

export function useSync() {
  start()
  return { watched, isWatched, toggleWatch, shareUrl, merged, listId }
}
