# 全國版階段 5：後台搬 `/admin`、Cloudflare Access 保護 — 契約

日期：2026-10-26。Worker、App、Mac mini 三邊照這份做，改了要同時改這份。背景：`national-plan.md` §3「後台」、§6 階段 5。

## 0. 原則

- 後台網址：**`https://kitewise.nz/admin`**（真路徑，不是 `/#/admin`）。Worker 對 `GET /admin`、`/admin/` 回 App 的 index.html，App 一開就跳到 `#/admin`。
- 兩道門：
  1. **Cloudflare Access**（Zero Trust → Access → Applications，self-hosted，domain `kitewise.nz`、path `admin`）擋在邊緣：沒通過的人連 HTML 都拿不到。登入方式用 Access 內建的 One-time PIN（寄驗證碼到信箱），不用 Google OAuth 設定。
  2. **Worker 驗 Access 的 JWT**（`Cf-Access-Jwt-Assertion` header，jose 對 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` 驗簽、aud = 應用程式的 AUD）→ email（小寫）要在 `admins` 表。兩個都過才算管理員。
  - `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 放 `wrangler.jsonc` vars（公開值）。**沒設這兩個**（本機 `wrangler dev`）就退回 `kw_session`（階段 4 的登入 cookie）+ `admins` 表。
- 後台 API 全部在 `/admin/api/*`，回 JSON；沒權限 `401 {"error":"admin_required"}`（Access 沒過時其實連 Worker 都到不了，會被 302 去 Access 登入頁）。
- App 只在 `?src=d1` 時走這些；Supabase 那條路一字不改（管理者還是可以 `?src=supabase` 用舊後台）。
- D1 schema：`migrations/0004_admin.sql`（§1）。只加不改。

## 1. migration 0004

| 表 | 說明 |
|---|---|
| `product_dict` | 跨店配對字典（= Supabase `product_dict`）：dict_key PK、product_key、matched_to、confidence、source、updated_at。待審 = source 'ai' 且 matched_to 非空且 confidence < 0.8 |
| `family_dict` | 同類字典（= Supabase `family_dict`，一樣一列）：product_key PK、family_key、name_en、name_zh、confidence、source、cat2、updated_at。`products.family_key` / `families` 是它的「套用結果」 |
| `taxonomy_map` | Woolworths 分類 → Foodstuffs 分類對照（= Supabase）：PK (level, ww_path)、fs_path、ww_key、status、score、note、updated_at |
| `health` | Mac mini 健康（ops/health.sh 每 10 分鐘一列）：at PK、load、top (JSON)、chrome、orphan、mem_free_mb |
| `name_matches` 加欄 | `term`、`decided_by`（後台顯示搜了什麼字、人工判的標記） |

資料：10-26 用 Supabase Management API 匯過一次（product_dict 22,472、family_dict 26,679、taxonomy_map 659；health 不匯）。**雙寫期間這三張表會落後**，要靠 §3 的 `/ingest` 端點由爬蟲同步，階段 6 切換前再全匯一次。

## 2. 後台 API（`worker/admin.ts`，全部要管理員）

