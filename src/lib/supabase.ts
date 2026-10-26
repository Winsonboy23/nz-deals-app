import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Google 登入用 PKCE：回來的是 ?code=，不會跟 hash 路由打架。session 存在 localStorage。 */
function make(): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  })
}

// 階段 6（2026-10-26）：用到才建。以前一 import 就 createClient，supabase-js 會自己讀 localStorage 的舊 session、
// 每隔一陣子打 supabase.co 刷新 token——d1 模式下根本沒人叫它，卻還在打 Supabase。Proxy 讓 24 個檔的 `supabase.from(...)` 寫法不用改。
let client: SupabaseClient | null = null
export const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    client ??= make()
    const v = (client as unknown as Record<string | symbol, unknown>)[prop]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(client) : v
  },
})
