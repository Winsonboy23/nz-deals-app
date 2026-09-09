// AI 食譜前端（v3，docs/recipes-ai-design.md §5）：挑候選池、呼叫 Edge Function、本機每日額度、食譜紀錄。
// 模型只能從「錨」（你勾的食材）和「池」（你的店這週的特價）裡挑，回的是編號，所以價格和加清單都精確。
import { supabase } from './supabase'
import { readCache, writeCache } from './cache'
import { discountDepth } from './compare'
import { catLevel, chainShort, displayName } from './format'
import type { Group } from './types'

export interface Prefs {
  serves: number
  maxMinutes: number
  spice: 'mild' | 'medium' | 'hot'
  /** 喜好／不吃什麼，自由填 */
  notes: string
}
/** 你已經有的東西：清單裡勾的，或手打的。id 是 product_key，手打的用 free:<名字>。 */
export interface Anchor {
  id: string
  name: string
}
/** 候選池的一樣：你的店這週的特價。id 是 product_key。 */
export interface PoolItem {
  id: string
  name: string
  price: number
  store: string
}
export interface AiIngredient {
  /** 錨或池的編號；常備品和池外食材是 null */
  id: string | null
  name: string
  qty: string
  staple: boolean
  /** 生成當下的價格／店（池裡的才有） */
  price: number | null
  store: string | null
}
export interface AiRecipe {
  /** ai_recipes 的 id；表沒建時 null */
  dbId: string | null
  createdAt?: string
  title: string
  cuisine: string
  serves: number
  minutes: number
  kcal: number
  difficulty: 'easy' | 'medium' | 'hard'
  ingredients: AiIngredient[]
  steps: string[]
  tip: string
  /** Pexels 照片（後端搜的）；沒有就 null */
  image?: { url: string; photographer: string; link: string } | null
}

export const DEFAULT_PREFS: Prefs = { serves: 4, maxMinutes: 40, spice: 'mild', notes: '' }

/** 上次用的偏好，記在裝置上。 */
export function loadPrefs(): Prefs {
  const saved = readCache<Partial<Prefs> & { avoid?: string }>('ai:prefs') ?? {}
  return { ...DEFAULT_PREFS, ...saved, notes: saved.notes ?? saved.avoid ?? '' }
}
export function savePrefs(p: Prefs): void {
  writeCache('ai:prefs', p)
}

/** 本機每日次數。只是防手滑連按，真正的額度在 Edge Function（見 src/db/schema-ai-recipe.sql）。 */
const LOCAL_LIMIT = 20
function today(): string {
  return new Date().toISOString().slice(0, 10)
}
export function usedToday(): number {
  const u = readCache<{ day: string; n: number }>('ai:used')
  return u?.day === today() ? u.n : 0
}
function bumpLocal(): void {
  writeCache('ai:used', { day: today(), n: usedToday() + 1 })
}
export function localQuotaLeft(): number {
  return Math.max(0, LOCAL_LIMIT - usedToday())
}

export class AiError extends Error {
  constructor(public code: 'quota' | 'signIn' | 'few' | 'failed', message?: string) {
    super(message ?? code)
  }
}

/** dev 時可以指到本機 deno 或 mock（VITE_AI_RECIPE_URL=http://localhost:8000）。 */
const DEV_URL = import.meta.env.VITE_AI_RECIPE_URL as string | undefined
/** 預設開著。要臨時關掉就 build 時給 VITE_AI_RECIPE=off。 */
export const aiEnabled = import.meta.env.VITE_AI_RECIPE !== 'off'

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!localQuotaLeft()) throw new AiError('quota')
  let data: { error?: string } | null = null
  let status = 0
  if (DEV_URL) {
    const r = await fetch(DEV_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    status = r.status
    data = await r.json().catch(() => null)
  } else {
    const r = await supabase.functions.invoke('ai-recipe', { body })
    // supabase-js 把非 2xx 當錯誤，錯誤內容在 context.json()
    if (r.error) {
      const ctx = (r.error as { context?: Response }).context
      status = ctx?.status ?? 500
      data = ctx ? await ctx.json().catch(() => null) : null
    } else {
      status = 200
      data = r.data
    }
  }
  if (status === 401) throw new AiError('signIn')
  if (status === 429) throw new AiError('quota')
  if (status === 400 && data?.error === 'too_few_items') throw new AiError('few')
  if (status !== 200 || !data) throw new AiError('failed', `status ${status}`)
  bumpLocal()
  return data as T
}

/** 只有這幾個第一層分類算「食材」。飲料、零食、非食品不送給 AI（咖啡粉不是晚餐）。 */
const COOKING_L1 = new Set(['fruit-and-vegetables', 'meat-poultry-and-seafood', 'fridge-deli-and-eggs', 'bakery', 'frozen', 'pantry'])
export function isCookingCategory(categoryId: string | null): boolean {
  const l1 = catLevel(categoryId, 1)
  return !!l1 && COOKING_L1.has(l1)
}

