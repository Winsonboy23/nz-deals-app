// 後台打 Worker /admin/api/*（全國版階段 5，docs/stage5-contract.md §4）。只在 useD1() 時用；Supabase 那條路在各元件裡原樣留著。
//
// 正式站 /admin 整段被 Cloudflare Access 擋：沒登入 Access 時 fetch 會被 302 到 Access 的登入頁（回 HTML 不是 JSON）。
// 遇到就整頁跳去 /admin 讓 Access 接手登入（只跳一次，sessionStorage 記著，避免一直轉）。
import { apiFetch } from './api'

export class AdminApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

const LOGIN_FLAG = 'nzd:admin-login'

function toAccessLogin(): never {
  let bounced = false
  try { bounced = sessionStorage.getItem(LOGIN_FLAG) === '1'; sessionStorage.setItem(LOGIN_FLAG, '1') } catch { /* ignore */ }
  if (!bounced && location.pathname !== '/admin') location.replace('/admin')
  throw new AdminApiError(0, 'access_login')
}

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const { status, data } = await apiFetch<T & { error?: string }>(method, '/admin/api' + path, body)
  if (status >= 200 && status < 300 && data !== null) {
    try { sessionStorage.removeItem(LOGIN_FLAG) } catch { /* ignore */ }
    return data
  }
  // 200 但不是 JSON（data null）＝ 被 Access 導去登入頁；0 = 網路錯
  if (status === 200 || status === 0) toAccessLogin()
  throw new AdminApiError(status, (data as { error?: string } | null)?.error ?? `http_${status}`)
}

export const adminGet = <T>(path: string) => call<T>('GET', path)
export const adminPost = <T>(path: string, body: unknown) => call<T>('POST', path, body)
export const adminPut = <T>(path: string, body: unknown) => call<T>('PUT', path, body)
export const adminPatch = <T>(path: string, body: unknown) => call<T>('PATCH', path, body)
export const adminDelete = <T>(path: string) => call<T>('DELETE', path)

/** 元件裡 try/catch 用：把錯誤變成一行字 */
export const adminErr = (e: unknown): string => (e instanceof AdminApiError ? (e.code === 'admin_required' ? '沒有後台權限' : e.code) : String(e))
