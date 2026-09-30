import { computed, ref, shallowRef } from 'vue'
import raw from '../data/recipes.json'
import { useSpecials } from './useSpecials'
import { lang } from './useI18n'
import { rankPrice } from '../lib/compare'
import { chainOf } from '../lib/format'
import { readCache, writeCache } from '../lib/cache'
import { supabase } from '../lib/supabase'
import type { ChainId, Offer, Store } from '../lib/types'

/** Text in both UI languages. Dish names and steps are translated; product names stay English (§8). */
export interface Bi {
  en: string
  zh: string
}
export interface Ingredient {
  name: Bi
  /** family_key(s) that count as this ingredient (products.family_key, §8). Any match will do. */
  families: string[]
  /** Nice to have. Not counted in "N of M on special", only added to the list when it is on special. */
  optional?: boolean
}
/** 廚具頁的 9 個選項（KiteWise 3-7）；爐台上的平底鍋、湯鍋都算 stovetop */
export type Appliance = 'air-fryer' | 'rice-cooker' | 'slow-cooker' | 'toaster' | 'stovetop' | 'blender' | 'oven' | 'microwave' | 'bbq'
/** 食譜區塊（KiteWise 3-3），一道可以屬於好幾個 */
export type Block = 'best-value' | 'one-pot' | 'batch' | 'assembly' | 'air-fryer-micro' | 'breakfast' | 'date-night' | 'weekend-baking' | 'no-cook' | 'holiday'
export interface Recipe {
  id: string
  title: Bi
  serves: number
  minutes: number
  kcal?: number
  difficulty: 'easy' | 'medium' | 'hard'
  cuisine: string
  /** 料理分類的顯示名（日式／Japanese）。舊資料沒有就退回 cuisine。 */
  cuisineName?: Bi
  /** 常備庫是 public/ 底下的相對路徑（recipes/bacon-carbonara.jpg）；每週自動產的是 Supabase Storage 的完整 https:// 網址。顯示一律走 recipeImg() */
  image: string
  credit: { photographer: string; url: string; source: string }
  ingredients: Ingredient[]
  staples?: Bi
  steps: { en: string[]; zh: string[] }
  tip?: Bi
  /** 用幾個鍋／容器（炒鍋、湯鍋、烤盤、氣炸鍋籃都算一個）；什麼都不用加熱的是 0 */
  pot_count: number
  /** 要用到的廚具 */
  appliances: Appliance[]
  /** 屬於哪些區塊（人工決定）；食譜頁上方的篩選看這個 */
  blocks: Block[]
  /** 能不能最後才調味：一開始就要醃、滷的是 false（決定能不能開寶寶支線） */
  can_delay_seasoning: boolean
  /** 寶寶支線：6／9／12 個月的做法，還沒寫的是 null */
  baby_branch: Record<'6' | '9' | '12', Bi> | null
  /** 煮一鍋吃三天專用：可以放幾天、每天怎麼變化吃、怎麼保存；其他食譜是 null */
  batch: { days: number; variations: Bi[]; storage: Bi } | null
  /** 照片來源：'pexels'；'ai' = AI 生的圖，卡片和詳情頁標「示意圖」 */
  image_source: string
  /** recipes 表的 week_start（不在 data 裡）：那週的精選是那週的週一，常備食譜庫是 null */
  weekStart: string | null
}
export interface IngredientMatch {
  ingredient: Ingredient
  /** cheapest offer across the selected stores, or null when nothing in this family is on special */
  offer: Offer | null
}
/** 「同一家買齊」：這家店能買到幾樣（同類可比，§8 family）、要花多少。 */
export interface StorePlan {
  store: Store
  matches: IngredientMatch[]
  onSpecial: number
  cost: number
}
export interface RankedRecipe {
  recipe: Recipe
  /** 每樣各挑最便宜的店（可能分好幾家） */
  matches: IngredientMatch[]
  /** 能買到最多樣的那一家（同分挑便宜的）；沒有任何一家買得到就 null */
  oneStore: StorePlan | null
  /** required ingredients on special */
  onSpecial: number
  /** required ingredients in total */
  total: number
  chains: ChainId[]
  /** sum of the on-special prices of what "Add ingredients" would add */
  estCost: number
  /** cost per serve of the required ingredients only; Infinity when nothing matched */
  perServe: number
  rank: number
}

/** 內建的常備食譜庫：表讀不到、裝置上又沒快取時的退路（不要刪） */
const builtin: Recipe[] = (raw as unknown as Recipe[]).map((r) => ({ ...r, weekStart: null }))
/**
 * 正本是 recipes 表（只讀 published 的；後台可改、可上下架）。啟動先用上次讀到的快取（沒有就先用內建的），
 * 同時背景讀表：讀到就換掉並存快取；讀失敗、或一道都沒有（例如還沒匯入）就維持原樣。
 */
const recipes = shallowRef<Recipe[]>(readCache<Recipe[]>('recipes') ?? builtin)
/** 讀表這一次結束了沒（成功失敗都算）：詳情頁用來分「還在讀」和「真的沒有這道」 */
const loaded = ref(false)

