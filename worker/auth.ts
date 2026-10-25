// /auth/*（docs/stage4-contract.md §2，2026-10-26）：Google OIDC 自己接，不用 Supabase Auth。
//
//   GET  /auth/google?return=<#/… 或 /…>   302 到 Google；state + PKCE code_verifier + return 放 10 分鐘的 HttpOnly cookie kw_oauth
//   GET  /auth/callback?code&state         驗 state → 換 token → jose 驗 id_token → users upsert → 建 session → 302 回 return
//   GET  /auth/me                          { user } 或 { user: null }（200、no-store）
//   POST /auth/logout                      刪 session、清 cookie → { ok: true }
//   POST /auth/dev-login                   只有 DEV_LOGIN === '1' 才存在（正式 404）；body { email? } → 建／找 user、設 cookie
//
// 失敗一律 302 到 /#/signin?error=<code>（App 的登入頁讀 ?error= 顯示）。
import { Hono } from 'hono'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env } from './env'
import { getUser, createSession, destroySession, randomToken } from './session'

type C = Context<{ Bindings: Env }>

const OAUTH_COOKIE = 'kw_oauth'
const OAUTH_SECONDS = 600
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
// 模組層級一份：jose 自己快取 Google 的公鑰，Worker 同一個 isolate 處理多個請求時不用每次重抓
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

const now = () => new Date().toISOString()
/** 請求的 origin；不是本機就一律 https（wrangler dev 帶 routes 時會把網址改成 http://kitewise.nz，正式站 Google 登記的是 https） */
function origin(c: C): string {
  const u = new URL(c.req.url)
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
  return `${local ? u.protocol : 'https:'}//${u.host}`
}
const redirectUri = (c: C) => `${origin(c)}/auth/callback`

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlDecode = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))

/** PKCE S256：code_challenge = base64url(sha256(code_verifier))，要的是原始位元組不是 hex，所以不用 session.ts 的 sha256 */
async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
}

/** return 只准 `#/...` 或 `/...`（不准 `//` 開頭的外站），其他一律回 /#/me */
function safeReturn(ret: string | undefined | null): string {
  if (!ret) return '/#/me'
  if (ret.startsWith('#/')) return '/' + ret
  if (ret.startsWith('/') && !ret.startsWith('//')) return ret
  return '/#/me'
}

const fail = (c: C, code: string) => {
  deleteCookie(c, OAUTH_COOKIE, { path: '/' })
  return c.redirect(`/#/signin?error=${encodeURIComponent(code)}`, 302)
}

interface OAuthState { state: string; verifier: string; ret: string }

interface GoogleClaims { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string }

/**
 * users upsert（§2）：先用 google_sub 找；沒有就用 email 找 google_sub is null 的（階段 1 匯入的舊帳號）補 sub；
 * 都沒有就 insert。每次都更新 name／avatar／last_sign_in_at。回 user id。
 */
async function upsertGoogleUser(env: Env, claims: Required<Pick<GoogleClaims, 'sub'>> & GoogleClaims): Promise<string> {
  const db = env.DB
  const bySub = await db.prepare('select id from users where google_sub = ?').bind(claims.sub).first<{ id: string }>()
  if (bySub) {
    await db.prepare('update users set email = coalesce(?, email), name = coalesce(?, name), avatar = coalesce(?, avatar), last_sign_in_at = ? where id = ?')
      .bind(claims.email ?? null, claims.name ?? null, claims.picture ?? null, now(), bySub.id).run()
    return bySub.id
  }
  if (claims.email) {
    const byEmail = await db.prepare('select id from users where google_sub is null and lower(email) = lower(?) order by created_at limit 1').bind(claims.email).first<{ id: string }>()
    if (byEmail) {
      await db.prepare('update users set google_sub = ?, name = coalesce(?, name), avatar = coalesce(?, avatar), last_sign_in_at = ? where id = ?')
        .bind(claims.sub, claims.name ?? null, claims.picture ?? null, now(), byEmail.id).run()
      return byEmail.id
    }
  }
  const id = crypto.randomUUID()
  await db.prepare('insert into users (id, google_sub, email, name, avatar, last_sign_in_at) values (?, ?, ?, ?, ?, ?)')
    .bind(id, claims.sub, claims.email ?? null, claims.name ?? null, claims.picture ?? null, now()).run()
  return id
}

const auth = new Hono<{ Bindings: Env }>()

