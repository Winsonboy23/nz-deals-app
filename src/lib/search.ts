// 搜尋比對（2026-09-24）：以前整句連續比對，在貨架抄回來的名字差一個字就找不到
// （「Heat and Eat Fish Pie」對「Heat & Eat Tuna Fish Pie」、「WW Grated Tasty Cheese」對「Woolworths Tasty Cheese Grated」）。
// 現在拆成單字一個一個對，對到一半以上就列，對到越多排越前面。
// 這個檔不 import 任何執行期的東西，tests/search.test.ts 才能直接用 node 跑。
import type { Special } from './types'

/** 丟掉的字：& 會先換成 and，Thick n Creamy 的 n 也一樣 */
const STOP = new Set(['and', 'n', 'with', 'the', 'of'])
/** 縮寫：貨架和收據上常寫 WW */
const ALIAS: Record<string, string> = { ww: 'woolworths' }
/** 帶數字的規格：330g、1.5L、295mL */
const SIZE = /^(\d+(?:\.\d+)?)(g|kg|ml|l)$/

/** 列出來的最低分：needle 的字對到一半 */
export const MIN_SCORE = 0.5
/** 規格對到只加一點點：排序時贏同分的，不會讓沒過半的過門檻 */
const SIZE_BONUS = 0.001

/** 330g → 330g、1kg → 1000g、1.5L → 1500ml；不是規格回 null */
function sizeOf(tok: string): string | null {
  const m = SIZE.exec(tok)
  if (!m) return null
  const n = parseFloat(m[1])
  const u = m[2]
  if (u === 'kg') return `${n * 1000}g`
  if (u === 'l') return `${n * 1000}ml`
  return `${n}${u}`
}

/**
 * 小寫、& → and、符號當空白、ww → woolworths、「330 g」併成「330g」。停用字還在，呼叫的人自己丟。
 * 撇號直接拿掉不當空白：Arnott's ↔ Arnotts 才對得上，也不會多出一個對不到的「s」。
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/(\d)\s+(kg|g|ml|l)(?![\p{L}\p{N}])/gu, '$1$2')
    .split(/[^\p{L}\p{N}.]+/u)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .map((w) => ALIAS[w] ?? w)
}

export interface Query {
  /** 要對的字（規格以外） */
  words: string[]
  /** 規格，換算成 g / ml */
  sizes: string[]
}

/** 打的字不到 2 個字元就不搜（跟以前一樣） */
export function parseQuery(q: string): Query | null {
  const raw = q.trim()
  if (raw.length < 2) return null
  const all = tokenize(raw)
  const kept = all.filter((w) => !STOP.has(w))
  const words: string[] = []
  const sizes: string[] = []
  for (const w of kept.length ? kept : all) {
    const s = sizeOf(w)
    if (s) sizes.push(s)
    else words.push(w)
  }
  // 只打了規格（「330g」）：當成一般的字對
  if (!words.length) return { words: kept.length ? kept : all, sizes: [] }
  return { words, sizes }
}

/** 一樣，或短的那個是長的字首（snack ↔ snacka，兩個方向都算），短的至少 3 個字 */
function wordHit(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && long.startsWith(short)
}

type Hay = Pick<Special, 'brand' | 'name' | 'size'>

/**
 * 0–1：needle 的字有幾成在商品名裡對到（品牌 + 品名 + 規格）。規格對到再加一點點，對不到不扣。
 * 只打一個字時照以前：字首對到 1、只是字串裡剛好有 0.5（milk 也找得到 buttermilk，排在後面）。
 */
export function matchScore(q: Query, s: Hay): number {
  const hay = tokenize(`${s.brand ?? ''} ${s.name} ${s.size ?? ''}`)
  if (q.words.length === 1 && !q.sizes.length) {
    const w = q.words[0]
    if (hay.some((h) => h.startsWith(w))) return 1
    return hay.join(' ').includes(w) ? 0.5 : 0
  }
  let hit = 0
  for (const w of q.words) if (hay.some((h) => wordHit(w, h))) hit++
  let score = hit / q.words.length
  if (q.sizes.length) {
    const have = new Set(hay.map(sizeOf).filter(Boolean))
    if (q.sizes.some((z) => have.has(z))) score += SIZE_BONUS
  }
  return score
}
