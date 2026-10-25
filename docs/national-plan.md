# KiteWise 全國版：搬到 Cloudflare 的規格

日期：2026-10-25
狀態：規格，尚未開工。現有 11 家店的版本（Supabase）只是測試，11 月後可直接被本版取代，不續費 Supabase。
分工：前端與 Worker API 在這個 repo（nz-deals-app）；爬蟲與 price-worker 在 Mac mini 的 nz-deals-crawler repo。

---

## 0. 目標與原則

- 覆蓋全紐西蘭三家連鎖約 390 家店（Woolworths 約 190、New World 約 140、PAK'nSAVE 約 60）。
- 全部跑在 Cloudflare：Workers（API）+ D1（資料庫）+ R2（每店每週的特價快照檔）。Supabase 退場。
- **價格按連鎖存，不按店存。** 包裝食品、冷凍、乾貨三家都是全連鎖統一價；只有生鮮各店自己訂價、各店賣的東西不一樣。這是資料量從 8 GB 變 1 GB、爬蟲從 13 小時變 2 小時的關鍵，不是可選項。
- 使用者看到的體驗不變：選 1 到 3 家店 → 同一樣東西哪家最便宜、分類瀏覽、搜尋、清單、關注、推播、食譜、AI 食譜。
- 「沒有資料」永遠不寫成「沒特價」（沿用 2026-09 的原則）。

## 1. 架構

```
Mac mini 爬蟲 ──(HTTPS, Bearer token)──▶ Worker /ingest/* ──▶ D1
                                                 │
                                                 └─▶ R2  specials/<store>/<week>.json（每次抓完重建）
手機 App（kitewise.nz）──▶ Worker /api/*  ──讀──▶ R2 快照 / D1
                        ──▶ Worker /auth/* （Google 登入，Cookie session）
後台（kitewise.nz/admin）──▶ Cloudflare Access 保護 ──▶ Worker /admin/*
Mac mini price-worker ──▶ Worker /ingest/price-requests（領單、回填）
AI 食譜 ──▶ Worker /api/ai-recipe（OPENAI_API_KEY 放 secret，每日上限記在 D1）
```

一個 Worker（現在的 `kitewise`）同時出靜態檔和 API，`run_worker_first` 只對 `/api/*`、`/auth/*`、`/ingest/*`、`/admin/*` 生效。API 用 Hono 寫（永光寺那站已經在用，照抄架構）。

## 2. 資料模型（D1 / SQLite）

### 2.1 連鎖與店

| 表 | 欄位 | 說明 |
|---|---|---|
| `chains` | id (woolworths / newworld / paknsave), name, member_label（Everyday Rewards / Club+） | 三列 |
| `stores` | id, chain_id, name, region, island, lat, lng, online, last_fetched_at, catalog_at | 約 390 列。id 沿用現在的格式 `chain:storeId` |

### 2.2 商品（連鎖一份，不分店）

| 表 | 欄位 | 說明 |
|---|---|---|
| `products` | key (PK), display_name, brand, size, category_id, family_key, is_food, image_url | 跨店共用的字典，沿用現在的 product_key 規則；display_name 用前端 displayName 的拼法 |
| `chain_items` | chain_id, product_id (超市編號), product_key, name_listed, url, seen_at；PK (chain_id, product_id) | 一個連鎖裡這個編號對應哪個 key；取代現在的 product_ids |
| `families` | key, name_en, name_zh | 同類可比 |
| `categories` | id, level, parent_id, name, name_zh | 以 Foodstuffs 分類為主幹，Woolworths 用對照表映射（現有 taxonomy 邏輯搬過來） |

### 2.3 價格（核心）

