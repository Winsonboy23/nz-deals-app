-- KiteWise 全國版 D1 初始表（docs/national-plan.md §2，2026-10-25 階段 0）。
-- 規則：之後只加新的 migration，不改不刪這份。SQLite 沒有 jsonb，JSON 欄位存 TEXT；時間存 ISO 字串；布林存 0/1。

-- §2.1 連鎖與店 --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chains (
  id            TEXT PRIMARY KEY,            -- woolworths / newworld / paknsave
  name          TEXT NOT NULL,
  member_label  TEXT                         -- Everyday Rewards / Club+
);

CREATE TABLE IF NOT EXISTS stores (
  id               TEXT PRIMARY KEY,         -- '{chain}:{storeId}'，沿用現在的格式
  chain_id         TEXT NOT NULL REFERENCES chains(id),
  name             TEXT NOT NULL,
  region           TEXT,
  island           TEXT,                     -- NI / SI
  lat              REAL,
  lng              REAL,
  online           INTEGER NOT NULL DEFAULT 1,
  last_fetched_at  TEXT,                     -- 特價最後抓取時間（App 帶的 v）
  catalog_at       TEXT                      -- 全目錄最後抓取時間
);
CREATE INDEX IF NOT EXISTS stores_chain ON stores(chain_id);

-- §2.2 商品（連鎖一份，不分店）---------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  key           TEXT PRIMARY KEY,            -- 跨店共用的 product_key
  display_name  TEXT NOT NULL,
  brand         TEXT,
  size          TEXT,
  category_id   TEXT,
  family_key    TEXT,
  is_food       INTEGER NOT NULL DEFAULT 1,
  image_url     TEXT
);
CREATE INDEX IF NOT EXISTS products_family ON products(family_key);
CREATE INDEX IF NOT EXISTS products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS chain_items (   -- 取代現在的 product_ids
  chain_id     TEXT NOT NULL REFERENCES chains(id),
  product_id   TEXT NOT NULL,                -- 超市自己的編號 / SKU
  product_key  TEXT NOT NULL,
  name_listed  TEXT,
  url          TEXT,
  seen_at      TEXT,
  PRIMARY KEY (chain_id, product_id)
);
CREATE INDEX IF NOT EXISTS chain_items_key ON chain_items(product_key);

CREATE TABLE IF NOT EXISTS families (
  key      TEXT PRIMARY KEY,
  name_en  TEXT,
  name_zh  TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,               -- Foodstuffs 分類 slug
  level      INTEGER NOT NULL,               -- 1 / 2 / 3
  parent_id  TEXT,
  name       TEXT NOT NULL,
  name_zh    TEXT
);
CREATE INDEX IF NOT EXISTS categories_parent ON categories(parent_id);

-- §2.3 價格（核心）----------------------------------------------------------
CREATE TABLE IF NOT EXISTS chain_prices (  -- 包裝食品：全連鎖一份
  chain_id         TEXT NOT NULL,
  product_key      TEXT NOT NULL,
  week_start       TEXT NOT NULL,            -- 該週週一 YYYY-MM-DD
  price            REAL NOT NULL,
  regular_price    REAL,
  member_price     REAL,
  multi_buy        TEXT,                     -- JSON {qty,total}
  badges           TEXT,                     -- JSON 陣列
  price_unit       TEXT,
  unit_price       REAL,
  unit_price_unit  TEXT,
  promo_type       TEXT,
  PRIMARY KEY (chain_id, product_key, week_start)
);
CREATE INDEX IF NOT EXISTS chain_prices_key_week ON chain_prices(product_key, week_start);
CREATE INDEX IF NOT EXISTS chain_prices_week ON chain_prices(week_start);

CREATE TABLE IF NOT EXISTS store_prices (  -- 生鮮各店一份；其他分類只在跟連鎖價不同時寫（例外價）
  store_id         TEXT NOT NULL,
  product_key      TEXT NOT NULL,
  week_start       TEXT NOT NULL,
  price            REAL NOT NULL,
  regular_price    REAL,
  member_price     REAL,
  multi_buy        TEXT,
  badges           TEXT,
  price_unit       TEXT,
  unit_price       REAL,
  unit_price_unit  TEXT,
  promo_type       TEXT,
  PRIMARY KEY (store_id, product_key, week_start)
);
CREATE INDEX IF NOT EXISTS store_prices_key_week ON store_prices(product_key, week_start);
CREATE INDEX IF NOT EXISTS store_prices_week ON store_prices(week_start);

CREATE TABLE IF NOT EXISTS store_specials ( -- 這家店這週哪些 key 在特價，一店一週一列
  store_id      TEXT NOT NULL,
  week_start    TEXT NOT NULL,
  product_keys  TEXT NOT NULL,               -- JSON 陣列
  PRIMARY KEY (store_id, week_start)
);

CREATE TABLE IF NOT EXISTS store_items (   -- 取代現在的 catalog：這家店有沒有賣
  store_id     TEXT NOT NULL,
  product_key  TEXT NOT NULL,
  seen_at      TEXT,
  PRIMARY KEY (store_id, product_key)
);

-- §2.4 使用者 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT UNIQUE,
  email       TEXT,
  name        TEXT,
  avatar      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,              -- Cookie 裡只放這個
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS user_stores (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id  TEXT NOT NULL,
  position  INTEGER,
  PRIMARY KEY (user_id, store_id)
);

