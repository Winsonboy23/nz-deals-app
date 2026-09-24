// 規格與「需要多少」（一站 v2，一站式購物改版規格 §4.2）。
// 規格寫法從後端 src/normalize/product-key.ts（extractSize）與 name-match.ts（sizeQty）複製改寫——前端不能 import 後端檔（它們相依 openai / fs / db）。
// Woolworths 的 size 欄位永遠是 null，規格寫在品名尾端（"… Min Order 1.6kg"）；Foodstuffs 的 size 有值（"450g"、"kg"、"ea"、"6 x 330ml"）。

/** 一個規格：重量一律換成 g、容量換成 ml、顆／包換成 ea；{ unit: 'kg' } = 散裝、按公斤賣（沒寫多重） */
export type Size = { qty: number; unit: 'g' | 'ml' | 'ea' } | { unit: 'kg' }

/** 清單一項需要多少。pack = 不知道規格，只知道要「幾個」（item.qty 個） */
export interface Need {
  qty: number
  unit: 'g' | 'ml' | 'ea' | 'pack'
}

/** 算得出價錢的商品（特價、catalog、store_prices 共用的欄位） */
export interface Priced {
  name: string
  size?: string | null
  price: number
  price_unit?: string | null
  unit_price?: number | null
  unit_price_unit?: string | null
}

const MULTI = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i
const ONE = /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|grams?|ml|l|lt|litres?|liters?|pk|packs?|each|ea|pcs?|pieces?)\b/gi

function toSize(n: number, u: string): Size | null {
  if (!(n > 0)) return null
  const unit = u.toLowerCase()
  if (unit.startsWith('k')) return { qty: n * 1000, unit: 'g' }
  if (unit === 'g' || unit.startsWith('gm') || unit.startsWith('gram')) return { qty: n, unit: 'g' }
  if (unit === 'ml') return { qty: n, unit: 'ml' }
  if (unit === 'l' || unit === 'lt' || unit.startsWith('lit')) return { qty: n * 1000, unit: 'ml' }
  return { qty: n, unit: 'ea' }
}

/** "1.6kg" → 1600 g；"500 g"；"6 x 330ml" → 1980 ml；"6pk" / "6 Pack" → 6 ea；"ea" / "each" → 1 ea；"kg" / "per kg" → 散裝。抓不到 null。
 *  品名裡有好幾個規格時取最後一個（"(Minimum 5 Per Pack) 1kg" → 1kg）。 */
export function parseSize(text: string | null | undefined): Size | null {
  const s = (text ?? '').toLowerCase().trim()
  if (!s) return null
  const m = s.match(MULTI)
  if (m) return toSize(Number(m[1]) * Number(m[2]), m[3]!)
  const all = [...s.matchAll(ONE)]
  if (all.length) {
    const last = all[all.length - 1]!
    return toSize(Number(last[1]), last[2]!)
  }
  if (/(^|\s)(per\s+)?kg$/.test(s)) return { unit: 'kg' }
  if (/(^|\s)(ea|each)$/.test(s)) return { qty: 1, unit: 'ea' }
  return null
}

/** Foodstuffs 先看 size 欄位，再看品名；Woolworths 只有品名。 */
export function sizeOf(p: { name: string; size?: string | null }): Size | null {
  return parseSize(p.size) ?? parseSize(p.name)
}

/** 品名裡寫的個數：「Minimum 5 Per Pack」→ 5、「6pk」/「6 pack」→ 6、「min order 2」→ 2。抓不到 null。
 *  「Min Order 1.6kg」是重量不是個數，不算。 */
export function countGuess(text: string | null | undefined): number | null {
  const s = (text ?? '').toLowerCase()
  const m =
    s.match(/minimum\s+(\d+)\s+per\s+pack/) ??
    s.match(/\bmin(?:imum)?\.?\s*order\s*(?:of\s*)?(\d+)(?!\d|\.\d|\s*(?:kg|g|ml|l)\b)/) ??
    s.match(/\bpack\s+of\s+(\d+)\b/) ??
    s.match(/(\d+)\s*(?:pk|packs?|pcs?|pieces?)\b/) ??
    s.match(/(\d+)\s*(?:ea|each)\b/)
  const n = m ? Number(m[1]) : NaN
  return n >= 1 && n <= 100 ? n : null
}

