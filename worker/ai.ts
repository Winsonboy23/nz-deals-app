// POST /api/ai-recipe（全國版階段 4，docs/stage4-contract.md §4）：從 supabase/functions/ai-recipe/index.ts 搬過來。
// prompt、schema、repair、invalidReason、cleanPrefs 一字不改；只換底層：
//   模型 2026-10-27 從 OpenAI 換成 Claude（ANTHROPIC_API_KEY secret、CLAUDE_RECIPE_MODEL var；schema 拿掉 maxItems、id 可空改 anyOf，Claude 的 JSON 格式不收這兩種寫法）。
//   登入 callerOf → session cookie（getUser）；額度 ai_usage_bump RPC → D1 ai_usage upsert；開關 settings → D1；紀錄 ai_recipes → D1（payload JSON 一列一道）。
// 只註冊自己的路徑，不要 all('*')，不然會把 api.ts 的公開讀取全吃掉。
import Anthropic from '@anthropic-ai/sdk'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from './env'
import { getUser } from './session'
import { nzMonday } from './week'

type C = Context<{ Bindings: Env }>

/** 一天幾次。只接受登入的人（帳號 id 從 session 來，偽造不了）；IP 和全站是額外的成本上限。
 *  全站上限和開關由後台的 settings 表決定（docs/admin-spec.md §2.6），每次請求讀一次；讀不到就用這裡的預設。 */
const QUOTA = { user: 20, ip: 30, global: 300 }
const MAX_POOL = 60
/** 食譜紀錄一人最多幾筆；滿了自動刪最舊的（2026-09-10 使用者決定，要讓人知道 → 回 trimmed 給前端顯示）。 */
const HISTORY_MAX = 10
const MAX_ANCHORS = 10

const STAPLES =
  'oil, salt, pepper, sugar, flour, butter, water, onion, garlic, ginger, soy sauce, vinegar, stock, honey, dried herbs and spices'

/** 偏好問卷的選項（KiteWise 3-7，2026-09-30）；跟前端 app/src/lib/aiRecipe.ts 的 DIETS / CUISINES / MOODS / KITCHEN 是同一組 key。 */
const DIETS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free', 'halal', 'low-carb']
const CUISINES = ['kiwi', 'asian', 'italian', 'mexican', 'indian', 'middle-eastern']
const MOODS = ['comfort', 'light', 'quick', 'hosting']
const APPLIANCES = ['stovetop', 'oven', 'microwave', 'air-fryer', 'rice-cooker', 'slow-cooker', 'toaster', 'blender', 'bbq']