| 表 | 欄位 | 說明 |
|---|---|---|
| `chain_prices` | chain_id, product_key, week_start, price, regular_price, member_price, multi_buy (JSON), badges (JSON 陣列), price_unit, unit_price, unit_price_unit, promo_type；PK (chain_id, product_key, week_start) | **包裝食品**：全連鎖一份。每週約 1 萬列 |
| `store_prices` | store_id, product_key, week_start, 同上價格欄位；PK (store_id, product_key, week_start) | **生鮮**（fruit-and-vegetables、meat-poultry-and-seafood 兩個第一層）各店自己一份；其他分類只有在跟連鎖價不同時才寫一列（例外價）。每週約 3 萬列 |
| `store_specials` | store_id, week_start, product_keys (JSON 陣列或壓縮字串) | 這家店這週「哪些商品在特價」的清單，一店一週一列。查「某店特價」= 這張表的 key 清單 join chain_prices，再用 store_prices 覆蓋 |
| `store_items` | store_id, product_key, seen_at；PK (store_id, product_key) | 全商品目錄的「這家店有沒有賣」。取代現在的 catalog 表，商品本身不重複存 |

讀「Hastings Woolworths 這週特價」的順序：`store_specials` 拿 key 清單 → `chain_prices` 拿連鎖價 → `store_prices` 有的就覆蓋。這個合併在爬蟲寫完時做一次，結果寫成 R2 快照，App 不用自己 join。

保留 8 週，每週清一次更舊的。

### 2.4 使用者

| 表 | 說明 |
|---|---|
| `users` | id, google_sub, email, name, avatar, created_at |
| `sessions` | id, user_id, expires_at（Cookie 裡只放 session id） |
| `user_stores` | 選的店 |
| `lists`, `list_items` | 清單，含分享 token |
| `watches` | 關注的 product_key |
| `push_subscriptions`, `notifications` | 推播 |
| `ai_recipes`, `ai_usage` | AI 食譜紀錄與每日次數 |
| `loyalty_cards` | 會員卡錢包（現有功能，10-25 階段 0 補進來） |

### 2.5 營運

| 表 | 說明 |
|---|---|
| `settings` | key/value（live_prices、ai_recipes、announce、recipe_weekly…） |
| `admins` | email 白名單（後台另有 Cloudflare Access 擋第一道） |
| `crawl_runs`, `crawl_stores` | 沿用現在的欄位，含 slices / badges / tree |
| `admin_jobs` | 派工單 |
| `price_requests` | 即時查價的單；price-worker 用 token 來領 |
| `name_matches` | 名字配對結果（10-26 加 term、decided_by） |
| `product_dict`、`family_dict`、`taxonomy_map`、`health` | 階段 5 補：跨店配對字典、同類字典、綠超分類對照、Mac mini 健康（= Supabase 同名表；見 `docs/stage5-contract.md` §1） |
| `recipes` | 食譜正本（現有 Supabase `recipes` 表，10-25 階段 0 補進來；id / week_start / source / published / reviewed / data JSON） |

### 2.6 R2

- `specials/<store_id>/<week_start>.json`：這家店這週合併好的特價（跟 App 現在拿到的欄位一樣，加 badges、regular_price、member_price），約 1 MB，gzip 後約 150 KB。每次抓完重建，留 2 週。
- `catalog/<store_id>.json`：這家店有賣的 key 清單，一站模式查「有沒有賣」用。

## 3. API（Worker）

公開、可快取：
- `GET /api/stores` 店清單（含 last_fetched_at）
- `GET /api/specials/:store?v=<last_fetched_at>` 直接回 R2 快照，邊緣快取 7 天（現在的代理改成讀 R2，不再打資料庫）
- `GET /api/history/:key?stores=a,b,c` 近 8 週價格
- `GET /api/catalog/:store?v=<catalog_at>` 有賣的 key 清單
- `GET /api/settings` 公開開關

需登入（Cookie session）：
- `GET/PUT /api/me/stores`、`/api/me/list`、`/api/me/watches`、`/api/me/push`
- `POST /api/ai-recipe`
- `POST /api/price-requests`（一站即時查價送單）、`GET /api/price-requests/:id`