/** 首頁排行、食譜頁會直接用到的欄位都在才算數：表裡的資料是後台和每週程式寫的，不像內建 JSON 有型別檢查，缺一個排行就整個算不出來 */
function usable(d: Partial<Recipe> | null | undefined): boolean {
  return !!d?.title && Array.isArray(d.steps?.en) && Array.isArray(d.steps?.zh) && Array.isArray(d.blocks) && Array.isArray(d.appliances) &&
    Array.isArray(d.ingredients) && d.ingredients.every((i) => !!i?.name && Array.isArray(i.families))
}

async function loadRecipes(): Promise<void> {
  const { data, error } = await supabase.from('recipes').select('id,week_start,data').eq('published', true)
  if (!error && data?.length) {
    const rows = data as Array<{ id: string; week_start: string | null; data: Omit<Recipe, 'weekStart'> }>
    const bad = rows.filter((r) => !usable(r.data)).map((r) => r.id)
    if (bad.length) console.warn('[recipes] 資料缺欄位，先不顯示：', bad.join(', '))
    const list: Recipe[] = rows.filter((r) => usable(r.data)).map((r) => ({ ...r.data, id: r.id, weekStart: r.week_start }))
    if (list.length) {
      recipes.value = list
      writeCache('recipes', list)
    }
  }
  loaded.value = true
}
void loadRecipes()

const { families, activeStores } = useSpecials()
const BASE = import.meta.env.BASE_URL

export const bi = (x: Bi): string => x[lang.value]

/** 食譜照片網址：http 開頭的（每週自動產的，放 Supabase Storage）直接用；其他是 public/ 底下的相對路徑，前面接 BASE_URL */
export function recipeImg(image: string): string {
  const src = image ?? ''   // 表裡的資料萬一沒有圖，不要讓整頁掛掉
  return src.startsWith('http') ? src : BASE + src
}

/** What "Add ingredients" puts on the list: every required ingredient, plus optional ones that are on special. */
export const toAdd = (r: RankedRecipe): IngredientMatch[] =>
  r.matches.filter((m) => !m.ingredient.optional || m.offer)

function cheapest(fams: string[], storeId?: string): Offer | null {
  let best: Offer | null = null
  for (const f of fams) {
    for (const o of families.value.get(f) ?? []) {
      if (storeId && o.store.id !== storeId) continue
      if (!best || rankPrice(o.special) < rankPrice(best.special)) best = o
    }
  }
  return best
}
const costOf = (ms: IngredientMatch[]) => ms.filter((m) => !m.ingredient.optional || m.offer).reduce((s, m) => s + (m.offer ? rankPrice(m.offer.special) : 0), 0)

/** Recipes ranked by how many ingredients are on special at the selected stores (design C1). */
const ranked = computed<RankedRecipe[]>(() => {
  const list: RankedRecipe[] = recipes.value.map((recipe) => {
    const matches = recipe.ingredients.map((ingredient) => ({ ingredient, offer: cheapest(ingredient.families) }))
    const required = matches.filter((m) => !m.ingredient.optional)
    const onSpecial = required.filter((m) => m.offer).length
    const chains = [...new Set(matches.filter((m) => m.offer).map((m) => chainOf(m.offer!.store.id)))]
    const plans: StorePlan[] = activeStores.value.map((d) => {
      const ms = recipe.ingredients.map((ingredient) => ({ ingredient, offer: cheapest(ingredient.families, d.store.id) }))
      return { store: d.store, matches: ms, onSpecial: ms.filter((m) => !m.ingredient.optional && m.offer).length, cost: costOf(ms) }
    })
    plans.sort((a, b) => b.onSpecial - a.onSpecial || a.cost - b.cost)
    const oneStore = plans[0]?.onSpecial ? plans[0] : null
    const r: RankedRecipe = { recipe, matches, oneStore, onSpecial, total: required.length, chains, estCost: 0, perServe: Infinity, rank: 0 }
    r.estCost = toAdd(r).reduce((s, m) => s + (m.offer ? rankPrice(m.offer.special) : 0), 0)
    const reqCost = required.reduce((s, m) => s + (m.offer ? rankPrice(m.offer.special) : 0), 0)
    r.perServe = onSpecial ? reqCost / Math.max(1, recipe.serves) : Infinity
    return r
  })
  // Most ingredients on special first. In a good week everything ties at 100%, so the real
  // ordering comes from cost per serve — cheapest to cook this week wins.
  list.sort(
    (a, b) =>
      b.onSpecial / Math.max(1, b.total) - a.onSpecial / Math.max(1, a.total) ||
      a.perServe - b.perServe ||
      a.recipe.minutes - b.recipe.minutes,
  )
  list.forEach((r, i) => (r.rank = i + 1))
  return list
})

export function useRecipes() {
  return {
    ranked,
    loaded,
    loadRecipes,
    byId: (id: string): RankedRecipe | null => ranked.value.find((r) => r.recipe.id === id) ?? null,
  }
}