const SYS_RECIPES = `You are a professional recipe editor writing for New Zealand home cooks.
You are given:
- "anchors": items the cook already has and wants to use. Each has an "id".
- "pool": products on special this week at their supermarkets. Each has an "id", name, price and store.
- "prefs": serves, max minutes, spice level, difficulty (easy / medium / hard), "notes" (free text: likes, dislikes, things they avoid — follow it), "diet" (dietary needs), "cuisines" (cuisines they feel like; may be empty), "mood" (may be null), "budget" (weekly food budget in NZ$, or null) and "appliances" (the cooking appliances they have).
- "budget_per_serve": only when prefs.budget is set — a rough target cost per serve in NZ$ (budget / 7 / serves).
- "lang": "zh" or "en".

Rules:
- Return up to 2 recipes. Aim for 2; give 1 if only one sensible dish exists; give 0 if the anchors genuinely cannot make a real dish. Never force an item into a dish where it does not belong.
- When anchors are given, every recipe must use at least one anchor as a MAIN ingredient (not a garnish). Two recipes must differ in main ingredient, and in cuisine unless prefs.cuisines has only one.
- Every ingredient must be one of: an "id" from anchors or pool (set "id", leave "name" empty); a pantry staple (set "staple": true, "id": null, and "name" MUST be the staple's name, e.g. "oil", "salt"): ${STAPLES}; or, at most ONE per recipe, a common supermarket item not in the pool (set "id": null, "staple": false, "name" MUST be its name). "name" is empty ONLY when "id" is given; an ingredient with no id and no name is invalid. Staples and off-pool items NEVER have an "id" — never write things like "id": "onion". Never invent anything else. Prefer pool items over off-pool items.
- Quantities are exact numbers with units ("300 g", "2 tbsp", "1 tsp"). Never "some" or "to taste" — the only exceptions are salt and pepper.
- 5 to 8 steps. Every step states an observable cue for when it is done: "medium heat until the oil just shimmers", "sear until golden and no longer pink in the centre", "simmer until the sauce coats the back of a spoon". Never bare instructions like "heat the pan" or "cook until done".
- "difficulty" is easy, medium or hard. Every recipe must be the level in prefs.difficulty: easy = one pan, basic techniques, little prep; medium = some prep or two components cooked separately; hard = more technique, timing or components. If prefs.difficulty is missing, the two recipes should differ in difficulty.
- "kcal" is a reasonable estimate per serve.
- Desserts only use dessert ingredients (yoghurt, cream, sugar, chocolate, biscuits, fruit, nut butter, milk, eggs). Savoury items never go into a dessert; no pepper in desserts.
- Products are as labelled: a snack pack of "chips" is crisps; instant coffee is a flavouring, not a main ingredient.
- Respect serves, max minutes, spice level and difficulty.
- Appliances: use ONLY appliances listed in prefs.appliances. The keys are: stovetop (the hob — any frying pan, wok or saucepan on it), oven, microwave, air-fryer, rice-cooker, slow-cooker, toaster, blender, bbq. No oven means nothing baked or roasted in an oven; no stovetop means nothing pan-fried, boiled or simmered on the hob. If prefs.appliances is empty, only no-cook dishes. Set "appliances" to exactly the keys the steps use, and "pot_count" to how many pans, pots, trays or baskets the dish is cooked in (a frying pan, a saucepan, an oven tray, the air-fryer basket: 1 each; 0 for a no-cook dish).
- Diet: follow every item in prefs.diet strictly, for every ingredient including pantry staples, and never use an anchor or pool item that breaks it. vegetarian: no meat, poultry, fish or seafood (nor meat or fish stock, fish sauce, gelatine). vegan: vegetarian, and also no eggs, dairy or honey. gluten-free: no wheat, barley or rye — no regular bread, pasta, noodles, flour, breadcrumbs or soy sauce unless the item is labelled gluten-free. dairy-free: no milk, butter, cheese, cream or yoghurt. nut-free: no nuts, peanuts or nut products (nut butters, nut milks, nut oils). halal: no pork or pork products (bacon, ham, pork sausages, lard, gelatine) and no alcohol, not even wine or beer in cooking. low-carb: little or no rice, pasta, noodles, bread, potato or sugar. If an anchor breaks the diet, leave it out; if no anchor fits, return 0 recipes.
- Appliance and diet rules override every other rule, including the dessert rule and the staples list.
- If prefs.cuisines is not empty, every recipe's cuisine is one of them (kiwi = Kiwi home cooking); with two or more chosen, the two recipes use different ones.
- prefs.mood, when set: comfort = rich, hearty, comforting; light = fresh and light, little oil, butter or cream; quick = ready in 20 minutes or less; hosting = good for sharing with a group, with some plating or presentation.
- If budget_per_serve is given, aim for a cost per serve (what has to be bought, at pool prices, divided by serves) at or below it. It is a rough guide, not a hard rule.
- "tip" is the one thing that actually changes the result.
- Write title, cuisine, qty, staple/off-pool names, steps and tip in the requested language only. For "zh" use Traditional Chinese as written in Taiwan.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recipes'],
  properties: {
    recipes: {
      type: 'array',   // 最多 2 道：Claude 的 schema 不收 maxItems，靠 prompt + 下面 .slice(0, 2)
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'cuisine', 'serves', 'minutes', 'kcal', 'difficulty', 'appliances', 'pot_count', 'ingredients', 'steps', 'tip'],
        properties: {
          title: { type: 'string' },
          cuisine: { type: 'string' },
          serves: { type: 'integer' },
          minutes: { type: 'integer' },
          kcal: { type: 'integer' },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          appliances: { type: 'array', items: { type: 'string', enum: APPLIANCES } },
          pot_count: { type: 'integer' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'name', 'qty', 'staple'],
              properties: {
                id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                name: { type: 'string' },
                qty: { type: 'string' },
                staple: { type: 'boolean' },
              },
            },
          },
          steps: { type: 'array', items: { type: 'string' } },
          tip: { type: 'string' },
        },
      },
    },
  },
}

interface Item { id: string; name: string; price?: number; store?: string }
interface Ing { id: string | null; name: string; qty: string; staple: boolean }
interface Recipe { title: string; cuisine: string; serves: number; minutes: number; kcal: number; difficulty: string; appliances: string[]; pot_count: number; ingredients: Ing[]; steps: string[]; tip: string }
/** 回給前端、也存進紀錄的食材：把編號換成當下的名字和價格。 */
interface OutIng { id: string | null; name: string; qty: string; staple: boolean; price: number | null; store: string | null }

/** 誰在呼叫。只認登入的人（session cookie）。 */
async function callerOf(c: C): Promise<{ id: string; uid: string } | null> {
  const u = await getUser(c)
  return u ? { id: `u:${u.id}`, uid: u.id } : null
}

/** 一個 scope 今天 +1，回加完的次數（D1 ai_usage upsert … returning）。寫不進去回 null（不擋）。 */
async function bumpOne(env: Env, key: string, day: string): Promise<number | null> {
  try {
    const row = await env.DB.prepare('insert into ai_usage (day, scope, count) values (?, ?, 1) on conflict (day, scope) do update set count = ai_usage.count + 1 returning count')
      .bind(day, key).first<{ count: number }>()
    const n = Number(row?.count)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** 三層一起算：本人、IP、全站。任何一層滿了就擋。全站上限用後台的 ai_daily_cap。 */
async function bump(env: Env, caller: { id: string }, ip: string, globalCap = QUOTA.global) {
  const day = new Date().toISOString().slice(0, 10)
  const [self, byIp, all] = await Promise.all([bumpOne(env, caller.id, day), ip ? bumpOne(env, `ip:${ip}`, day) : Promise.resolve(null), bumpOne(env, 'g:all', day)])
  if (self === null && byIp === null && all === null) return null
  if (all !== null && all > globalCap) return { used: all, limit: globalCap, hit: 'global' as const }
  if (byIp !== null && byIp > QUOTA.ip) return { used: byIp, limit: QUOTA.ip, hit: 'ip' as const }
  return { used: self ?? 0, limit: QUOTA.user, hit: 'self' as const }
}

function clientIp(c: C): string {
  return (c.req.header('cf-connecting-ip') ?? (c.req.header('x-forwarded-for') ?? '').split(',')[0]).trim().slice(0, 45)
}

/** 後台的開關與額度（settings 表）。讀不到就回空物件，照預設跑。 */
async function settings(env: Env): Promise<Record<string, string>> {
  try {
    const { results } = await env.DB.prepare("select key, value from settings where key in ('ai_recipes', 'ai_daily_cap')").all<{ key: string; value: string | null }>()
    return Object.fromEntries(results.map((x) => [x.key, x.value ?? '']))
  } catch {
    return {}
  }
}

const STAPLE_RE = /^(oil|olive oil|vegetable oil|salt|pepper|black pepper|sugar|flour|butter|water|onion|onions|garlic|ginger|soy sauce|vinegar|stock|chicken stock|beef stock|vegetable stock|honey|cornflour|cornstarch|(dried )?(mixed )?herbs?( and spices)?|spices?|油|鹽|胡椒|黑胡椒|糖|麵粉|奶油|水|洋蔥|蒜|大蒜|蒜頭|薑|醬油|醋|高湯|蜂蜜|太白粉|乾燥香料|香料)$/i
/**
 * 模型常把沒編號的東西也寫成 id（"onion"、"milk"、"dried herbs and spices"）。
 * 編號對不到的：像常備品就修成 staple；其他修成池外食材（id null）。都不要整道丟掉；池外仍受「最多 1 樣」管。
 */
function repair(r: Recipe, known: Set<string>): void {
  for (const i of r.ingredients ?? []) {
    if (!i.id || known.has(i.id)) continue
    const word = i.id.trim()
    i.name = i.name?.trim() || word
    i.id = null
    i.staple = STAPLE_RE.test(word) || STAPLE_RE.test(i.name)
  }
}

/** 一道食譜合不合規：編號都存在、有錨就至少用到 1 樣、池外一般食材最多 1 樣、沒編號的一定要有名字、步驟 4–8、廚具都是 9 個 key 之一而且是使用者有的。回 null = 合規，否則回原因。 */
function invalidReason(r: Recipe, anchorIds: Set<string>, poolIds: Set<string>, owned: Set<string>): string | null {
  if (!Array.isArray(r.ingredients) || !Array.isArray(r.steps) || !Array.isArray(r.appliances)) return 'shape'
  if (r.steps.length < 4 || r.steps.length > 8) return `steps:${r.steps.length}`
  if (r.ingredients.length < 2) return 'too_few_ingredients'
  let usesAnchor = anchorIds.size === 0
  let offPool = 0
  for (const i of r.ingredients) {
    if (i.id) {
      if (anchorIds.has(i.id)) usesAnchor = true
      else if (!poolIds.has(i.id)) return `bad_id:${i.id}`
    } else {
      if (!i.name?.trim()) return 'blank_name'
      if (!i.staple) offPool += 1
    }
  }
  if (!usesAnchor) return 'no_anchor'
  if (offPool > 1) return `off_pool:${offPool}`
  const badAppliance = r.appliances.find((a) => !APPLIANCES.includes(a) || !owned.has(a))
  if (badAppliance !== undefined) return `appliance:${badAppliance}`
  return null
}

async function ask(env: Env, system: string, user: unknown) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: env.CLAUDE_RECIPE_MODEL || 'claude-sonnet-5-5',
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: JSON.stringify(user) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA }, effort: 'low' },   // low：使用者在等畫面，跟以前 mini 模型差不多快
  })
  if (msg.stop_reason === 'refusal') throw new Error('claude refusal')
  if (msg.stop_reason === 'max_tokens') throw new Error('claude max_tokens')
  const text = msg.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('claude empty')
  return JSON.parse(text) as { recipes: Recipe[] }
}

/** 每道存一筆到 ai_recipes（payload JSON）；寫不進去就算了，不影響回應。回每筆的 id。超過 HISTORY_MAX 的舊紀錄刪掉。 */
async function saveHistory(env: Env, uid: string, recipes: Array<Recipe & { ingredients: OutIng[] }>, anchors: Item[], prefs: unknown, lang: string): Promise<{ ids: Array<string | null>; trimmed: number; count: number }> {
  const none = { ids: recipes.map(() => null), trimmed: 0, count: 0 }
  if (!recipes.length) return none
  const week = nzMonday()
  const rows = recipes.map((r) => ({
    id: crypto.randomUUID(),
    payload: {
      title: r.title, cuisine: r.cuisine, serves: r.serves, minutes: r.minutes, kcal: r.kcal,
      difficulty: r.difficulty, ingredients: r.ingredients, steps: r.steps, tip: r.tip, anchors: anchors.map((a) => a.name), prefs, week_start: week,
      image_url: null, image_credit: null,   // 2026-09-30 起不配圖（欄位留著，舊紀錄還有圖）
    },
  }))
  try {
    const ins = env.DB.prepare('insert into ai_recipes (id, user_id, lang, payload) values (?, ?, ?, ?)')
    await env.DB.batch(rows.map((r) => ins.bind(r.id, uid, lang, JSON.stringify(r.payload))))
    const { results: old } = await env.DB.prepare('select id from ai_recipes where user_id = ? order by created_at desc, id desc limit -1 offset ?').bind(uid, HISTORY_MAX).all<{ id: string }>()
    const oldIds = old.map((x) => x.id)
    if (oldIds.length) await env.DB.prepare('delete from ai_recipes where user_id = ? and id in (select value from json_each(?))').bind(uid, JSON.stringify(oldIds)).run()
    return { ids: rows.map((r) => r.id), trimmed: oldIds.length, count: HISTORY_MAX }
  } catch {
    return none
  }
}

/**
 * 前端送來的偏好（2026-09-30 KiteWise 3-7 多了 diet / cuisines / mood / budget / appliances）：新欄位只留認得的值。
 * 舊版前端沒送 appliances → 當作 9 樣都有（不然它生的每道都會被廚具驗證丟掉）。
 */
function cleanPrefs(x: unknown): Record<string, unknown> & { diet: string[]; cuisines: string[]; mood: string | null; budget: number | null; appliances: string[] } {
  const p = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
  const only = (v: unknown, keys: string[]) => (Array.isArray(v) ? keys.filter((k) => v.includes(k)) : [])
  const budget = Number(p.budget)
  return {
    ...p,
    diet: only(p.diet, DIETS),
    cuisines: only(p.cuisines, CUISINES),
    mood: typeof p.mood === 'string' && MOODS.includes(p.mood) ? p.mood : null,
    budget: Number.isFinite(budget) && budget > 0 ? budget : null,
    appliances: Array.isArray(p.appliances) ? only(p.appliances, APPLIANCES) : APPLIANCES,
  }
}

const clean = (x: unknown): Item | null => {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || !o.id || !o.name) return null
  const it: Item = { id: o.id.slice(0, 120), name: o.name.slice(0, 120) }
  if (typeof o.price === 'number') it.price = o.price
  if (typeof o.store === 'string') it.store = o.store.slice(0, 20)
  return it
}

const ai = new Hono<{ Bindings: Env }>()

ai.post('/ai-recipe', async (c) => {
  const env = c.env
  if (!env.ANTHROPIC_API_KEY) return c.json({ error: 'server_not_configured' }, 500)

  const cfg = await settings(env)   // 後台開關：關掉就整支停用
  if (cfg.ai_recipes === 'off') return c.json({ error: 'paused' }, 503)
  const globalCap = Number(cfg.ai_daily_cap) > 0 ? Number(cfg.ai_daily_cap) : QUOTA.global

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'bad_json' }, 400)
  }
  if (body.layer !== 'recipes') return c.json({ error: 'bad_layer' }, 400)

  const anchors = (Array.isArray(body.anchors) ? body.anchors : []).map(clean).filter((x): x is Item => !!x).slice(0, MAX_ANCHORS)
  const pool = (Array.isArray(body.pool) ? body.pool : []).map(clean).filter((x): x is Item => !!x).slice(0, MAX_POOL)
  if (anchors.length + pool.length < 3) return c.json({ error: 'too_few_items', recipes: [] }, 400)
  const prefs = cleanPrefs(body.prefs)
  const lang = body.lang === 'en' ? 'en' : 'zh'
  // 每週預算換成每份的粗估目標（週預算 / 7 天 / 人份），放進 prompt 當參考，不強制也不驗
  const serves = Number(prefs.serves) >= 1 ? Number(prefs.serves) : 4
  const budgetPerServe = prefs.budget ? Math.round((prefs.budget / 7 / serves) * 100) / 100 : undefined

  // 要登入才給用（2026-09-08）：AI 每次都真的花錢。
  const caller = await callerOf(c)
  if (!caller) return c.json({ error: 'sign_in_required' }, 401)
  const usage = await bump(env, caller, clientIp(c), globalCap)
  if (usage && usage.used > usage.limit) return c.json({ error: 'quota', scope: usage.hit, used: usage.used, limit: usage.limit }, 429)

  try {
    const out = await ask(env, SYS_RECIPES, { anchors, pool, prefs, lang, budget_per_serve: budgetPerServe })
    const anchorIds = new Set(anchors.map((a) => a.id))
    const poolIds = new Set(pool.map((p) => p.id))
    const owned = new Set(prefs.appliances)
    // 不合的整道丟掉，不重問：模型故意少給就尊重它。
    const reasons: string[] = []
    const known = new Set([...anchorIds, ...poolIds])
    const kept = (out.recipes ?? []).filter((r) => {
      repair(r, known)
      const why = invalidReason(r, anchorIds, poolIds, owned)
      if (why) reasons.push(`${r.title}: ${why}`)
      return !why
    }).slice(0, 2)
    const byId = new Map<string, Item>([...anchors, ...pool].map((i) => [i.id, i]))
    const recipes = kept.map((r) => ({
      ...r,
      ingredients: r.ingredients.map((i): OutIng => {
        const it = i.id ? byId.get(i.id) : undefined
        return { id: i.id, name: it?.name ?? i.name, qty: i.qty, staple: i.staple, price: it?.price ?? null, store: it?.store ?? null }
      }),
    }))
    const saved = await saveHistory(env, caller.uid, recipes, anchors, prefs, lang)
    return c.json({ recipes: recipes.map((r, i) => ({ ...r, dbId: saved.ids[i] })), dropped: reasons.length, reasons, usage, trimmed: saved.trimmed, historyMax: HISTORY_MAX })
  } catch (e) {
    console.error(e)
    return c.json({ error: 'ai_failed', detail: String(e).slice(0, 300) }, 502)
  }
})

export default ai
