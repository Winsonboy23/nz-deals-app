// 品名清洗（一站 v2，一站式購物改版規格 §4.1）：去自家牌、去規格、去跟食材無關的字，剩下拿來找「同一種食材」。
// 規則從後端 src/normalize/product-key.ts（STORE_BRANDS / NOISE / singular）與 name-match.ts（MATCH_JUNK）複製改寫，前端不能 import 後端檔。
// 不能刪的（會改變食材本身）：部位（breast、thigh、shoulder、belly、mince…）和處理方式（boneless、skin on、smoked、crumbed…）。

/** 超市自有品牌。長的放前面（pams finest 不能只刪到 pams）。 */
const STORE_BRANDS = /\b(pams finest|the odd bunch|odd bunch|signature range|woolworths|countdown|essentials|macro|pams|value|gilmours|homebrand|select)\b/g
const SIZE = /\b\d+(?:\.\d+)?\s*(?:x\s*\d+(?:\.\d+)?\s*)?(?:kg|kgs|g|gm|gms|grams?|ml|l|lt|litres?|liters?|pk|packs?|each|ea|pcs?|pieces?)\b/g
/** 廢字：後端 NOISE + name-match 的 MATCH_JUNK + 「放養／有機／大顆」這類不改變是哪種食材的形容 */
const NOISE = new Set([
  'fresh', 'nz', 'new', 'zealand', 'premium', 'the', 'and', 'of', 'with', 'in', 'a', 'per', 'each', 'ea', 'pack', 'pk', 'tray', 'bag',
  'instore', 'style', 'range', 'min', 'order', 'minimum', 'loose', 'everyday', 'vegetable', 'vegetables', 'fruit', 'produce', 'head',
  'free', 'farmed', 'organic', 'certified', 'natural', 'large', 'small', 'medium', 'jumbo', 'prepacked', 'prepack', 'kg',
])

const singular = (t: string) => (t.length <= 3 || /(ss|us|is|ous)$/.test(t) ? t : /ies$/.test(t) ? t.slice(0, -3) + 'y' : /s$/.test(t) ? t.slice(0, -1) : t)

/** 清洗後的字（小寫、原本順序、還沒單數化）。brand 給了就把品牌的字也去掉。 */
function rawWords(name: string, brand?: string | null): string[] {
  const brandWords = new Set((brand ?? '').toLowerCase().replace(STORE_BRANDS, ' ').split(/[^a-z0-9]+/).filter(Boolean))
  const text = name
    .toLowerCase()
    .replace(/\(minimum[^)]*\)/g, ' ')
    .replace(/\bmin(?:imum)?\.?\s*order\b.*$/, ' ')
    .replace(SIZE, ' ')
    .replace(STORE_BRANDS, ' ')
  const seen = new Set<string>()
  return text
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !NOISE.has(w) && !brandWords.has(w) && !seen.has(w) && !!seen.add(w))
}

/** "Woolworths Essentials Chicken Breast Pieces" → "chicken breast pieces" */
export function nameClean(name: string, brand?: string | null): string {
  return rawWords(name, brand).join(' ')
}

/** 比對用的字：清洗 + 單數化 */
export function cleanWords(name: string, brand?: string | null): string[] {
  return [...new Set(rawWords(name, brand).map(singular))]
}

/** 拿去 ilike 搜的字：前兩個有辨識度的（≥ 3 個字母）。複數去掉尾巴，berries → berr 才搜得到 berry / berries。 */
export function searchWords(name: string, brand?: string | null): string[] {
  return rawWords(name, brand)
    .filter((w) => w.length >= 3 && !/\d/.test(w))
    .slice(0, 2)
    .map((w) => (/ies$/.test(w) ? w.slice(0, -3) : /[^s]s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w))
}

/** 部位：清單寫了雞胸，就不能拿雞腿當替代品（候選寫了別的部位才擋；沒寫部位的「Pork Boneless Roast」可以） */
const CUTS = new Set(['breast', 'thigh', 'drumstick', 'wing', 'nibble', 'leg', 'shoulder', 'belly', 'loin', 'rump', 'sirloin', 'scotch', 'fillet', 'tenderloin', 'brisket', 'chuck', 'shank', 'rib', 'cutlet', 'mince', 'schnitzel'])
/** 處理方式：清單沒寫的，候選寫了就不算同一種食材（生雞胸不拿煙燻雞胸、雞肉串替代） */
const PROCESS = new Set(['crumbed', 'smoked', 'marinated', 'cooked', 'kebab', 'satay', 'stuffed', 'filled', 'seasoned', 'glazed', 'battered', 'shredded', 'canned', 'dried', 'flavoured'])

/** 清單項目的字有幾成出現在候選裡（0–1）。部位不同、或候選多了清單沒有的處理方式 → 0。 */
export function coverage(item: string[], cand: string[]): number {
  if (!item.length) return 0
  const c = new Set(cand)
  const itemCuts = item.filter((w) => CUTS.has(w))
  const candCuts = cand.filter((w) => CUTS.has(w))
  if (itemCuts.length && candCuts.length && !itemCuts.some((w) => c.has(w))) return 0
  const i = new Set(item)
  if (cand.some((w) => PROCESS.has(w) && !i.has(w))) return 0
  return item.filter((w) => c.has(w)).length / item.length
}
