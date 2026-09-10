// 後台守門（docs/admin-spec.md §1）：email 在 admins 表裡的人才進得去。
// admins 的 RLS 只有 is_admin() 過得了，所以「查得到自己那列」＝ 管理員；查不到（或沒登入）就不是。
import { ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

/** null = 還在查（登入狀態還沒回來也算），true / false = 查完了 */
const isAdmin = ref<boolean | null>(null)
let started = false

export function useAdmin() {
  const { user, ready } = useAuth()
  if (!started) {
    started = true
    watch(
      [ready, user],
      async () => {
        if (!ready.value) return
        const email = user.value?.email
        if (!email) {
          isAdmin.value = false
          return
        }
        const { data } = await supabase.from('admins').select('email').eq('email', email).limit(1)
        isAdmin.value = !!data?.length
      },
      { immediate: true },
    )
  }
  return { isAdmin }
}
