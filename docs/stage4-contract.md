# 全國版階段 4：登入、使用者資料、AI 食譜、即時查價、推播搬 Worker — API 契約

日期：2026-10-26。這份是階段 4 的**唯一真相**：Worker、App、Mac mini 三邊照這份做，改了要同時改這份。
背景與分工：`national-plan.md` §2.4、§3、§4、§10。開關：App 帶 `?src=d1`（`src/lib/api.ts` 的 `dataSource()`）才走這些；沒開照舊 Supabase。

## 0. 原則

- 路由在 Worker（Hono），檔案：`worker/auth.ts`（登入）、`worker/me.ts`（使用者資料）、`worker/ai.ts`（AI 食譜）、`worker/live.ts`（即時查價相關的公開／登入端點）、`worker/ingest.ts`（Mac mini 用的 `/ingest/*`，含即時查價領單回填與推播資料）、`worker/session.ts`（共用：讀 cookie → user）。`worker/index.ts` 只負責掛載。
- **登入狀態 = HttpOnly cookie `kw_session`**（SameSite=Lax、Secure、Path=/、90 天）。App 打 `/auth/*`、`/api/me/*`、`/api/ai-recipe`、`/api/price-requests*` 都要 `credentials: 'include'`。
- 沒登入打需登入的端點 → `401 {"error":"sign_in_required"}`。其他錯誤 `4xx/5xx {"error":"<code>", ...}`，code 用 snake_case。
- 時間一律 ISO 8601 UTC 字串；布林在回應裡是 true/false（D1 存 0/1，端點負責轉）；JSON 欄位回應裡是物件（D1 存字串）。
- 每個端點只碰自己的 user_id（`session.userId`），這是取代 RLS 的那條線。**每條寫入路由都要有這個 where**。
- D1 schema：`migrations/0001_init.sql` + 本階段的 `migrations/0002_user_data.sql`（§1）。`migrations/` 只加不改。

## 1. migration 0002（`worker/auth.ts` 的負責人寫）

```sql
-- users 補 profiles 的欄位（Supabase profiles 併進 users）
alter table users add column lang text default 'zh';
alter table users add column island text;
alter table users add column notify_push integer not null default 0;
alter table users add column last_sign_in_at text;      -- 0001 沒有；階段 1 匯入腳本有寫（存在就跳過：用 try）
-- sessions 補建立時間（0001 只有 id/user_id/expires_at）
alter table sessions add column created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- 即時查價「現在多少錢」：跟 Supabase store_prices 一模一樣（D1 的 store_prices 是每週生鮮／例外價，不是這個）
create table if not exists live_prices (
  store_id text not null, product_id text not null, product_key text,
  available integer not null default 1, price real, price_unit text, was_price real,
  is_special integer default 0, club_only integer default 0, multi_buy text, unit_price real, unit_price_unit text,
  name text, fetched_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source text not null default 'live' check (source in ('batch','live','user')),
  primary key (store_id, product_id)
);
create index if not exists live_prices_key on live_prices(product_key);
-- 自由輸入請 Mac mini 搜的結果：一張單 × 一個字一列
create table if not exists search_results (
  request_id text not null references price_requests(id) on delete cascade,
  store_id text not null, term text not null, candidates text not null default '[]',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (request_id, term)
);
create index if not exists price_requests_user on price_requests(user_id, created_at);
```
注意：D1 的 `alter table add column` 不支援 `if not exists`，0001 的 `users` 沒有 `last_sign_in_at` 但階段 1 匯入腳本可能已加（看 `pragma table_info(users)`）。migration 檔要能在正式庫（階段 1 匯過）和空庫都跑過：對 `last_sign_in_at` 這欄先 `select` 看看，不行就拆成兩個 migration 檔；最簡單是把 `last_sign_in_at` 那行拿掉（階段 1 已經有了）。

## 2. 登入（`worker/auth.ts`、`worker/session.ts`）

Google OIDC 自己接，不用 Supabase Auth。環境：`GOOGLE_CLIENT_ID`（wrangler.jsonc vars，公開）、`GOOGLE_CLIENT_SECRET`（secret）、`DEV_LOGIN`（vars，正式是空字串；`.dev.vars` 設 `1`）。驗 id_token 用 `jose`（`createRemoteJWKSet('https://www.googleapis.com/oauth2/v3/certs')`，iss `https://accounts.google.com`／`accounts.google.com`，aud = client id）。