爬蟲與 price-worker（Bearer token，放 Worker secret 與 Mac mini 的 .env）：
- `POST /ingest/run/start`、`POST /ingest/run/:id/store`（每店結果與保命指標）、`POST /ingest/run/:id/finish`
- `POST /ingest/chain-prices`、`/ingest/store-prices`、`/ingest/store-specials`、`/ingest/store-items`、`/ingest/products`、`/ingest/chain-items`：每批最多 1,000 列，upsert，可重送
- `POST /ingest/snapshot/:store/:week` 觸發重建 R2 快照（或 ingest finish 時自動做）
- `GET /ingest/price-requests/claim`、`POST /ingest/price-requests/:id/result`

後台（Cloudflare Access 保護 `/admin/*`，免費方案 50 個使用者夠用）：
- 現有後台五頁的讀寫端點 → **`/admin/api/*`，端點清單在 `docs/stage5-contract.md` §2**；爬蟲端多 `/ingest/admin-jobs/*`、`/ingest/product-dict`、`/ingest/family-dict`、`/ingest/taxonomy-map`、`/ingest/health`（§3）。

## 4. 登入

- 自己接 Google OIDC：`/auth/google` 導去 Google → `/auth/callback` 換 token、驗 id_token、建 `users`／`sessions`、寫 HttpOnly Secure Cookie、導回原頁。用 `jose` 驗簽，不用大框架。
- 前端跟 API 同網域（kitewise.nz），Cookie 直接帶，不用 CORS、不用在前端存 token。
- 訪客照舊全功能可用（localStorage），登入只是同步到帳號。
- Google Cloud Console 的 OAuth 用戶端要加 `https://kitewise.nz/auth/callback`；對外上線前要過 Google 的同意畫面審核（logo、隱私權政策網址已有）。
- 推播：VAPID 公私鑰放 Worker secret；發送由 Worker 的 Cron Trigger 做（週一抓完觸發），不再靠 Mac mini。

## 5. 爬蟲怎麼改（Mac mini）

抓法：
1. **每個連鎖挑一家「參考店」整個分類翻**，拿包裝食品的連鎖價與徽章 → `chain_prices`。三家各約 150 個請求。
2. **每家店只抓兩件事**：(a) 生鮮兩個第一層分類的價格 → `store_prices`；(b) 這家店的特價商品清單（只要 key，不要整筆） → `store_specials`。綠超每店約 10 個請求，紅超黃超 Algolia 篩 onPromotion 約 3 到 5 個。
3. **每週一次**每家店翻全目錄拿「有沒有賣」→ `store_items`。
4. 寫入全部改成打 `/ingest/*`，批次 1,000 列；Supabase 的寫入在過渡期保留雙寫，切換後拿掉。
5. 保命機制照 backend-todo §5：分類沒拿滿不寫、徽章歸零先當失敗，這些指標跟著 `/ingest/run/:id/store` 送上來。

估算（要實測修正）：每次抓取約 3 家參考店 450 個請求 + 390 店 × 8 個 ≈ 3,600 個請求，間隔 1.5 秒約 1.5 小時；一天三次約 4.5 小時，一台 Mac mini 可以。全目錄那次一週一次約 390 × 30 = 12,000 個請求，約 5 小時，排在週日夜間。被擋的風險：綠超一天從約 1,750 個請求變約 4,000 個，要觀察 429／403，必要時拉長間隔或分兩台。

連鎖價怎麼判定「統一」：參考店抓到的價格先當連鎖價；第 2 步各店抓到的包裝商品價若與連鎖價不同，寫進 `store_prices` 當例外，並在報告列出「例外比例」。例外比例若長期高於 5%，代表假設錯，要回頭改。

## 6. 搬遷順序

