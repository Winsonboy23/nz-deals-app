// 登入狀態（docs/stage4-contract.md §2）：HttpOnly cookie `kw_session` 放隨機 token，sessions 表存 sha256(token)。
// 所有需登入的路由用 requireUser(c)；它丟 HTTPException(401) 讓 Hono 回 {"error":"sign_in_required"}。
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Env } from './env'

export const SESSION_COOKIE = 'kw_session'
const SESSION_DAYS = 90

export interface SessionUser {
  id: string
  email: string | null
  name: string | null
  avatar: string | null
  lang: string
  notify_push: boolean
}

type C = Context<{ Bindings: Env }>

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface Row { id: string; email: string | null; name: string | null; avatar: string | null; lang: string | null; notify_push: number | null; expires_at: string }

/** 讀 cookie → 使用者；沒登入、過期、找不到都回 null。 */
export async function getUser(c: C): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const row = await c.env.DB.prepare(
    'select u.id, u.email, u.name, u.avatar, u.lang, u.notify_push, s.expires_at from sessions s join users u on u.id = s.user_id where s.id = ?',
  ).bind(await sha256(token)).first<Row>()
  if (!row) return null
  if (row.expires_at <= new Date().toISOString()) {
    await c.env.DB.prepare('delete from sessions where id = ?').bind(await sha256(token)).run()
    return null
  }
  return { id: row.id, email: row.email, name: row.name, avatar: row.avatar, lang: row.lang ?? 'zh', notify_push: !!row.notify_push }
}

/** 需登入的路由開頭叫這個。 */
export async function requireUser(c: C): Promise<SessionUser> {
  const u = await getUser(c)
  if (!u) throw new HTTPException(401, { res: Response.json({ error: 'sign_in_required' }, { status: 401 }) })
  return u
}

/** 建 session 並寫 cookie。 */
export async function createSession(c: C, userId: string): Promise<void> {
  const token = randomToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000)
  await c.env.DB.prepare('insert into sessions (id, user_id, expires_at) values (?, ?, ?)').bind(await sha256(token), userId, expires.toISOString()).run()
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', expires })
}

/** 登出：刪 session、清 cookie。沒 cookie 也不會錯。 */
export async function destroySession(c: C): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await c.env.DB.prepare('delete from sessions where id = ?').bind(await sha256(token)).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