| 端點 | 說明 |
|---|---|
| `GET /auth/google?return=<hash 或路徑>` | 302 到 Google。state = 隨機 + return；state 與 PKCE code_verifier 放 10 分鐘的 HttpOnly cookie `kw_oauth`。redirect_uri = `<origin>/auth/callback`（origin 取自請求的 URL）。scope `openid email profile`。 |
| `GET /auth/callback?code&state` | 驗 state → 換 token → 驗 id_token → `users` upsert：先用 `google_sub` 找；沒有就用 `email` 找 `google_sub is null` 的（階段 1 匯入的舊帳號）補 sub；都沒有就 `insert`（id = `crypto.randomUUID()`）。更新 name／avatar／last_sign_in_at。建 session：token = 32 bytes 隨機 base64url，**表裡存 sha256(token)** 當 `sessions.id`，expires 90 天。Set-Cookie `kw_session=<token>`。302 到 `/` + return（return 只准 `#/...` 或 `/...`，其他一律 `/#/me`）。失敗 302 到 `/#/signin?error=<code>`。 |
| `GET /auth/me` | `{ user: { id, email, name, avatar, lang, notify_push } }`，沒登入 `{ user: null }`（200）。`cache-control: no-store`。 |
| `POST /auth/logout` | 刪 session、清 cookie。`{ ok: true }`。 |
| `POST /auth/dev-login` | **只有 `DEV_LOGIN === '1'` 才存在**（正式回 404）。body `{ email?: string }`，沒給用 `dev@kitewise.test`。沒這個 user 就建；設 cookie。本機測整條流程用。 |

`worker/session.ts`（我先寫好骨架，auth 的負責人完成）：
```ts
export interface SessionUser { id: string; email: string | null; name: string | null; avatar: string | null; lang: string; notify_push: boolean }
export async function getUser(c): Promise<SessionUser | null>      // 讀 kw_session → sha256 → sessions join users，過期回 null
export async function requireUser(c): Promise<SessionUser>          // 沒有就 throw HTTPException(401, sign_in_required)
export async function createSession(c, userId): Promise<void>       // 寫 sessions、Set-Cookie
export async function destroySession(c): Promise<void>
```

## 3. 使用者資料 `/api/me/*`（`worker/me.ts`；全部要登入）

| 端點 | 回應／說明 |
|---|---|
| `GET /api/me/sync` | 一次拿同步要的全部：`{ stores: string[], list: { id, share_token: string\|null, items: ListItem[] }, watches: string[] }`。沒有清單就先建一份（`lists` 一人一份、name 預設）。 |
| `PUT /api/me/stores` | body `{ ids: string[] }`（≤ 3，照順序寫 position）→ 整組取代。`{ ok: true }` |
| `PUT /api/me/list/items` | body `{ items: ListItem[] }` → 這份清單的 items **整組取代**（upsert 每個 id、刪掉不在裡面的）。`{ ok: true, count }` |
| `POST /api/me/list/share` | 沒 share_token 就產生（16 碼 hex），回 `{ share_token }` |
| `GET /api/lists/:token` | **公開**：`{ name, items: ListItem[] }`，找不到 404。只回 items，不回 user。 |
| `PUT /api/me/watches/:key` / `DELETE /api/me/watches/:key` | `{ ok: true }` |
| `PUT /api/me/push` | body `{ endpoint, keys: {p256dh, auth} }` → `push_subscriptions` upsert（endpoint 是 PK；換人就改 user_id）+ `users.notify_push = 1`。 |
| `DELETE /api/me/push` | body `{ endpoint }` → 刪訂閱 + `users.notify_push = 0`。 |
| `GET /api/me/cards` | `LoyaltyCard[]`（見下）照 position、created_at 排 |
| `POST /api/me/cards` | body `{ chain, label, code, format }` → 新卡 position = max+1，回該列 |
| `PATCH /api/me/cards/:id` | body `{ position }` |
| `DELETE /api/me/cards/:id` | |
| `GET /api/me/ai-recipes` | 最新在前、最多 100 筆，`AiRecipeRow[]` |
| `GET /api/me/ai-recipes/:id` | 一筆或 404 |
| `DELETE /api/me/ai-recipes/:id` | |
| `PATCH /api/me` | body `{ lang?: 'zh'\|'en', island?: 'NI'\|'SI' }` |
| `DELETE /api/me` | 刪帳號：刪 `users` 列（cascade 清 sessions／user_stores／lists／list_items／watches／push_subscriptions／notifications／ai_recipes／loyalty_cards），清 cookie。`{ ok: true }` |