| 階段 | 內容 | 誰 | 驗收 |
|---|---|---|---|
| 0 | 訂 Workers Paid（帳號層級）；建 D1 `kitewise`、R2 `kitewise-data`；Worker 加 Hono 骨架與 secrets | 前端 | `wrangler d1 execute` 建表成功 — **✅ 2026-10-25 做完**：D1 `kitewise`（OC 區）29 張表（`migrations/0001_init.sql`）、R2 `kitewise-data`、`worker/index.ts` Hono 骨架（/api/health、/api/specials 代理照舊；/ingest 驗 Bearer 回 501、/auth /admin 回 501）、`INGEST_TOKEN` 已放 Worker secret 與 Mac mini `~/nz-deals/.env`（另加 `INGEST_URL=https://kitewise.nz`） |
| 1 | 匯入可沿用的資料：products、families、categories、settings、recipes 字典、admins | 前端 | 筆數對得上 Supabase — **✅ 2026-10-25 做完**：爬蟲 repo 的 `scripts/migrate-to-d1.ts`（`export` → `apply --remote` → `verify --remote`，INSERT OR REPLACE 可重跑）灌進 D1 `kitewise`：chains 3、stores 387（island 由 region 推：Woolworths 的 CAN/OTA/STL/NSN/MBH/TAS/WTC 是 SI）、categories 781（name_zh 全有）、products 26,676、families 4,549（從 family_dict 彙整）、chain_items 21,241（← product_ids）、settings 8、admins 2、recipes 61；九張表筆數與 Supabase 全部一致。products 的 brand / size / image_url 來源沒有，先 null，階段 2 爬蟲補。踩到：D1 單句 100 KB 要算 UTF-8 位元組（中文 3 bytes）；UNION ALL 超過約 8 項會 `too many terms in compound SELECT`；這台到 Cloudflare 偶爾 fetch failed，腳本會重試 3 次。**10-25 晚再核對一次**：products 26,679／categories 781／settings 8／recipes 61／admins 2／chains 3／stores 387／chain_items 21,244 與 Supabase 全同；families 少 3（10-24～25 Supabase 新長出來的規則版同類），已補成 4,552。**雙寫期間 families 會一直落後**（/ingest 補 products 不補 families），階段 6 切換前要再跑一次 `migrate-to-d1.ts`（或只跑 families）。`name_matches` 不在這階段，D1 還是 0（Supabase 38）|
| 2 | 爬蟲改成雙寫（Supabase + `/ingest/*`），先 11 家店 | Mac mini | D1 的 11 家店資料與 Supabase 一致，R2 快照產生 — **✅ 2026-10-25 做完**。Worker：`worker/ingest.ts`（run start／store／finish、六張表批次 upsert ≤1,000 列、`POST /ingest/snapshot/:store/:week`、`POST /ingest/prune`）+ `worker/snapshot.ts`（store_specials → chain_prices → store_prices 覆蓋 → products／chain_items 補欄位，寫 `specials/<store>/<week>.json`，列的欄位跟 Supabase specials 一樣）；`cpu_ms` 50→200。爬蟲（nz-deals repo `src/ingest.ts`，`weekly` 抓完自動跑、失敗只 warn）：連鎖價＝這次抓到的店裡**最多店一樣**的那組價格（價、原價、會員價、多件、單位、單價），平手取最便宜；生鮮兩個第一層每店都寫 store_prices，其他分類只有跟連鎖價不同才寫（例外）；products 的 family_key 送 null、Worker 用 coalesce 留舊值。驗收（`pnpm run ingest -- --from-db` 推本週、`--verify` 逐店對 R2 快照）：11 家 27,686 列，key 與價格 **0 差異**；D1 chain_prices 8,550、store_prices 1,219；**例外比例 綠超 0.2%／紅超 0.3%／黃超 0.4%**（連鎖統一價假設成立）；D1 21 MB。Worker 用本機 `wrangler deploy` 上線（GitHub Actions 的 CLOUDFLARE_DEPLOY 還沒開）。已知：快照一家店約 3 MB（綠超 3,700 列），比估的 1 MB 大，階段 3 要靠 gzip／邊緣快取 |
| 3 | 前端 `/api/specials` 改讀 R2 快照；其他讀取改 D1；用 feature flag 切換 | 前端 | App 全部頁面在 D1 上跑通 — **✅ 2026-10-26 做完（旗標預設還是 Supabase）**。開關 `src/lib/api.ts` `dataSource()`：網址 `?src=d1`／`?src=supabase`（記在裝置 localStorage `nzd:src`），或 build 時 `VITE_DATA_SOURCE=d1` 讓全站預設走 D1。Worker：`worker/api.ts`（`/api/stores`、`/categories`、`/taxonomy-zh`、`/settings`、`/recipes`、`POST /products {keys|families}`、`/history/:key?stores=`），`/api/specials/:store` 帶 `src=d1` 回 R2 快照（這家店 ≤ 這週一的最新一週；邊緣快取 1 小時；gzip 後約 400 KB／店），快照列多 `products{family_key,…}` 巢狀跟 PostgREST embed 一樣。切了 9 處（useSpecials 含近 8 週、useStores、useCategories、useI18n、useSiteSettings、useRecipes、useCatalog 的 products、WatchingView、SharedListView）。**沒切、仍讀 Supabase**：一站的 `catalog` 貨架價、`store_prices`、`name_matches`、`product_ids`、`search_results`（即時查價機制，階段 4 連同 price-requests 一起搬）、使用者資料（階段 4）、後台（階段 5）。驗收：本機（vite + wrangler dev，`app/.env.development.local` 的 `VITE_API_BASE`）和正式站 kitewise.nz 開 `?src=d1`，用 Playwright 真 Chrome 走 首頁／分類／半價／生鮮／Top 10／搜尋／商品頁（含近 8 週）／食譜／清單／我的／關注／關於，**零 Supabase 請求、零 JS 錯誤**。踩到：`.env.local` 正式 build 也會讀（API 打到 127.0.0.1 上線半小時），要用 `.env.development.local`；D1 `UNION ALL` 超過約 8 項報錯、`IN (…)` 用 `json_each(?)` 繞 100 個綁定參數上限。接下來要切正式：`VITE_DATA_SOURCE=d1` build + deploy（或先請測試者用 `?src=d1`） |
| 4 | 登入、清單、關注、推播、AI 食譜搬到 Worker；現有登入使用者的清單匯過去 | 前端 | 登入後同步正常，推播收得到 — **✅ 2026-10-26 程式做完、上線，旗標仍預設 Supabase；Google 登入等兩件人工事**。契約 `docs/stage4-contract.md`。Worker：`auth.ts`（Google OIDC + PKCE，`jose` 驗 id_token，session 表存 sha256(token)、cookie `kw_session` 90 天；`/auth/dev-login` 只在 `DEV_LOGIN=1`）、`session.ts`、`me.ts`（`/api/me/*` 全部，每條寫入帶 user_id；`GET /api/lists/:token` 公開）、`ai.ts`（Edge Function 原封搬，額度 `ai_usage`、紀錄 `ai_recipes.payload`）、`live.ts`（`/api/price-requests*`、`/api/live-prices`、`/api/name-matches`、`/api/chain-items*`、`/api/search-results`、`/api/products/search`、`/api/adopt-product`）、`ingest.ts` 多 claim／result／reset-running／pending-count／heartbeat／settings／push digests／sent／remove／subscriptions／price-targets／prune-requests。migrations `0002_user_data.sql`（users 補 lang/island/notify_push/last_sign_in_at、sessions.created_at、`live_prices`、`search_results`）、`0003_heartbeats.sql`。App：`lib/api.ts` 加 credentials/apiFetch；useAuth／useSync／usePush／useCards／account／aiRecipe／useStorePrices／useFreeText／useCatalog／SharedListView 在 d1 時走 Worker。Mac mini：price-worker 雙軌（每秒 claim、同一個瀏覽器與鎖）、notify 雙軌（同 endpoint 只推一次）、prices 批次補 D1 清單的價。資料：3 個使用者、9 店、3 清單、39 項、2 關注、9 AI 紀錄、2 卡已匯進 D1（`scripts/migrate-to-d1.ts --only=users,…`）。驗收：本機 dev-login 走過 登入／同步／關注／會員卡／即時查價送單／登出；正式站無 cookie 一律 401、Google 302 正常；**正式 D1 塞一張單 → Mac mini 20 秒內領走回填 live_prices**；`notify --dry` 兩軌正常。**還要人做**：① Google Cloud Console 的 OAuth 用戶端加 redirect URI `https://kitewise.nz/auth/callback`（secret 已放 Worker）② OpenAI 帳號沒額度（429 no credits），AI 食譜兩邊都會失敗，要儲值。契約偏差：price_requests 沒 error 欄 → 錯誤存 `result` JSON；heartbeats 由 0003 補；adopt-product 回 `{ok,key}`；ai_usage.day 照舊用 UTC。已知：d1 模式後台不能用（階段 5）、一站替代品沒有 catalog 貨架價；`/api/chain-items` 缺批次 by-id、Mac mini D1 軌的品名還讀 Supabase products（階段 6 切換前要補 `/api/products?keys=`） |
| 5 | 後台搬到 `/admin`，Cloudflare Access 保護 | 前端 | 五頁都能用 — **✅ 2026-10-26 程式與 Access 做完**（契約 `docs/stage5-contract.md`）：真路徑 `https://kitewise.nz/admin`（Worker 出 index.html → App 跳 `#/admin`）；Cloudflare Access 應用程式「KiteWise 後台」（team `orange-base-53db.cloudflareaccess.com`、path `admin`、原則 KiteWise admins = 兩個管理員 email、One-time PIN 登入）在邊緣擋，`worker/admin.ts` 再驗 Access JWT + `admins` 表；`/admin/api/*` 七頁的讀寫端點；`migrations/0004_admin.sql`（product_dict / family_dict / taxonomy_map / health + name_matches 加 term、decided_by），三本字典 10-26 從 Supabase 匯入一次（22,472 / 26,679 / 659）；`/ingest` 多 admin-jobs claim／result、product-dict／family-dict／taxonomy-map、health（爬蟲那邊還要接，見契約 §3）。App `?src=d1` 時走 `src/lib/adminApi.ts`，Supabase 路徑不動。沒 Access 的本機退回 kw_session + admins |
| 6 | 停雙寫，Supabase 退場 | 兩邊 | 一週無 Supabase 請求 |
| 7 | 擴店：Hawke's Bay 11 → 北島 → 全國，每階段看爬蟲時間、請求數、429 次數、例外比例 | Mac mini | 每階段報告 |