// ── GET /auth/google ─────────────────────────────────────────────────────────
auth.get('/google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return fail(c, 'missing_config')
  const st: OAuthState = { state: randomToken(16), verifier: randomToken(32), ret: safeReturn(c.req.query('return')) }
  setCookie(c, OAUTH_COOKIE, b64url(new TextEncoder().encode(JSON.stringify(st))), { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: OAUTH_SECONDS })
  const q = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c),
    response_type: 'code',
    scope: 'openid email profile',
    state: st.state,
    code_challenge: await pkceChallenge(st.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return c.redirect(`${GOOGLE_AUTH}?${q}`, 302)
})

// ── GET /auth/callback ───────────────────────────────────────────────────────
auth.get('/callback', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID, secret = c.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !secret) return fail(c, 'missing_config')
  if (c.req.query('error')) return fail(c, c.req.query('error') === 'access_denied' ? 'access_denied' : 'google_error')

  // 1. state 要跟 cookie 裡的一樣
  const raw = getCookie(c, OAUTH_COOKIE)
  if (!raw) return fail(c, 'no_state')
  let st: OAuthState
  try { st = JSON.parse(b64urlDecode(raw)) as OAuthState } catch { return fail(c, 'bad_state') }
  const code = c.req.query('code'), state = c.req.query('state')
  if (!code || !state || !st?.state || state !== st.state || !st.verifier) return fail(c, 'bad_state')

  // 2. 換 token（帶 PKCE verifier）
  let idToken: string | undefined
  try {
    const r = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: redirectUri(c), grant_type: 'authorization_code', code_verifier: st.verifier }),
    })
    if (!r.ok) { console.error('google token exchange', r.status, await r.text().catch(() => '')); return fail(c, 'token_exchange') }
    idToken = ((await r.json()) as { id_token?: string }).id_token
  } catch (e) {
    console.error('google token exchange', e)
    return fail(c, 'token_exchange')
  }
  if (!idToken) return fail(c, 'no_id_token')

  // 3. 驗 id_token（簽章、iss、aud、exp）
  let claims: GoogleClaims
  try {
    claims = (await jwtVerify(idToken, JWKS, { issuer: GOOGLE_ISSUERS, audience: clientId })).payload as GoogleClaims
  } catch (e) {
    console.error('id_token verify', e)
    return fail(c, 'bad_id_token')
  }
  if (!claims.sub) return fail(c, 'no_sub')

  // 4. users upsert → session → 回 App
  let userId: string
  try {
    userId = await upsertGoogleUser(c.env, { ...claims, sub: claims.sub, email: claims.email_verified === false ? undefined : claims.email })
    deleteCookie(c, OAUTH_COOKIE, { path: '/' })
    await createSession(c, userId)
  } catch (e) {
    console.error('user upsert / session', e)
    return fail(c, 'db_error')
  }
  return c.redirect(safeReturn(st.ret), 302)
})

// ── GET /auth/me ─────────────────────────────────────────────────────────────
auth.get('/me', async (c) => {
  const user = await getUser(c)
  return c.json({ user }, 200, { 'cache-control': 'no-store' })
})

// ── POST /auth/logout ────────────────────────────────────────────────────────
auth.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true }, 200, { 'cache-control': 'no-store' })
})

// ── POST /auth/dev-login（只在本機）──────────────────────────────────────────
auth.post('/dev-login', async (c) => {
  if (c.env.DEV_LOGIN !== '1') return c.json({ error: 'not found' }, 404)
  const b = (await c.req.json().catch(() => ({}))) as { email?: unknown }
  const email = typeof b.email === 'string' && b.email.trim() ? b.email.trim() : 'dev@kitewise.test'
  let row = await c.env.DB.prepare('select id from users where lower(email) = lower(?) order by created_at limit 1').bind(email).first<{ id: string }>()
  if (!row) {
    row = { id: crypto.randomUUID() }
    await c.env.DB.prepare('insert into users (id, email, name, last_sign_in_at) values (?, ?, ?, ?)').bind(row.id, email, email.split('@')[0], now()).run()
  } else {
    await c.env.DB.prepare('update users set last_sign_in_at = ? where id = ?').bind(now(), row.id).run()
  }
  await createSession(c, row.id)
  // getUser 讀的是這次請求帶來的 cookie（還沒有），所以直接查表回 user
  const u = await c.env.DB.prepare('select id, email, name, avatar, lang, notify_push from users where id = ?').bind(row.id)
    .first<{ id: string; email: string | null; name: string | null; avatar: string | null; lang: string | null; notify_push: number | null }>()
  return c.json({ user: u ? { ...u, lang: u.lang ?? 'zh', notify_push: !!u.notify_push } : null }, 200, { 'cache-control': 'no-store' })
})

export default auth
