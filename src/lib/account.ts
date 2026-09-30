// 刪除帳號（2026-09-30；開 Facebook 登入要能刪資料）：帶使用者 token 打 Edge Function delete-account，
// 它驗 JWT 後用 service role 刪 auth user，資料表都掛 on delete cascade，帳號的店、清單、關注、推播、AI 食譜紀錄、會員卡一起清掉。
// 成功後本機也清乾淨：登出、清 nzd: 開頭的 localStorage、整頁重載回首頁，變回全新訪客。
import { supabase } from './supabase'
import { dropPrefix } from './cache'

/** dev 時可以指到本機 deno（VITE_DELETE_ACCOUNT_URL=http://localhost:8000）。 */
const URL_DELETE = (import.meta.env.VITE_DELETE_ACCOUNT_URL as string | undefined) || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-account`

export class AccountError extends Error {
  constructor(public code: 'signIn' | 'failed', message?: string) {
    super(message ?? code)
  }
}

/** 這台裝置的推播訂閱也退掉：伺服器那筆已跟著帳號刪了，不退的話下次登入開關還顯示「開」卻收不到。 */
async function unsubscribePush(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration()
  const sub = await reg?.pushManager?.getSubscription()
  await sub?.unsubscribe()
}

/** 失敗丟 AccountError（signIn＝登入失效）或網路錯誤；成功會整頁重載，不會回到呼叫的地方。 */
export async function deleteAccount(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AccountError('signIn')
  const r = await fetch(URL_DELETE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string },
  })
  const body = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (r.status === 401) throw new AccountError('signIn')
  if (!r.ok || !body?.ok) throw new AccountError('failed', body?.error ?? `status ${r.status}`)

  // 到這裡帳號已經刪了：本機清理出錯也照樣重載，不能讓畫面說「刪不掉」。同步的先做，後面卡住的話手動重新整理也是乾淨的。
  dropPrefix('')   // nzd: 開頭的全部：店、清單、快取、裝置代號、語言…
  try {
    await supabase.auth.signOut({ scope: 'local' })   // 伺服器上的 session 已跟著帳號刪掉，只清本機
    await unsubscribePush()
  } catch {
    /* 照樣往下 */
  }
  // 只換 # 後面瀏覽器不會重載，記憶體裡的店和清單還在（改一下又寫回 localStorage）→ 改網址後整頁重載。
  // 用 location.pathname 不寫死 '/'：GitHub Pages 的備份站在 /nz-deals-app/ 底下。
  history.replaceState(null, '', location.pathname + '#/')
  location.reload()
}