CREATE TABLE IF NOT EXISTS lists (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '我的清單',
  is_recurring  INTEGER NOT NULL DEFAULT 0,
  share_token   TEXT UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS lists_user ON lists(user_id);

CREATE TABLE IF NOT EXISTS list_items (
  id           TEXT PRIMARY KEY,
  list_id      TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  product_key  TEXT,
  free_text    TEXT,
  qty          REAL NOT NULL DEFAULT 1,
  checked      INTEGER NOT NULL DEFAULT 0,
  checked_at   TEXT,
  price        REAL,                         -- 使用者自己填的價
  source       TEXT,                         -- special | recipe:xxx | watchlist | manual
  position     INTEGER
);
CREATE INDEX IF NOT EXISTS list_items_list ON list_items(list_id);

CREATE TABLE IF NOT EXISTS watches (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_key  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, product_key)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keys        TEXT NOT NULL,                 -- JSON {p256dh, auth}
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  TEXT NOT NULL,
  kind        TEXT NOT NULL,                 -- weekly_digest | watchlist_hit
  payload     TEXT,
  sent_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS notifications_user_week ON notifications(user_id, week_start);

CREATE TABLE IF NOT EXISTS ai_recipes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  lang        TEXT,
  payload     TEXT NOT NULL                  -- JSON：整道食譜（食材、步驟、價格、店）
);
CREATE INDEX IF NOT EXISTS ai_recipes_user ON ai_recipes(user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_usage (      -- 每日次數：scope = u:<uid> | ip:<ip> | g:all
  day    TEXT NOT NULL,                      -- YYYY-MM-DD（NZ）
  scope  TEXT NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope)
);

CREATE TABLE IF NOT EXISTS loyalty_cards (  -- 會員卡錢包（現有功能，§2.4 補）
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain       TEXT NOT NULL,                 -- clubplus | woolworths | other
  label       TEXT,
  number      TEXT NOT NULL,
  format      TEXT,                          -- EAN13 / CODE128 …
  position    INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS loyalty_cards_user ON loyalty_cards(user_id);

-- §2.5 營運 -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS admins (
  email     TEXT PRIMARY KEY,                -- 存小寫
  added_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id             TEXT PRIMARY KEY,
  kind           TEXT,                       -- daily | hourly | catalog
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  stores_total   INTEGER,
  stores_ok      INTEGER,
  stores_failed  INTEGER,
  rows           INTEGER,
  requests       INTEGER,
  report         TEXT                        -- JSON 週報（unmappedCategories、suspectStores…）
);
CREATE INDEX IF NOT EXISTS crawl_runs_started ON crawl_runs(started_at);

CREATE TABLE IF NOT EXISTS crawl_stores (
  run_id    TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  store_id  TEXT NOT NULL,
  ok        INTEGER NOT NULL DEFAULT 0,
  rows      INTEGER,
  requests  INTEGER,
  seconds   REAL,
  added     INTEGER,
  changed   INTEGER,
  removed   INTEGER,
  suspect   INTEGER NOT NULL DEFAULT 0,
  error     TEXT,
  slices    TEXT,                            -- JSON：分類拿滿狀況（保命指標）
  badges    TEXT,                            -- JSON：徽章計數
  tree      TEXT,                            -- JSON：分類樹筆數
  PRIMARY KEY (run_id, store_id)
);
CREATE INDEX IF NOT EXISTS crawl_stores_store ON crawl_stores(store_id);

CREATE TABLE IF NOT EXISTS admin_jobs (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                -- refetch_store | prices | notify_test | decide_pair | recat_week | family_apply | restart_worker
  payload      TEXT,                         -- JSON
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at   TEXT,
  finished_at  TEXT,
  result       TEXT
);
CREATE INDEX IF NOT EXISTS admin_jobs_status ON admin_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS price_requests (  -- 即時查價的單；price-worker 用 token 來領
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  store_id    TEXT NOT NULL,
  items       TEXT NOT NULL,                 -- JSON [{product_id, product_key}]
  queries     TEXT,                          -- JSON 字串陣列（自由輸入請 worker 搜）
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  claimed_at  TEXT,
  done_at     TEXT,
  result      TEXT                           -- JSON：問到的價格 / 搜尋候選
);
CREATE INDEX IF NOT EXISTS price_requests_status ON price_requests(status, created_at);
CREATE INDEX IF NOT EXISTS price_requests_store ON price_requests(store_id, created_at);

CREATE TABLE IF NOT EXISTS name_matches (   -- 名字配對結果
  chain_id              TEXT NOT NULL,
  product_key           TEXT NOT NULL,
  status                TEXT NOT NULL,       -- matched | review | none
  candidate_product_id  TEXT,
  score                 REAL,
  candidates            TEXT,                -- JSON
  searched_at           TEXT,
  PRIMARY KEY (chain_id, product_key)
);

CREATE TABLE IF NOT EXISTS recipes (        -- 食譜正本（現有 Supabase recipes 表，§2.5 補）
  id          TEXT PRIMARY KEY,
  week_start  TEXT,
  source      TEXT NOT NULL DEFAULT 'manual', -- manual | ai
  published   INTEGER NOT NULL DEFAULT 0,
  reviewed    INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL,                 -- JSON：整道食譜
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS recipes_week ON recipes(week_start, published);