/** 池的配額：每個第一層分類最多幾樣，加起來 40。 */
const POOL_QUOTA: Array<[string, number]> = [
  ['fruit-and-vegetables', 10],
  ['meat-poultry-and-seafood', 8],
  ['fridge-deli-and-eggs', 8],
  ['pantry', 10],
  ['frozen', 2],
  ['bakery', 2],
]
const rank = (a: Group, b: Group) => discountDepth(b.best.special) - discountDepth(a.best.special) || a.best.deal - b.best.deal

/**
 * 候選池：從你的店這週的特價挑約 40 樣。只挑烹飪分類；每個同類（family_key）只留最便宜的一樣；
 * 每個大類有配額，大類裡按小分類輪流挑（雞、牛、魚都會有，不會 8 樣全是雞）。
 */
export function buildPool(groups: Map<string, Group>, exclude: Set<string>): PoolItem[] {
  const byFamily = new Map<string, Group>()
  const loose: Group[] = []
  for (const g of groups.values()) {
    if (exclude.has(g.key) || !isCookingCategory(g.best.special.category_id)) continue
    const f = g.best.special.family_key
    if (!f) {
      loose.push(g)
      continue
    }
    const have = byFamily.get(f)
    if (!have || g.best.deal < have.best.deal) byFamily.set(f, g)
  }
  const buckets = new Map<string, Map<string, Group[]>>()
  for (const g of [...byFamily.values(), ...loose]) {
    const l1 = catLevel(g.best.special.category_id, 1) as string
    const l2 = catLevel(g.best.special.category_id, 2) ?? l1
    let m = buckets.get(l1)
    if (!m) buckets.set(l1, (m = new Map()))
    const list = m.get(l2)
    if (list) list.push(g)
    else m.set(l2, [g])
  }
  const out: PoolItem[] = []
  for (const [l1, quota] of POOL_QUOTA) {
    const lists = [...(buckets.get(l1)?.values() ?? [])].map((l) => l.sort(rank))
    let n = 0
    for (let i = 0; n < quota && lists.some((l) => i < l.length); i++) {
      for (const l of lists) {
        if (n >= quota) break
        const g = l[i]
        if (g) {
          out.push({ id: g.key, name: displayName(g.best.special), price: Math.round(g.best.deal * 100) / 100, store: chainShort(g.best.store.id) })
          n += 1
        }
      }
    }
  }
  return out
}

/** 按一次問一次，不快取（使用者是自己按的，每次都想看新的；後端每道都存進紀錄）。 */
export async function fetchRecipes(anchors: Anchor[], pool: PoolItem[], prefs: Prefs, lang: string): Promise<AiRecipe[]> {
  const out = await call<{ recipes: AiRecipe[] }>({ layer: 'recipes', anchors, pool, prefs, lang })
  return (out.recipes ?? []).map((r) => ({ ...r, dbId: r.dbId ?? null }))
}

// ---- 食譜紀錄（ai_recipes，RLS 只有本人） ----
interface Row {
  id: string
  created_at: string
  title: string
  cuisine: string | null
  serves: number | null
  minutes: number | null
  kcal: number | null
  difficulty: string | null
  ingredients: AiIngredient[] | null
  steps: string[] | null
  tip: string | null
  image_url: string | null
  image_credit: { photographer?: string; link?: string } | null
}
const COLS = 'id,created_at,title,cuisine,serves,minutes,kcal,difficulty,ingredients,steps,tip,image_url,image_credit'
const fromRow = (r: Row): AiRecipe => ({
  dbId: r.id,
  createdAt: r.created_at,
  title: r.title,
  cuisine: r.cuisine ?? '',
  serves: r.serves ?? 0,
  minutes: r.minutes ?? 0,
  kcal: r.kcal ?? 0,
  difficulty: (r.difficulty as AiRecipe['difficulty']) ?? 'easy',
  ingredients: r.ingredients ?? [],
  steps: r.steps ?? [],
  tip: r.tip ?? '',
  image: r.image_url ? { url: r.image_url, photographer: r.image_credit?.photographer ?? '', link: r.image_credit?.link ?? '' } : null,
})
export async function historyList(): Promise<AiRecipe[]> {
  const { data } = await supabase.from('ai_recipes').select(COLS).order('created_at', { ascending: false }).limit(100)
  return ((data ?? []) as unknown as Row[]).map(fromRow)
}
export async function historyGet(id: string): Promise<AiRecipe | null> {
  const { data } = await supabase.from('ai_recipes').select(COLS).eq('id', id).limit(1)
  const r = (data as unknown as Row[] | null)?.[0]
  return r ? fromRow(r) : null
}
export async function historyDelete(id: string): Promise<void> {
  await supabase.from('ai_recipes').delete().eq('id', id)
}