形狀（跟 App 現在從 Supabase 拿的一樣，App 端不用改欄位名）：
```ts
interface ListItem { id: string; product_key: string|null; free_text: string|null; qty: number; checked: boolean; source: string|null; position: number; price: number|null; checked_at: string|null }
interface LoyaltyCard { id: string; chain: string; label: string|null; code: string; format: string; position: number }   // D1 欄位叫 number，端點轉成 code
interface AiRecipeRow { id: string; created_at: string; title: string; cuisine: string|null; serves: number|null; minutes: number|null; kcal: number|null; difficulty: string|null; ingredients: unknown[]; steps: string[]; tip: string|null; image_url: string|null; image_credit: unknown|null }
// D1 ai_recipes 只有 id/user_id/created_at/lang/payload：payload 是整道（title…tip、anchors、prefs、week_start、image_url、image_credit），端點攤平成上面的列。
```
`list_items.product_key` 在 D1 **沒有外鍵**到 products，所以不會像 Supabase 那樣整批被清成 null，直接存。

## 4. AI 食譜（`worker/ai.ts`）

`POST /api/ai-recipe`：把 `supabase/functions/ai-recipe/index.ts`（爬蟲 repo，356 行）搬過來，**邏輯、prompt、schema、驗證、repair 一字不改**，只換底層：
- 登入：`requireUser`（取代 callerOf）。
- 額度：`ai_usage(day, scope, count)` D1 upsert（scope = `u:<uid>`、`ip:<cf-connecting-ip>`、`g:all`），上限 user 20／ip 30／global = `settings.ai_daily_cap`（預設 300）。
- 開關：`settings.ai_recipes === 'off'` → `503 {error:'paused'}`。
- OpenAI：`OPENAI_API_KEY` secret、`OPENAI_RECIPE_MODEL` var（預設 `gpt-5.4-mini`）。Workers 的 fetch 沒有 Deno 的 5 分鐘限制問題，照打。
- 紀錄：每道一列 `ai_recipes(id, user_id, created_at, lang, payload)`，payload = `{ title, cuisine, serves, minutes, kcal, difficulty, ingredients, steps, tip, anchors, prefs, week_start, image_url: null, image_credit: null }`；超過 `HISTORY_MAX = 10` 刪最舊的，回 `trimmed`。
- 回應形狀跟 Edge Function 一樣：`{ recipes: [{...recipe, dbId}], dropped, reasons, usage, trimmed, historyMax }`；錯誤碼一樣（`sign_in_required` 401、`quota` 429、`too_few_items` 400、`paused` 503、`ai_failed` 502）。

## 5. 即時查價（`worker/live.ts` 公開／App 端；`worker/ingest.ts` Mac mini 端）

D1 的 `price_requests`（0001）：`id, user_id, store_id, items (JSON [{product_id, product_key}])…`。本階段**改用這個形狀**：`items` = `{ product_ids: string[], product_keys: string[] }` 的 JSON；`queries` = JSON 字串陣列或 null；`result` 暫不用。

