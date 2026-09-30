// 首頁「你本週已省下 $XX」（2026-09-30，Phase 6 #18）。純函式，tests/savings.test.ts 用 node --test 直接跑。
import type { Special } from './types'

/** ISO 時間 → 紐西蘭日期 YYYY-MM-DD，才能跟 week.ts 的 nzMonday() 比。
 *  跟 week.ts 的 ymd 同一個寫法；抄一份是因為 node --test 不能 import 沒副檔名的路徑。 */
const nzDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' })

/** 清單一項用到的欄位（useList 的 ListItem） */
interface Ticked { key: string | null; qty: number; checked: boolean; checkedAt?: string | null }
/** 一個 key 在你的店最便宜的那筆特價（useSpecials 的 Group.best），只看價格這幾欄 */
type BestOf = (key: string) => { special: Pick<Special, 'store_id' | 'price' | 'was_price'> } | undefined

export interface Saved {
  /** 省下多少，四捨五入到分 */
  amount: number
  /** 算進去幾樣 */
  counted: number
  /** 這週打勾了、但沒原價所以沒算的幾樣（黃超、這週沒特價、自由輸入…） */
  uncounted: number
}

/**
 * 這週（打勾時間 ≥ 這週一，紐西蘭時間）打勾買到的，有原價而且原價 > 特價的，算 (原價 − 特價) × 數量。
 * 特價用卡片上的單件價 special.price，多件優惠不另算。黃超的原價畫面上從不顯示（format.ts wasPriceOf），這裡也不算。
 * 上週打勾的日期 < 這週一，所以每週一自然歸零，不用另外清。
 */
export function savedThisWeek(items: Ticked[], bestOf: BestOf, monday: string): Saved {
  let amount = 0
  let counted = 0
  let uncounted = 0
  for (const i of items) {
    if (!i.checked || !i.checkedAt || nzDate.format(new Date(i.checkedAt)) < monday) continue
    const s = i.key ? bestOf(i.key)?.special : undefined
    const was = s && !s.store_id.startsWith('paknsave:') ? s.was_price : null
    if (!s || was == null || was <= s.price) {
      uncounted++
      continue
    }
    amount += (was - s.price) * i.qty
    counted++
  }
  return { amount: Math.round(amount * 100) / 100, counted, uncounted }
}
