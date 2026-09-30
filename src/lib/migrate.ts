// 換網域搬家（2026-09-30）：訪客的店、清單、語言都存在 localStorage，綁在網址上，換網域就不見。
// 舊網址把要搬的 key 打包進網址跳去新網址（main.ts），新網址的 #/migrate 解開寫回（views/MigrateView.vue）。
// 這裡只放純函式、不碰 window，測試直接跑（tests/migrate.test.ts）。

/** 舊網址：只有在這個網址開 App 才會跳去新網址（新網址、本機開發都不會） */
export const OLD_HOST = 'nz-deals.zeabur.app'

/** 只用到 localStorage 這兩個方法；測試傳假的進來 */
export interface KV {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStrs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string')

/**
 * 白名單：只搬使用者自己的東西。key → 值該長什麼樣（網址誰都拼得出來，型別不對就不寫，免得新網址一打開就壞）。
 * 不搬：stores、categories、sp:*（下載回來的快取，新網址自己重抓）、ai:used（本機每天次數）、device（查價額度用的裝置 id）。
 * 關注只存在帳號裡（登入才有），本機沒有。
 */
const MIGRATE_KEYS: Record<string, (v: unknown) => boolean> = {
  'nzd:selected': isStrs,   // 選的店（useStores）
  'nzd:list': (v) => Array.isArray(v) && v.every((i) => isObj(i) && typeof i.id === 'string' && typeof i.name === 'string'),   // 清單（useList）
  'nzd:lang': (v) => v === 'en' || v === 'zh',   // 語言（useI18n）
  'nzd:coords': (v) => isObj(v) && typeof v.lat === 'number' && typeof v.lng === 'number',   // 定位座標（useStores）
  'nzd:foodOnly': (v) => typeof v === 'boolean',   // 只看食品（useSettings）
  'nzd:ai:prefs': isObj,   // AI 食譜上次填的偏好（lib/aiRecipe）
  'nzd:recentCats': isStrs,   // 分類頁點過的小分類（BrowseView）
  'nzd:announceSeen': (v) => typeof v === 'string',   // 關掉過的公告（HomeView）
}

/** 網址帶得動的量（JSON 的 bytes）；超過就從最大的開始丟 */
const MAX_BYTES = 200 * 1024
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

/** 白名單裡有存的 key 收成一個物件（值是解開的 JSON）。 */
export function exportGuestData(storage: KV): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(MIGRATE_KEYS)) {
    const raw = storage.getItem(k)
    if (raw == null) continue
    try {
      out[k] = JSON.parse(raw)
    } catch {
      /* 壞掉的不搬 */
    }
  }
  for (const k of Object.keys(out).sort((a, b) => bytes(out[b]) - bytes(out[a]))) {
    if (bytes(out) <= MAX_BYTES) break
    delete out[k]
  }
  return out
}

/** 物件 → JSON → base64url。btoa 只吃 ASCII，所以先 encodeURIComponent 處理中文。 */
export function encodePayload(obj: Record<string, unknown>): string {
  return btoa(encodeURIComponent(JSON.stringify(obj))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** encodePayload 反過來；解不開、或解出來不是物件，回 null。 */
export function decodePayload(str: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(decodeURIComponent(atob(str.replace(/-/g, '+').replace(/_/g, '/'))))
    return isObj(v) ? v : null
  } catch {
    return null
  }
}

/** 寫進這個網址的 localStorage：已經有的 key 不覆蓋；清單按 id 合併、已有的不重複。回搬了幾個 key。 */
export function importGuestData(storage: KV, data: Record<string, unknown>): number {
  let n = 0
  for (const [k, ok] of Object.entries(MIGRATE_KEYS)) {
    const v = data[k]
    if (v === undefined || !ok(v)) continue
    const cur = storage.getItem(k)
    const next = cur == null ? v : k === 'nzd:list' ? mergeList(cur, v as Array<{ id: string }>) : null
    if (next == null) continue
    storage.setItem(k, JSON.stringify(next))
    n++
  }
  return n
}

/** 清單按 id 合併：原本的在前，搬來的新項目接在後面。沒有新項目、或原本的解不開，回 null（不動）。 */
function mergeList(cur: string, add: Array<{ id: string }>): unknown[] | null {
  let mine: unknown
  try {
    mine = JSON.parse(cur)
  } catch {
    return null
  }
  if (!Array.isArray(mine)) return null
  const ids = new Set(mine.map((i) => (isObj(i) ? i.id : null)))
  const extra = add.filter((i) => !ids.has(i.id))
  return extra.length ? [...mine, ...extra] : null
}