App 端（`worker/live.ts`）：
| 端點 | 說明 |
|---|---|
| `POST /api/price-requests` | 要登入。body `{ items: [{ store_id, product_ids?: string[], product_keys?: string[], queries?: string[] }] }`（≤ 5 個 item）。規則照 Supabase 的 `request_prices`：`settings.live_prices === 'off'` → 503 paused；每人一天 200 張（`price_requests.user_id` + created_at 24h）→ 429 rate_limited；全站一天 `settings.price_daily_cap`（預設 5000）→ 429 busy；每個 item：ids 每個 1–40 字、≤ 300 個，keys 每個 1–200 字、≤ 50 個，queries trim 後 1–60 字、去重、≤ 5 個；三個都空就跳過；store 要在 `stores`；**併單**：同店、status in (pending, running)、5 分鐘內、既有單的 ids ⊇ 這次 ids 且 keys ⊇ keys 且 queries ⊇ queries → 回既有 id。回 `{ ids: string[] }`（跟 items 對齊，跳過的位置是 null）。 |
| `GET /api/price-requests/status?ids=a,b` | 公開。`[{ id, status, error, ahead }]`，ahead = 比它早建、還在 pending/running 的張數（只有 pending 算，否則 0）。 |
| `GET /api/live-prices?stores=a,b&keys=k1,k2` | 公開。`live_prices` 列（≤ 5 店 × ≤ 100 key），布林轉 true/false、multi_buy 轉物件。 |
| `GET /api/name-matches?keys=` | 公開。`[{ chain, product_key, status, searched_at }]`（D1 欄位 chain_id → 回 `chain`，值是 `woolworths`／`foodstuffs`）。 |
| `GET /api/chain-items?keys=` | 公開。`[{ chain, product_id, product_key }]`（= Supabase product_ids；D1 `chain_items.chain_id` → `chain`）。 |
| `GET /api/chain-items/by-id?product_id=&chains=woolworths` | 公開。那個編號在這些連鎖已有的 key：`[{ chain, product_key }]` |
| `GET /api/search-results?ids=a,b&term=` | 公開。`[{ store_id, candidates }]` |
| `GET /api/products/search?zh=<字>&limit=500` | 公開。`families.name_zh like %字%` 的商品：`[{ key, family_key, family_name_zh }]`（取代 App 對 products.family_name_zh 的 ilike） |
| `POST /api/adopt-product` | 公開（Supabase 版 anon 也能叫）。body `{ chain, product_id, key, name, category_id?, store_id? }`。驗證照 Supabase `adopt_product`，但 D1 沒有 catalog：編號要在**一天內**那家連鎖的 `search_results` 候選裡，否則 400 unknown_product。做：products 補一列（已有不動；名字用候選的 brand+name+size）；`chain_items` 已有就不動，沒有就寫（Foodstuffs 兩家都寫）；給了 store_id 就把候選的價寫 `live_prices`（source user）。 |

Mac mini 端（`worker/ingest.ts` 加在現有檔案後面，Bearer `INGEST_TOKEN`）：
| 端點 | 說明 |
|---|---|
| `POST /ingest/price-requests/claim` | body `{ chain: 'newworld'\|'paknsave'\|'woolworths', limit?: 100 }` → 把 `store_id like 'chain:%'` 且 pending 的最舊 N 張**原子地**標 running（`claimed_at = now`；用 `update … where id in (select … limit N) returning *`），回 `{ requests: [{ id, store_id, product_ids, product_keys, queries, created_at }] }`（items 攤開）。 |
| `POST /ingest/price-requests/result` | body `{ ids: string[], status: 'done'\|'failed', error?: string, live_prices?: LivePriceRow[], search_results?: { request_id, store_id, term, candidates }[], name_matches?: { chain_id, product_key, status, candidate_product_id, score, candidates, searched_at }[], chain_items?: { chain_id, product_id, product_key }[] }` → 各表 upsert（live_prices 以 store_id+product_id；chain_items 已有不動），單標 status + done_at。 |
| `POST /ingest/price-requests/reset-running` | 啟動時叫：running → pending。`{ reset: n }` |
| `GET /ingest/price-requests/pending-count` | `{ pending: n }`（心跳用） |
| `POST /ingest/heartbeat` | body `{ name, info }` → `heartbeats` upsert |
| `GET /ingest/settings` | 全部 settings `{ key: value }`（worker 每分鐘讀 live_prices 開關） |
| `GET /ingest/push/digests?week=YYYY-MM-DD` | 推播要的資料，一人一筆：`[{ user_id, lang, subs: [{ endpoint, keys }], stores: string[], total: number, hits: [{ name, price, store }] }]`。只回有訂閱、而且這週 `notifications` 還沒有 `weekly_digest` 的人。total = 他的店這週 `store_specials.product_keys` 長度加總；hits = 他 `watches` 的 key 在他的店這週有特價的（價取 store_prices 覆蓋 chain_prices，最便宜那家；名字 products.display_name；store 連鎖名 New World／Woolworths／PAK'nSAVE）。 |
| `POST /ingest/push/sent` | body `{ user_id, week_start, kind, payload }` → `notifications` 插一列 |
| `POST /ingest/push/remove` | body `{ endpoint }` → 刪失效訂閱 |
| `GET /ingest/push/subscriptions` | `[{ user_id, endpoint, keys, lang }]`（測試推播用） |
| `GET /ingest/price-targets` | 週一批次查價要的：所有使用者 `lists.items ∪ watches` 的 key，配 `chain_items` 的編號，按店分組 `[{ store_id, product_ids: string[], product_keys: string[] }]`（store 取每個人的 `user_stores`） |
| `POST /ingest/prune-requests` | 新端點（不動既有 `/ingest/prune`）：刪一天前 done／failed 的 `price_requests`（search_results cascade）。Mac mini 每小時叫一次。 |

