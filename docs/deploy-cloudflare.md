# 部署到 Cloudflare（2026-10-22 起）

正式站從 Zeabur（nz-deals.zeabur.app）搬到 Cloudflare。GitHub Pages（gh-pages 分支）是舊的備援，之後可以不管。

## 現在長什麼樣

- Cloudflare 帳號：winsonboy23@gmail.com，專案名稱 `kitewise`（Workers static assets，也就是新版的 Pages）。
- 網址：https://kitewise.yongguang-web.workers.dev （之後接自訂網域就換成那個）。
- 設定檔：`wrangler.jsonc`（專案名、assets 目錄 `dist`、找不到的路徑回 404、`/api/*` 交給 `worker/index.js`）。
- `worker/index.js`：特價資料的 Supabase 快取代理 `/api/specials/<store>?v=…`，邊緣快取 7 天、key 帶爬蟲抓取時間，Supabase 每個版本只送一次（2026-10-25，為了 Egress 額度）。
- 回應標頭：`public/_headers`（assets 永久快取；index、sw.js、manifest 不快取）。
- 自動部署：`.github/workflows/deploy-cloudflare.yml`，推到 main 就 build + deploy。

## 手動部署（這台 Mac 已登入 wrangler）

```bash
corepack pnpm build && npx wrangler deploy
```

## 自動部署要先設一次

1. Cloudflare 後台 → My Profile → API Tokens → Create Token → 用「Edit Cloudflare Workers」範本 → 建立，複製 token。
2. 在 repo 執行 `gh secret set CLOUDFLARE_API_TOKEN`，貼上 token。
3. 打開開關：`gh variable set CLOUDFLARE_DEPLOY --body true`。
4. 之後每次推 main 都會自動部署；Actions 頁面可以看結果。

已經設好的 repo 變數：`CLOUDFLARE_ACCOUNT_ID`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（都是公開值）。`VITE_VAPID_PUBLIC_KEY` 還沒設，推播要用的話把公鑰填進去：`gh variable set VITE_VAPID_PUBLIC_KEY --body <公鑰>`。

## 換網址要跟著做的事

1. **Supabase 登入白名單**：Supabase 後台 → Authentication → URL Configuration → Redirect URLs 加上新網址（`https://kitewise.yongguang-web.workers.dev/**`，有自訂網域也一起加）。沒加的話 Google 登入會跳回舊網址。
2. **Meta（Facebook 登入）**：Meta 開發者後台 → App 設定 → App Domains 加新網域；隱私權政策網址改成新網址的 `/privacy.html`。
3. **訪客資料搬家**：App 後台「開關」頁把 `migrate_host` 填成新網址的主機名（例如 `kitewise.yongguang-web.workers.dev`）。填了之後，舊網址一打開就會把訪客的店、清單、語言帶去新網址（src/lib/migrate.ts）。確定新站沒問題再填。
4. **推播**：訂閱綁在網址上，舊網址訂的在新網址要重新訂一次。
5. **自訂網域**：kitewise.nz 和 kitewise.co.nz 買在 1st Domains（帳號 12574924）。2026-10-24 已把 kitewise.nz 加進 Cloudflare（nameserver：earl.ns.cloudflare.com、jule.ns.cloudflare.com），1st Domains 那邊關掉 parking、填上這兩個 nameserver。
   生效後（Cloudflare 網域狀態變 Active）：刪掉 DNS 裡掃進來的兩筆停泊紀錄（A kitewise.nz → 210.55.30.93、CNAME www），再 `npx wrangler deploy`，wrangler.jsonc 的 routes 會自動把 kitewise.nz 和 www 接上。
   kitewise.co.nz 之後同樣流程加進 Cloudflare，再用 Redirect Rule 轉到 kitewise.nz。

## 舊站怎麼處理

- Zeabur 先留著跑，等 migrate_host 生效、使用者都搬過去了再關。
- `src/lib/migrate.ts` 的 `OLD_HOST` 是 `nz-deals.zeabur.app`，關掉 Zeabur 之前不要改。
