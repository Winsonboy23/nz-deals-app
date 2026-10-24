/** Worker 的綁定與變數（wrangler.jsonc）。拆出來是因為 ingest.ts / snapshot.ts 也要用，不然跟 index.ts 互相 import。 */
export type Env = {
  DB: D1Database
  DATA: R2Bucket
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  /** 爬蟲與 price-worker 用的鑰匙，`wrangler secret put INGEST_TOKEN` */
  INGEST_TOKEN?: string
}
