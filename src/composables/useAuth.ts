// 登入：Google（CLAUDE.md §2，2026-09-07）；Facebook 鈕藏在後台開關 facebook_login 後面（2026-09-30）。訪客能用全部比價功能，登入只是為了存東西和通知。
// 全國版階段 4（docs/stage4-contract.md §2、§6）：資料來源是 d1 時改走 Worker 的 cookie 登入（GET /auth/me、/auth/google、POST /auth/logout），
// user 維持 Supabase User 的子集 { id, email, user_metadata: { full_name, avatar_url } }，其他地方讀 name / avatar / user.value?.id 不用改。
import { computed, ref } from 'vue'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { apiFetch, authUrl, useD1 } from '../lib/api'

const user = ref<User | null>(null)
const ready = ref(false)
let started = false

interface MeUser { id: string; email: string | null; name: string | null; avatar: string | null; lang: string; notify_push: boolean }
/** Worker 的 user → Supabase User 的子集（型別上 cast；只有 id / email / user_metadata 有東西） */
const fromMe = (u: MeUser): User =>
  ({ id: u.id, email: u.email ?? undefined, user_metadata: { full_name: u.name ?? undefined, avatar_url: u.avatar ?? undefined }, app_metadata: {}, aud: 'authenticated', created_at: '' }) as unknown as User

async function start(): Promise<void> {
  if (started) return
  started = true
  if (useD1()) {
    const { status, data } = await apiFetch<{ user: MeUser | null }>('GET', '/auth/me')
    user.value = status === 200 && data?.user ? fromMe(data.user) : null
    ready.value = true
    return
  }
  const { data } = await supabase.auth.getSession()
  user.value = data.session?.user ?? null
  ready.value = true
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })
  // PKCE 回來的 ?code= 用完就從網址拿掉，重新整理才不會再換一次
  if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash)
}

function signIn(provider: 'google' | 'facebook' = 'google') {
  if (useD1()) {   // 階段 4 的 Worker 只接 Google；整頁跳去 Google，回來 Worker 會導回 return 那頁
    location.href = authUrl('/auth/google?return=' + encodeURIComponent(location.hash || '#/me'))
    return Promise.resolve()
  }
  return supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: location.origin + location.pathname },
  })
}
async function signOut(): Promise<void> {
  if (useD1()) {
    await apiFetch('POST', '/auth/logout')
    user.value = null
    return
  }
  await supabase.auth.signOut()
}

export function useAuth() {
  void start()
  return {
    user,
    ready,
    isIn: computed(() => !!user.value),
    name: computed(() => String(user.value?.user_metadata?.full_name || user.value?.user_metadata?.name || user.value?.email || '')),
    avatar: computed(() => String(user.value?.user_metadata?.avatar_url || user.value?.user_metadata?.picture || '')),
    signIn,
    signOut,
  }
}
