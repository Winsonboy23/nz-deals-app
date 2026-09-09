// Phase 2b §9b「拿編號問原價」：後端每週一把清單／關注商品向各店查現價，存 store_prices（只有登入者的清單，訪客查不到是正常的）。
// 這裡按「你的店 × 清單 key」讀回來，給一站模式把「價格未知」變成真價格、接口沒回的標「此店沒賣」。
import { ref, shallowRef } from 'vue'
import { supabase } from '../lib/supabase'
import type { StorePrice } from '../lib/types'

const COLS = 'store_id,product_id,product_key,available,price,price_unit,was_price,is_special,club_only,multi_buy,unit_price,unit_price_unit,name,fetched_at'
/** `${store_id}|${product_key}` → 這家店這樣商品的價（同 key 多個編號時取有賣且最便宜的） */
const byStoreKey = shallowRef<Map<string, StorePrice>>(new Map())
const loading = ref(false)
let lastSig = ''

const dealOf = (p: StorePrice) => (p.multi_buy && p.multi_buy.qty > 0 ? p.multi_buy.total / p.multi_buy.qty : Number(p.price))

/** 抓 storeIds × keys 的現價。同樣的組合不重抓。 */
async function load(storeIds: string[], keys: string[]): Promise<void> {
  const sig = `${[...storeIds].sort().join(',')}#${[...keys].sort().join(',')}`
  if (sig === lastSig) return
  lastSig = sig
  if (!storeIds.length || !keys.length) {
    byStoreKey.value = new Map()
    return
  }
  loading.value = true
  try {
    const map = new Map<string, StorePrice>()
    for (let i = 0; i < keys.length; i += 100) {
      const { data, error } = await supabase.from('store_prices').select(COLS).in('store_id', storeIds).in('product_key', keys.slice(i, i + 100))
      if (error) return   // 表還沒建或斷線：當作沒有，UI 維持「價格未知」
      for (const raw of (data ?? []) as unknown as StorePrice[]) {
        if (!raw.product_key) continue
        const k = `${raw.store_id}|${raw.product_key}`
        const cur = map.get(k)
        const row: StorePrice = { ...raw, price: raw.price != null ? Number(raw.price) : null, was_price: raw.was_price != null ? Number(raw.was_price) : null, unit_price: raw.unit_price != null ? Number(raw.unit_price) : null }
        if (!cur || (row.available && (!cur.available || dealOf(row) < dealOf(cur)))) map.set(k, row)
      }
    }
    if (sig === lastSig) byStoreKey.value = map
  } finally {
    loading.value = false
  }
}

function priceAt(storeId: string, key: string | null): StorePrice | undefined {
  return key ? byStoreKey.value.get(`${storeId}|${key}`) : undefined
}

export function useStorePrices() {
  return { load, priceAt, loading, byStoreKey }
}