| 端點 | 回應 |
|---|---|
| `GET /admin/api/me` | `{ admin: true, email, via: 'access' \| 'session' }`；不是管理員 401 |
| **待審** | |
| `GET /admin/api/review/pairs` | `[{ dict_key, product_key, confidence, matched_to, display_name, a: Side\|null, b: Side\|null }]`（最多 50，confidence 升冪）。Side = 這個編號在 `chain_items` 的 name_listed / url + `products` 的 brand、size、category_id、image_url，價格取本週 chain_prices（沒有就 null） |
| `POST /admin/api/review/pairs/decide` | body `{ dict_key, same }` → 插 `admin_jobs(kind 'decide_pair', payload {dict_key, same})`。`{ id }` |
| `GET /admin/api/review/names` | `name_matches` status in (review, none) 最新 200：`[{ chain, product_key, name, term, candidates, status }]`（chain = chain_id） |
| `POST /admin/api/review/names/same` | body `{ chain, product_key, product_id }` → `chain_items` upsert（woolworths 一列；foodstuffs 寫 newworld + paknsave 兩列）+ `name_matches` status matched、candidate_product_id、decided_by manual |
| `POST /admin/api/review/names/none` | body `{ chain, product_key }` → status none、decided_by manual |
| **同類** | |
| `GET /admin/api/family/low` | `family_dict` confidence < 0.6 前 200，附 products.display_name：`[{ product_key, family_key, name_en, name_zh, confidence, cat2, display_name }]` |
| `GET /admin/api/family/big?min=30` | `[{ family_key, n }]`（group by，n ≥ min，n 降冪） |
| `GET /admin/api/family/:key/members` | 這個同類的列（最多 500，附 display_name） |
| `POST /admin/api/family/rename` | body `{ family_key, name_en, name_zh }` → family_dict 整個同類改名（source manual、confidence 1）+ `families` upsert。Worker **直接套用**，不派工。`{ keys: string[] }` |
| `POST /admin/api/family/move` | body `{ product_key, to }` → 那一列改 family_key（名字沿用目標；目標要存在）+ `products.family_key`。`{ ok }` |
| `POST /admin/api/family/merge` | body `{ from, to }` → from 的每列改成 to + products 跟著改。`{ keys }` |
| **每週報告** | |
| `GET /admin/api/runs` | `crawl_runs` 最新 20，欄位對齊舊後台：`ms` = seconds×1000、`needs_review` null、report 解成物件 |
| `GET /admin/api/runs/:id/stores` | `crawl_stores`（ok 升冪），`ms` 同上、`error`、`added/changed/removed` |
| `GET /admin/api/jobs?kind=&limit=20` | `admin_jobs` 最新：`[{ id, kind, payload, status, log, created_at, done_at }]`（log = result、done_at = finished_at） |
| `POST /admin/api/jobs` | body `{ rows: [{ kind, payload? }] }`（kind 只准 refetch_store / prices / notify_test / decide_pair / recat_week / family_apply / restart_worker）→ `{ ids }` |
| **即時查價** | |
| `GET /admin/api/live` | `{ requests: [{ id, store_id, product_ids, product_keys, status, error, created_at, done_at }]（7 天內最新 500）, heartbeat: { at, info } \| null, health: Health[]（最新 144）, name_counts: { matched, review, none } }` |
| **分類** | |
| `GET /admin/api/taxonomy/unmapped` | 最新一次 crawl_run 的 `report.unmappedCategories` + `{ run_at }` |
| `POST /admin/api/taxonomy/map` | body `{ level, ww_path, fs_path, note? }` → taxonomy_map upsert（status manual）。`{ ok }` |
| `GET /admin/api/taxonomy/manual` | status manual 最新 100 |
| `GET /admin/api/taxonomy/zh` | `[{ name, zh }]`（categories.name_zh，同名取一） |
| `PUT /admin/api/taxonomy/zh` | body `{ name, zh }` → 所有同 name 的 categories.name_zh 改掉 |
| **食譜** | |
| `GET /admin/api/recipes` | 全部（含未上架）`[{ id, week_start, source, published, reviewed, data }]` |
| `PATCH /admin/api/recipes/:id` | body `{ published?, reviewed?, data? }` → `{ ok }`；找不到 404 |
| `POST /admin/api/recipes/bulk` | body `{ ids, published }` → `{ changed }` |
| `DELETE /admin/api/recipes/:id` | |
| **使用者** | |
| `GET /admin/api/users` | `{ users: [{ id, email, created_at, last_sign_in_at, lang, pushed, stores: string[], list_count, watch_count }], notifications: [...50], ai_usage: [{ caller, day, count }]（7 天；caller = scope）, ai_recipes: [{ id, user_id, created_at, title }]（20） }` |
| **開關** | |
| `GET /admin/api/settings` | `[{ key, value }]` |
| `PUT /admin/api/settings` | body `{ rows: [{ key, value }] }` → upsert。key 只准 live_prices / ai_recipes / ai_daily_cap / price_daily_cap / announce / recipe_weekly / migrate_host / facebook_login |

## 3. Mac mini 端（`/ingest/*`，Bearer `INGEST_TOKEN`；爬蟲 repo 之後實作，階段 6 前要接上）

| 端點 | 說明 |
|---|---|
| `POST /ingest/admin-jobs/claim` | body `{ kinds?: string[], limit?: 10 }` → pending 最舊 N 張原子地標 running（started_at）→ `{ jobs: [{ id, kind, payload, created_at }] }` |
| `POST /ingest/admin-jobs/:id/result` | body `{ status: 'done'\|'failed', log? }` → finished_at、result = log |
| `POST /ingest/product-dict` | `{ rows: [{ dict_key, product_key, matched_to, confidence, source, updated_at }] }` 批次 upsert（≤ 1,000） |
| `POST /ingest/family-dict` | `{ rows: [{ product_key, family_key, name_en, name_zh, confidence, source, cat2, updated_at }] }` upsert；**同時**把 products.family_key 和 families 跟著更新 |
| `GET /ingest/taxonomy-map` | 全部列（爬蟲 `loadTaxonomyMap` 改讀這裡） |
| `POST /ingest/taxonomy-map` | `{ rows }` upsert |
| `POST /ingest/health` | `{ at?, load, top, chrome, orphan, mem_free_mb }` → 一列；順便刪 7 天前的 |

`admin_jobs` 的 kind 與 payload 跟 Supabase 版一樣（refetch_store {store_id}、prices、notify_test、decide_pair {dict_key, same}、recat_week、family_apply {product_keys}、restart_worker）。

## 4. App 端（`?src=d1` 才走）

- `src/lib/adminApi.ts`：`adminGet/Post/Put/Patch/Delete`（`apiFetch` 包一層；回應不是 JSON（被 Access 302 到登入頁）→ 整頁 `location.replace('/admin')` 一次，讓 Access 接手）。
- `useAdmin`：d1 → `GET /admin/api/me`。
- 七個 `components/admin/*.vue`：每個讀寫在 `useD1()` 時改叫上面的端點，形狀對齊所以畫面不改。
- `main.ts`：`location.pathname === '/admin'` 且沒 hash → `#/admin`。
- `vite.config.ts`：PWA `navigateFallbackDenylist: [/^\/admin/]`，`/admin` 一律走網路，Access 才攔得到。

## 5. 驗收

1. 本機 `wrangler dev`（沒設 ACCESS_*）：dev-login 的 email 在 admins → 七頁都能讀寫；不在 → 401。
2. 正式：沒登入 Access 開 `kitewise.nz/admin` 被導去 Access 登入；PIN 過了、email 在 admins → 後台七頁都有資料；email 不在 admins → App 顯示沒權限。
3. `curl https://kitewise.nz/admin/api/settings` 沒 cookie → 302（Access）。
