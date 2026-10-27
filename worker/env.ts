/** Worker 的綁定與變數（wrangler.jsonc）。拆出來是因為 ingest.ts / snapshot.ts / auth.ts… 都要用，不然跟 index.ts 互相 import。 */
export type Env = {
  DB: D1Database
  DATA: R2Bucket
  /** 靜態檔（wrangler.jsonc assets.binding）：/admin 要從這裡拿 index.html */
  ASSETS: Fetcher
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  /** 爬蟲與 price-worker 用的鑰匙，`wrangler secret put INGEST_TOKEN` */
  INGEST_TOKEN?: string
  // ── 階段 4（docs/stage4-contract.md）──
  /** Google OAuth 用戶端 id（公開，wrangler.jsonc vars） */
  GOOGLE_CLIENT_ID?: string
  /** `wrangler secret put GOOGLE_CLIENT_SECRET` */
  GOOGLE_CLIENT_SECRET?: string
  /** '1' 才開 POST /auth/dev-login（只在 .dev.vars 設；正式是空字串） */
  DEV_LOGIN?: string
  /** `wrangler secret put ANTHROPIC_API_KEY`（2026-10-27 AI 食譜從 OpenAI 換成 Claude） */
  ANTHROPIC_API_KEY?: string
  /** AI 食譜用的模型，預設 claude-sonnet-5-5（wrangler.jsonc vars） */
  CLAUDE_RECIPE_MODEL?: string
  // ── 階段 5（docs/stage5-contract.md）：後台 /admin 的 Cloudflare Access ──
  /** Zero Trust 的 team domain，例如 kitewise.cloudflareaccess.com（wrangler.jsonc vars；沒設就退回 kw_session） */
  ACCESS_TEAM_DOMAIN?: string
  /** Access 應用程式的 AUD tag（公開值） */
  ACCESS_AUD?: string
}