## 6. App 端（`src/`，只在 `useD1()` 時走新路；舊路一字不改）

- `src/lib/api.ts`：`apiGet/apiPost` 加 `credentials: 'include'`；加 `apiPut/apiPatch/apiDelete`；加 `authUrl(path)`。
- `useAuth`：d1 → `GET /auth/me` 填 `user`。**`user` 的形狀維持 Supabase User 的子集**（`id`、`email`、`user_metadata: { full_name, avatar_url }`），其他地方讀 `user.value?.id`／`name`／`avatar` 不用改。`signIn()` → `location.href = apiBase() + '/auth/google?return=' + encodeURIComponent(location.hash || '#/me')`。`signOut()` → `POST /auth/logout` 後 `user = null`。回來後網址沒有 `?code=`，不用清。
- `useSync`：pull → `GET /api/me/sync`；pushStores → `PUT /api/me/stores`；pushList → `PUT /api/me/list/items`；toggleWatch → `PUT/DELETE /api/me/watches/:key`；shareUrl → `POST /api/me/list/share`。合併規則不變。
- `SharedListView`：d1 → `GET /api/lists/:token`。
- `usePush`：`PUT/DELETE /api/me/push`。
- `useCards`：`/api/me/cards`。
- `lib/account.ts`：`DELETE /api/me`（成功後本機清理照舊）。
- `lib/aiRecipe.ts`：`call()` d1 → `POST /api/ai-recipe`（含 credentials）；history* → `/api/me/ai-recipes`。
- `useStorePrices`：store_prices → `/api/live-prices`；name_matches → `/api/name-matches`；product_ids → `/api/chain-items`；`request_prices` RPC → `POST /api/price-requests`（body 形狀見 §5；回 `{ids}`）；`price_request_status` → `GET /api/price-requests/status`。
- `useFreeText`：同上四個 + `search_results` → `/api/search-results`；`products.family_name_zh ilike` → `/api/products/search?zh=`；`adopt_product` RPC → `POST /api/adopt-product`；`catalog` 的查詢**不切**（D1 沒有 catalog，d1 模式下那幾段當作查無結果，不要報錯）。
- `useCatalog` 的 catalog 查詢同樣不切（d1 模式回空）。
- `useAdmin`／後台：不切（階段 5）。d1 模式下後台進不去是預期的，管理者用 `?src=supabase`。
- `SignInView`：按鈕叫 `signIn()` 就好；若有讀 `?error=` 顯示錯誤更好。

## 7. Mac mini 端（爬蟲 repo `src/`）