階段 0 到 3 大約兩週，4 到 6 再一到兩週，7 看超市反應。

## 7. 額度與費用

| 項目 | 全國版估算 | Cloudflare 額度 |
|---|---|---|
| D1 大小 | 約 1 GB（8 週） | 免費 5 GB／付費單庫 10 GB |
| D1 每日寫入 | 約 2 萬列，全目錄那天約 10 萬 | 免費 10 萬／付費 5,000 萬每月 |
| D1 每日讀取 | 看使用者數，快照走 R2 所以很少 | 免費 500 萬 |
| R2 | 不到 1 GB | 免費 10 GB |
| Worker 請求 | 每使用者每天約 10 次 | 免費每天 10 萬／付費每月 1,000 萬 |
| 費用 | Workers Paid 美金 5／月，其餘在額度內 | — |

## 8. 風險

- **連鎖統一價的假設**：Foodstuffs 各店是加盟主，特價清單是全國的但偶有例外；用例外比例監控。
- **超市封鎖**：請求量翻倍。先北島、再全國，盯 429。
- **D1 是 SQLite**：沒有 RLS、沒有 jsonb 查詢，權限在 Worker 判斷；大批 upsert 要用 batch API。
- **Google 登入審核**：對外前要送審，提早開始。
- **Mac mini 單點**：爬蟲和 price-worker 仍在一台機器上；壞了全國資料停更。至少每日備份 D1（`wrangler d1 export`）。