const isKg = (p: { price_unit?: string | null }) => (p.price_unit ?? '').toLowerCase() === 'kg'

/** 按公斤賣的東西一份是幾公斤：品名寫了重量就用它（"Min Order 1.6kg" → 1.6），沒寫就 1。 */
export function kgOf(p: { name?: string | null; size?: string | null }): number {
  const s = sizeOf({ name: p.name ?? '', size: p.size })
  return s && 'qty' in s && s.unit === 'g' ? s.qty / 1000 : 1
}

/** 清單一項需要多少 = 規格 × 件數。ref 是這一項的參考商品（通常是它的特價）；
 *  按公斤賣的：寫了重量就用（1.6kg → 1600 g），沒寫就 1 kg。完全不知道規格 → pack（幾個）。 */
export function needed(item: { qty: number; name: string }, ref?: { name: string; size?: string | null; price_unit?: string | null } | null): Need {
  const p = ref ?? { name: item.name }
  if (isKg(p)) return { qty: kgOf(p) * 1000 * item.qty, unit: 'g' }
  const s = sizeOf(p)
  if (!s) return { qty: item.qty, unit: 'pack' }
  if (!('qty' in s)) return { qty: 1000 * item.qty, unit: 'g' }
  return { qty: s.qty * item.qty, unit: s.unit }
}

/** 這個商品一個「需要單位」（1 g / 1 ml / 1 顆 / 1 包）多少錢；單位對不上 null。 */
export function unitRate(unit: Need['unit'], p: Priced): number | null {
  const uu = (p.unit_price_unit ?? '').toLowerCase()
  const up = p.unit_price != null && p.unit_price > 0 ? p.unit_price : null
  const s = sizeOf(p)
  const sq = s && 'qty' in s ? s : null
  switch (unit) {
    case 'g':
      if (isKg(p)) return p.price / 1000
      if (sq?.unit === 'g') return p.price / sq.qty
      if (uu === 'kg' && up) return up / 1000
      return null
    case 'ml':
      if (isKg(p)) return null
      if (sq?.unit === 'ml') return p.price / sq.qty
      if ((uu === 'l' || uu === 'litre') && up) return up / 1000
      return null
    case 'ea':
      if (isKg(p)) return null
      if (sq?.unit === 'ea') return p.price / sq.qty
      if ((uu === 'each' || uu === 'ea') && up) return up
      if (!s && uu !== 'kg' && uu !== 'l') return p.price   // 沒寫規格、也不是按重量標價：一個就是一個
      return null
    case 'pack':
      return isKg(p) ? null : p.price
  }
}

/** 一顆一顆賣的（"Avocado ea"）：品名裡的個數才能當成要買幾顆 */
function single(p: Priced): boolean {
  if (isKg(p)) return false
  const s = sizeOf(p)
  if (s) return 'qty' in s && s.unit === 'ea' && s.qty === 1
  return (p.unit_price_unit ?? 'each').toLowerCase() === 'each'
}

export type Estimate = { cost: number; rate: number } | { needsCount: true; guess: number | null }

/** 替代品估算價 = 需要量 × 替代品單價。單位對不上（重量 vs 顆數）→ 要使用者填數量，
 *  替代品是一顆一顆賣的話，先從清單品名猜幾顆（「Minimum 5 Per Pack」→ 5 × 件數）。 */
export function estimate(need: Need, sub: Priced, item: { name: string; qty: number }): Estimate {
  const r = unitRate(need.unit, sub)
  if (r != null) return { cost: Math.round(r * need.qty * 100) / 100, rate: r }
  const g = single(sub) ? countGuess(item.name) : null
  return { needsCount: true, guess: g != null ? g * item.qty : null }
}

/** 實際要買的一包比需要量大（需要 400g、這包 600g）。按公斤賣的不算。給「剩下的做成明天的菜」提示用。 */
export function packBigger(need: Need, p: Priced): boolean {
  if (need.unit === 'pack' || isKg(p)) return false
  const s = sizeOf(p)
  return !!s && 'qty' in s && s.unit === need.unit && s.qty > need.qty * 1.05
}
