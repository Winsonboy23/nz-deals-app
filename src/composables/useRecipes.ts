import { computed } from 'vue'
import raw from '../data/recipes.json'
import { useSpecials } from './useSpecials'
import { lang } from './useI18n'
import { dealPrice } from '../lib/compare'
import { chainOf } from '../lib/format'
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
  /** Path under public/, e.g. recipes/bacon-carbonara.jpg */
  image: string
  credit: { photographer: string; url: string; source: string }
  ingredients: Ingredient[]
  staples?: Bi
  steps: { en: string[]; zh: string[] }
  tip?: Bi
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

const recipes = raw as unknown as Recipe[]
const { families, activeStores } = useSpecials()

export const bi = (x: Bi): string => x[lang.value]

/** What "Add ingredients" puts on the list: every required ingredient, plus optional ones that are on special. */
export const toAdd = (r: RankedRecipe): IngredientMatch[] =>
  r.matches.filter((m) => !m.ingredient.optional || m.offer)

function cheapest(fams: string[], storeId?: string): Offer | null {
  let best: Offer | null = null
  for (const f of fams) {
    for (const o of families.value.get(f) ?? []) {
      if (storeId && o.store.id !== storeId) continue
      if (!best || dealPrice(o.special) < dealPrice(best.special)) best = o
    }
  }
  return best
}
const costOf = (ms: IngredientMatch[]) => ms.filter((m) => !m.ingredient.optional || m.offer).reduce((s, m) => s + (m.offer ? dealPrice(m.offer.special) : 0), 0)

/** Recipes ranked by how many ingredients are on special at the selected stores (design C1). */
const ranked = computed<RankedRecipe[]>(() => {
  const list: RankedRecipe[] = recipes.map((recipe) => {
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
    r.estCost = toAdd(r).reduce((s, m) => s + (m.offer ? dealPrice(m.offer.special) : 0), 0)
    const reqCost = required.reduce((s, m) => s + (m.offer ? dealPrice(m.offer.special) : 0), 0)
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
    byId: (id: string): RankedRecipe | null => ranked.value.find((r) => r.recipe.id === id) ?? null,
  }
}