## 9. 現在就要做的

1. Cloudflare 後台訂 Workers Paid（帳號層級，一次就好）。
2. 給我一個 Google Cloud 專案的 OAuth 用戶端（或我建一個新的，需要你登入 Google Cloud Console）。
3. 爬蟲那邊先照第 5 節評估「參考店 + 各店生鮮」的請求數，實測一家店。

---

## 10. 給接手開發的 AI／工程師：先讀這段

**兩個 repo、兩個角色，不要互相改對方的東西：**

| 角色 | Repo | 範圍 |
|---|---|---|
| A 前端＋Worker | GitHub `Winsonboy23/nz-deals-app`（公開，本檔所在） | `src/`（Vue 3 App）、`worker/`（Cloudflare Worker API）、`wrangler.jsonc`、D1 schema 與 migrations、R2 快照格式、Google 登入、後台 |
| B 爬蟲 | GitHub `Winsonboy23/nz-deals-crawler`（私人，跑在 Mac mini） | 抓三家超市、寫入 `/ingest/*`、price-worker、保命機制 |

兩邊的**契約**就是本檔第 2 節（資料欄位）、第 3 節（`/ingest/*` API）。改契約要同時改本檔並通知對方。

**現況（2026-10-25）**
- 正式站 https://kitewise.nz 已在 Cloudflare 上跑（Worker `kitewise`，Workers static assets），資料還在 Supabase（專案 mzuckacocbeuekdzikzu，只是測試資料，11 月後不續費）。
- `worker/index.js` 已有一支 `/api/specials` 快取代理，是第 3 節 API 的雛形，之後改讀 R2 快照。
- 前端讀資料集中在 `src/composables/useSpecials.ts`（特價）、`useStores.ts`（店）、`useStorePrices.ts`（即時查價）、`useList.ts`／`useSync.ts`（清單同步）、`useAuth.ts`（登入）、`usePush.ts`（推播）、`src/lib/aiRecipe.ts`（AI 食譜）。所有 `supabase.from(...)`、`supabase.rpc(...)`、`supabase.auth` 的呼叫就是要換掉的地方，用 `grep -rn "supabase\." src` 列出。
- 前端的價格顯示與排序規則不要動：單件價為基準（`src/lib/compare.ts` 的 `rankPrice`）、`PriceLine.vue` 負責所有價格排版、文案「沒有資料」不說「沒特價」。
- 既有文件：`docs/deploy-cloudflare.md`（部署）、`docs/backend-todo.md`（爬蟲已完成與待辦）。
- 工具：pnpm 12（`corepack pnpm`）、Node 24、`npx wrangler`（這台 Mac 已登入 Cloudflare 帳號 winsonboy23@gmail.com）。測試：`pnpm test`、`pnpm typecheck`、`pnpm build`。

**工作方式**
- 照第 6 節的階段順序做，每個階段一個 PR 或一個 commit 系列，commit 訊息寫做了什麼、驗收數字多少。
- 不碰正式資料的破壞性操作（DROP、TRUNCATE、DELETE 整表）；D1 的 schema 用 migrations 檔，只加不刪。
- 任何秘密（OAuth client secret、ingest token、OPENAI key、VAPID 私鑰）只放 `wrangler secret put` 與 Mac mini 的 `.env`，不進 git、不印在對話。
- 每個階段做完回報：改了哪些檔、怎麼驗證、數字、還有什麼要決定。
