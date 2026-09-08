// AI 食譜前端：呼叫 Edge Function、快取、本機每日額度、把「要買」的食材對到本週特價。
import { supabase } from './supabase'
import { readCache, writeCache } from './cache'
import { nzMonday } from './week'

export interface Prefs {
  serves: number
  maxMinutes: number
  spice: 'mild' | 'medium' | 'hot'
  avoid: string
}
export interface Direction {
  cuisine_en: string
  cuisine_zh: string
  dish_en: string
  dish_zh: string
  why_en: string
  why_zh: string
  /** 0-based indexes into the items we sent */
  uses: number[]
  missing_en: string[]
  minutes: number
}
export interface AiIngredient {
  name_en: string
  name_zh: string
  qty_en: string
  qty_zh: string
  from: 'list' | 'buy' | 'staple'
  /** index into the items we sent, or -1 */
  list_index: number
}
export interface AiRecipe {
  title_en: string
  title_zh: string
  serves: number
  minutes: number
  difficulty: 'easy' | 'medium'
  ingredients: AiIngredient[]
  steps_en: string[]
  steps_zh: string[]
  tip_en: string
  tip_zh: string
}

export const DEFAULT_PREFS: Prefs = { serves: 4, maxMinutes: 40, spice: 'mild', avoid: '' }

/** 上次用的偏好，記在裝置上。 */
export function loadPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...(readCache<Partial<Prefs>>('ai:prefs') ?? {}) }
}
export function savePrefs(p: Prefs): void {
  writeCache('ai:prefs', p)
}

/** 裝置 id：訪客的額度算在這上面。清掉瀏覽器資料就重來，所以後端另外有一層。 */
function deviceId(): string {
  let id = readCache<string>('ai:device')
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    writeCache('ai:device', id)
  }
  return id
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
  constructor(public code: 'quota' | 'offline' | 'failed', message?: string) {
    super(message ?? code)
  }
}

/** dev 時可以指到本機 deno（VITE_AI_RECIPE_URL=http://localhost:8000）。 */
const DEV_URL = import.meta.env.VITE_AI_RECIPE_URL as string | undefined
/** 預設開著（Edge Function ai-recipe 2026-09-08 已上線）。要臨時關掉就 build 時給 VITE_AI_RECIPE=off。 */
export const aiEnabled = import.meta.env.VITE_AI_RECIPE !== 'off'

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!localQuotaLeft()) throw new AiError('quota')
  const payload = { ...body, deviceId: deviceId() }
  let data: unknown
  let status = 0
  if (DEV_URL) {
    const r = await fetch(DEV_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    status = r.status
    data = await r.json().catch(() => null)
  } else {
    const r = await supabase.functions.invoke('ai-recipe', { body: payload })
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
  if (status === 429) throw new AiError('quota')
  if (status !== 200 || !data) throw new AiError('failed', `status ${status}`)
  bumpLocal()
  return data as T
}

/** 同一組食材 + 偏好，這一週內只問一次。特價一週換一次，快取跟著換。 */
const cacheKey = (kind: string, items: string[], prefs: Prefs, extra = '') =>
  `ai:${kind}:${nzMonday()}:${items.join('|')}|${prefs.serves}|${prefs.maxMinutes}|${prefs.spice}|${prefs.avoid}|${extra}`

export async function fetchDirections(items: string[], prefs: Prefs, fresh = false): Promise<Direction[]> {
  const key = cacheKey('dir', items, prefs)
  if (!fresh) {
    const hit = readCache<Direction[]>(key)
    if (hit?.length) return hit
  }
  const out = await call<{ directions: Direction[] }>({ layer: 'directions', items, prefs })
  const list = out.directions ?? []
  if (list.length) writeCache(key, list, 'ai:dir:')
  return list
}

export async function fetchRecipe(items: string[], prefs: Prefs, direction: Direction, fresh = false): Promise<AiRecipe> {
  const key = cacheKey('rec', items, prefs, direction.dish_en + (fresh ? Date.now() : ''))
  if (!fresh) {
    const hit = readCache<AiRecipe>(key)
    if (hit) return hit
  }
  const out = await call<{ recipe: AiRecipe }>({ layer: 'recipe', items, prefs, direction })
  if (out.recipe) writeCache(key, out.recipe, 'ai:rec:')
  return out.recipe
}
