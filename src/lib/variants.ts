// 商品頁「口味 / 規格」按鈕（2026-11-05 Chris 待修第 5 項）：把品名拆成「口味」和「規格」，
// 順序固定（口味 → 容量，同口味排一起），標籤統一寫「口味 · 規格」。純函式，tests/variants.test.ts 用 node --test 跑。
//
// 規格認三種寫法（大小寫不分）：「4 x 250ml」（幾個 × 每個多少）、「500ml」「1.5kg」、「26 Pack」「10 Sachets」「6pk」。
// 容量統一換成 g／ml 來排：kg → ×1000、L → ×1000、多件相乘。只有件數的用件數排在同口味的後面。

export interface VariantParts {
  /** 去掉規格字之後剩下的字（原順序） */
  flavourWords: string[]
  /** 規格字照品名的寫法（「4 x 250ml」「26 Pack」）；沒認出來是空字串 */
  size: string
  /** 總容量（g 或 ml）；沒有容量是 0 */
  amount: number
  /** 件數；沒寫是 1 */
  count: number
}

const UNIT_RE = '(kg|g|ml|l|litres?|liters?)'
const MULTI = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(?:x|×)\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE}\\b`, 'i')
const SINGLE = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE}\\b`, 'i')
const PACK = /\b(\d+)\s*(?:x\s*)?(pack|pk|pcs?|pieces?|each|ea|sachets?|capsules?|pods?|bags?|rolls?|tablets?|serves?|cans?|bottles?)\b/i

function toBase(qty: number, unit: string): number {
  const u = unit.toLowerCase()
  if (u === 'kg' || u.startsWith('l')) return qty * 1000
  return qty
}

/** 規格字統一寫法：單位小寫（500mL → 500ml）、x 前後一個空格、Litre → l */
function tidySize(s: string): string {
  return s.replace(/\s*(x|×)\s*/i, ' x ').replace(/(\d)\s*(kg|g|ml|l|litres?|liters?)\b/gi, (_, n, u) => n + (u.toLowerCase().startsWith('l') && u.length > 1 ? 'l' : u.toLowerCase()))
}

export function parseVariant(name: string): VariantParts {
  let rest = name
  let size = ''
  let amount = 0
  let count = 1
  const m = MULTI.exec(rest)
  if (m) {
    count = Number(m[1])
    amount = count * toBase(Number(m[2]), m[3])
    size = tidySize(m[0].trim())
    rest = rest.replace(m[0], ' ')
  } else {
    const all = [...rest.matchAll(new RegExp(SINGLE.source, 'gi'))]
    const s = all[all.length - 1]   // 寫了兩個容量的（Strawberry Crush 250ml Cans 500mL）用最後那個
    if (s) {
      amount = toBase(Number(s[1]), s[2])
      size = tidySize(s[0].trim())
      rest = rest.replace(s[0], ' ')
    }
  }
  const p = PACK.exec(rest)
  if (p) {
    count = Number(p[1])
    size = size ? `${size} · ${p[0].trim()}` : p[0].trim()
    rest = rest.replace(p[0], ' ')
  }
  // 品名裡還剩的規格字（「Strawberry Crush 250ml Cans 500mL」這種寫兩個的）和落單的 x 不當口味
  rest = rest.replace(new RegExp(SINGLE.source, 'gi'), ' ').replace(/\b(x|×)\b/gi, ' ')
  const flavourWords = rest.split(/\s+/).map((w) => w.replace(/^[(),]+|[(),]+$/g, '')).filter(Boolean)
  return { flavourWords, size, amount, count }
}

export interface VariantRow<T> {
  item: T
  label: string
  /** 排序與分組用：口味字小寫、去重、排過序 */
  flavourKey: string
}

/**
 * 一組同品牌商品 → 按鈕列。一半以上的款都有的字（品牌名、「Drink」「Sachets」）不算口味；口味的字序不同（Caramel Sachets / Sachets Caramel）
 * 當同一個口味，顯示用第一次出現的寫法。排序：口味 → 總容量 → 件數 → 原名。
 */
export function variantRows<T>(items: T[], nameOf: (x: T) => string, ignore: string[] = []): Array<VariantRow<T>> {
  const parsed = items.map((item) => ({ item, name: nameOf(item), ...parseVariant(nameOf(item)) }))
  const lower = parsed.map((p) => p.flavourWords.map((w) => w.toLowerCase()))
  // 不算口味的字：八成以上的款都有的（品牌名、Drink）——V 七款裡 Guarana 只有五款有，要留；兩三款的時候要全部都有才算；
  // 再加上呼叫端給的 ignore（同類名的字：instant latte、energy drink）
  const need = parsed.length >= 4 ? Math.ceil(parsed.length * 0.8) : parsed.length
  const freq = new Map<string, number>()
  for (const ws of lower) for (const w of new Set(ws)) freq.set(w, (freq.get(w) ?? 0) + 1)
  const common = new Set([...(parsed.length > 1 ? [...freq].filter(([, n]) => n >= need).map(([w]) => w) : []), ...ignore.map((w) => w.toLowerCase())])
  const firstLabel = new Map<string, string>()
  const rows = parsed.map((p, i) => {
    const words = p.flavourWords.filter((_, k) => !common.has(lower[i][k]))
    const flavourKey = [...new Set(words.map((w) => w.toLowerCase()))].sort().join(' ')
    if (!firstLabel.has(flavourKey)) firstLabel.set(flavourKey, words.join(' '))
    return { ...p, flavourKey }
  })
  // 沒寫容量的（26 Pack）排在同口味有容量的後面
  const am = (r: { amount: number }) => r.amount || Number.MAX_SAFE_INTEGER
  // 排序看顯示的口味字（原字序），不看 flavourKey（那是排過序的字，「Pineapple & Watermelon」會因為 & 跑到最前面）
  const fl = (r: { flavourKey: string }) => (firstLabel.get(r.flavourKey) ?? '').replace(/[^\p{L}\p{N} ]/gu, '')
  rows.sort((a, b) =>
    fl(a).localeCompare(fl(b)) || am(a) - am(b) || a.count - b.count || a.name.localeCompare(b.name),
  )
  return rows.map((r) => {
    const flavour = firstLabel.get(r.flavourKey) ?? ''
    const label = flavour && r.size ? `${flavour} · ${r.size}` : flavour || r.size || r.name
    return { item: r.item, label, flavourKey: r.flavourKey }
  })
}