- `src/price-worker.ts`：**雙軌**。既有 Supabase 迴圈不動；另加一組 D1 迴圈：每家連鎖每秒 `POST /ingest/price-requests/claim`，領到就照現有邏輯問價／配名字／搜字（共用同一個瀏覽器與 `withChain` 鎖），結果 `POST /ingest/price-requests/result`。心跳同時 `POST /ingest/heartbeat`；開關同時看 `GET /ingest/settings` 的 live_prices。啟動時 `reset-running`。HTTP 共用 `src/ingest.ts` 的 `post()`（把它 export，加一個 `get()`）。
- `src/notify.ts`：**雙軌**。既有 Supabase 那段照舊；之後再 `GET /ingest/push/digests?week=` 對 D1 的人推（同一把 VAPID），成功 `POST /ingest/push/sent`，404/410 `POST /ingest/push/remove`。同一個 endpoint 兩邊都有就只推一次（先推 Supabase 的，記 endpoint set）。
- `src/prices.ts`（週一批次）：有空再做：`GET /ingest/price-targets` → 問價 → `POST /ingest/price-requests/result`（ids 空、只帶 live_prices、source 'batch'）。
- `.env` 已有 `INGEST_URL`、`INGEST_TOKEN`。

## 8. 使用者資料匯入（我做，`scripts/migrate-to-d1.ts` 加表）

Supabase → D1：`profiles` → `users.lang/island/notify_push`；`user_stores`；`shopping_lists` → `lists`；`list_items`；`watchlist` → `watches`；`push_subscriptions`；`notifications`；`ai_recipes` → `payload` JSON；`loyalty_cards`（`code` → `number`）。只有 3 個使用者，筆數很少。

## 9. 驗收

1. 本機：`wrangler dev`（`.dev.vars` 有 `DEV_LOGIN=1`、`INGEST_TOKEN`、`OPENAI_API_KEY`）+ `vite`（`.env.development.local` 的 `VITE_API_BASE`）：`POST /auth/dev-login` 後，選店／清單／關注／會員卡／AI 食譜／即時查價送單（本機沒 Mac mini，單會停在 pending，App 60 秒後顯示不確定即可）都能用、重整還在、登出後消失。
2. 正式站：Google 登入一次成功（要先把 `https://kitewise.nz/auth/callback` 加進 Google OAuth 用戶端、`wrangler secret put GOOGLE_CLIENT_SECRET`），舊帳號登入後看得到自己匯過去的清單和卡。
3. Mac mini：D1 的單被領走、回填 `live_prices`，App 一站看得到價；`pnpm run notify --dry` 列出 D1 的人。

## 10. 實作後的偏差（2026-10-26，以程式為準）

- `price_requests` 沒有 `error` 欄：失敗原因存 `result` JSON `{"error":"…"}`，`GET /api/price-requests/status` 讀出來當 `error`。
- `heartbeats` 表 0001 沒建 → `migrations/0003_heartbeats.sql`；`POST /ingest/heartbeat` 也會 create table if not exists。
- `POST /api/adopt-product` 回 `{ ok: true, key }`；驗證只看一天內的 `search_results`（D1 沒有 catalog）。
- `POST /ingest/price-requests/result` 接受 `ids: []`（週一批次只帶 live_prices、source 'batch'）；`live_prices.source` 預設 live。
- `/ingest/price-targets`：那家連鎖群沒有 chain_items 編號的 key 才放進 `product_keys`（讓 Mac mini 用名字配）。
- `ai_usage.day` 照 Edge Function 用 UTC 日期（0001 註解寫 NZ，先不改）。
- `/auth/google` 多帶 `prompt=select_account`；非 localhost 的 redirect_uri 一律 https。
- Mac mini 的 D1 軌還讀 Supabase 兩樣東西：`product_ids`（編號 → key）、`products.display_name`（名字配對）。**10-26 補好**：`GET /api/chain-items?ids=a,b`（≤ 300 個編號，可跟 keys= 一起）、`GET /api/products?keys=a,b&families=`（≤ 500）。爬蟲那邊改讀這兩個就能不碰 Supabase。
- 單子 claim 後若 result 送不出去會卡在 running：**10-26 起 `POST /ingest/prune-requests` 會把 claimed_at 超過 10 分鐘的 running 退回 pending**（回 `reset_stuck`），不用等 worker 重啟。
- ~~App 的 `SignInView` 還沒顯示 `?error=<code>`~~ 10-26 做了：access_denied／missing_config／bad_state 用白話，其他顯示碼（`auth.err.*` 字串）。
