// 規則 key（跨店同一樣的 key），照後端 src/normalize/product-key.ts 的 ruleKey 與 src/normalize/brands.ts 的 HOUSE_BRAND_PHRASES 一字不改搬過來。
// 自由輸入配對到超市網站搜到的商品時（一站式購物改版規格 §4.3），App 要先用這把 key 呼叫 adopt_product，
// 之後這個商品上了特價，後端算出來的 key 才會跟清單裡的一樣。所以這裡不能「改良」：後端改了這裡要跟著改（tests/rulekey.test.ts 有對照例子）。
// 這個檔不 import 任何東西，tests 才能直接用 node 跑。

/** 自家牌：就是後端 HOUSE_BRAND_PHRASES，**不含** pams finest（Pams Finest 跟一般 Pams 是兩個商品） */
const HOUSE_BRAND_PHRASES = ['the odd bunch', 'odd bunch', 'signature range', 'homebrand', 'gilmours', 'select', 'macro', 'essentials', 'countdown', 'woolworths', 'pams', 'value']
const STORE_BRANDS = new RegExp(`\\b(${[...HOUSE_BRAND_PHRASES].sort((a, b) => b.length - a.length).join('|')})\\b`, 'g')
const NOISE = new Set(['fresh', 'nz', 'new', 'zealand', 'premium', 'the', 'and', 'of', 'with', 'in', 'a', 'per', 'each', 'ea', 'pack', 'pk', 'tray', 'bag', 'instore', 'style', 'range', 'min', 'order'])
const SIZE_RE = /(\d+(?:\.\d+)?)\s?(kg|g|ml|l|litre|pk|pack|each|ea|sheets?|rolls?)\b/gi
const MULTI_RE = /(\d+)\s?x\s?(\d+(?:\.\d+)?)\s?(kg|g|ml|l|pk|sheets?)\b/i
const normUnit = (u: string) => (({ litre: 'l', pack: 'pk', each: 'ea', sheet: 'sheets', roll: 'rolls' }) as Record<string, string>)[u.toLowerCase()] ?? u.toLowerCase()
const singular = (t: string) => (t.length <= 3 || /(ss|us|is|ous)$/.test(t) ? t : /ies$/.test(t) ? t.slice(0, -3) + 'y' : /s$/.test(t) ? t.slice(0, -1) : t)

function extractSize(text: string): string | undefined {
  const m = text.match(MULTI_RE)
  if (m) return `${m[1]}x${m[2]}${normUnit(m[3])}`
  const all = [...text.matchAll(SIZE_RE)]
  if (!all.length) return undefined
  const last = all[all.length - 1]
  return `${last[1]}${normUnit(last[2])}`
}

/** 後端 RawSpecial 的四個欄位；catalog / search_results 的列直接給（price_unit → priceUnit） */
export interface KeySource {
  brand?: string | null
  name: string
  size?: string | null
  priceUnit?: string | null
}

/** "Woolworths Butter Salted 500g" → "butter_salted_500g" */
export function ruleKey(s: KeySource): string {
  let text = `${s.brand ?? ''} ${s.name}`.toLowerCase()
  const perKg = s.priceUnit === 'kg' || s.size === 'kg'
  const size = (s.size && s.size !== 'kg' ? extractSize(s.size) ?? s.size.replace(/\s+/g, '').toLowerCase() : undefined) ?? extractSize(text)
  text = text.replace(MULTI_RE, ' ').replace(SIZE_RE, ' ').replace(/min order.*$/, ' ').replace(STORE_BRANDS, ' ')
  const tokens = [...new Set(text.replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length > 1 && !NOISE.has(t)).map(singular))].sort()
  return [...tokens, size ?? (perKg ? 'kg' : '')].filter(Boolean).join('_')
}
