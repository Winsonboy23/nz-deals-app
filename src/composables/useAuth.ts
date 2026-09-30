// 登入：Google（CLAUDE.md §2，2026-09-07）；Facebook 鈕藏在後台開關 facebook_login 後面（2026-09-30）。訪客能用全部比價功能，登入只是為了存東西和通知。
import { computed, ref } from 'vue'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const user = ref<User | null>(null)
const ready = ref(false)
let started = false

async function start(): Promise<void> {
  if (started) return
  started = true
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
  return supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: location.origin + location.pathname },
  })
}
async function signOut(): Promise<void> {
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
