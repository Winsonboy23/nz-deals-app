// 資料來源的開關 + 呼叫 Worker /api/*（全國版階段 3，2026-10-25；docs/national-plan.md §3、§6）。
//
// 開關 dataSource()：'supabase'（預設，現況）| 'd1'（讀 Cloudflare：特價走 R2 快照、店／分類／開關／食譜／商品名走 D1）。
//   怎麼切：網址帶 ?src=d1 或 ?src=supabase（會記在這台裝置 localStorage nzd:src，之後開 App 都照這個）；
//   或 build 時 VITE_DATA_SOURCE=d1 讓全站預設走 D1。沒設就是 supabase。
// 階段 3 只切公開讀取；一站的貨架價（catalog）、即時查價、名字配對、使用者資料、後台還是 Supabase（階段 4／5）。
//
// apiBase()：Worker 在哪。正式站同網域（kitewise.nz 的 Worker 同時出靜態檔和 /api），所以是空字串；
//   本機 vite dev 要另外跑 wrangler dev，app/.env.local 設 VITE_API_BASE=http://127.0.0.1:8787。

export type DataSource = 'supabase' | 'd1'
const LS = 'nzd:src'

function fromUrl(): DataSource | null {
  try {
    const v = new URLSearchParams(location.search).get('src')
    if (v === 'd1' || v === 'supabase') { try { localStorage.setItem(LS, v) } catch { /* 隱私模式 */ } return v }
  } catch { /* SSR／測試沒有 location */ }
  return null
}
let cached: DataSource | null = null
export function dataSource(): DataSource {
  if (cached) return cached
  const fromQuery = fromUrl()
  let stored: string | null = null
  try { stored = localStorage.getItem(LS) } catch { /* ignore */ }
  const env = (import.meta.env.VITE_DATA_SOURCE as string | undefined) === 'd1' ? 'd1' : 'supabase'
  cached = fromQuery ?? (stored === 'd1' || stored === 'supabase' ? stored : env)
  return cached
}
export const useD1 = (): boolean => dataSource() === 'd1'

export function apiBase(): string {
  return ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '')
}
/** 本機 vite dev 沒有 Worker（除非 VITE_API_BASE 指到 wrangler dev）→ /api 不能用 */
export const apiAvailable = (): boolean => !import.meta.env.DEV || !!apiBase()

/** GET /api/...；失敗回 null（呼叫端自己決定要不要退回 Supabase） */
export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(apiBase() + path, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
export async function apiPost<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(apiBase() + path, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** products 列（D1 版，跟 Supabase products 的欄位一樣多幾個） */
export interface ApiProduct {
  key: string
  display_name: string
  brand: string | null
  size: string | null
  category_id: string | null
  family_key: string | null
  family_name_en: string | null
  family_name_zh: string | null
  is_food: boolean
  image_url: string | null
}
export const apiProducts = (q: { keys?: string[]; families?: string[] }) => apiPost<ApiProduct[]>('/api/products', q)
