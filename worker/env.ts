/** Worker 的綁定與變數（wrangler.jsonc）。拆出來是因為 ingest.ts / snapshot.ts / auth.ts… 都要用，不然跟 index.ts 互相 import。 */
export type Env = {
  DB: D1Database
  DATA: R2Bucket
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
  /** `wrangler secret put OPENAI_API_KEY` */
  OPENAI_API_KEY?: string
  /** AI 食譜用的模型，預設 gpt-5.4-mini */
  OPENAI_RECIPE_MODEL?: string
}
