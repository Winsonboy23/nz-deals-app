export type ChainId = 'newworld' | 'woolworths' | 'paknsave'
export type ChainClass = 'nw' | 'ww' | 'pns'

export interface Store {
  id: string
  chain_id: ChainId
  store_id: string
  name: string
  region: string | null
  lat: number | null
  lng: number | null
  online_shopping: boolean
  last_fetched_at: string | null
}

export interface MultiBuy {
  qty: number
  total: number
}

export interface Special {
  store_id: string
  product_id: string
  product_key: string | null
  /** 同類可比 key（products.family_key）；舊快取或欄位還沒加時是 null */
  family_key: string | null
  family_name_en: string | null
  family_name_zh: string | null
  name: string
  brand: string | null
  size: string | null
  price: number
  price_unit: string
  was_price: number | null
  unit_price: number | null
  unit_price_unit: string | null
  multi_buy: MultiBuy | null
  promo_type: string | null
  club_only: boolean
  category_id: string | null
  image_url: string | null
  product_url: string | null
}

/** store_prices 一列：後端週一「拿編號問原價」查到的某店現價（Phase 2b §9b）。available=false = 這家店沒賣。 */
export interface StorePrice {
  store_id: string
  product_id: string
  product_key: string | null
  available: boolean
  price: number | null
  price_unit: string | null
  was_price: number | null
  is_special: boolean
  club_only: boolean
  multi_buy: MultiBuy | null
  unit_price: number | null
  unit_price_unit: string | null
  name: string | null
  fetched_at: string
}

export interface Category {
  id: string
  level: number
  parent_id: string | null
  name: string
}

/** One store's offer for a product_key. */
export interface Offer {
  store: Store
  special: Special
  /** price used for comparison: multi-buy unit price when there is one */
  deal: number
  unit: number | null
  unitUnit: string | null
}

/** All offers for one product_key across the selected stores. */
export interface Group {
  key: string
  offers: Offer[]
  best: Offer
  /** gap between cheapest and 2nd cheapest, in the metric used; null when < 2 offers */
  gap: number | null
  /** dollars saved on the shelf price by buying at the cheapest store; null when < 2 offers */
  payGap: number | null
  /** true when the comparison ran on unit price rather than shelf price */
  byUnit: boolean
  /** true when the unit price picked a different winner than the shelf price would have */
  unitDecided: boolean
}
