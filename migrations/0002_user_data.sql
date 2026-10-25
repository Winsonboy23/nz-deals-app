-- 全國版階段 4（docs/stage4-contract.md §1，2026-10-26）：登入、使用者資料、即時查價搬 Worker 要補的欄位與表。只加不改。
-- D1 的 alter table add column 沒有 if not exists；0001 建的 users 只有 id/google_sub/email/name/avatar/created_at、sessions 只有 id/user_id/expires_at。

-- users 併進 Supabase profiles 的欄位
alter table users add column lang text default 'zh';
alter table users add column island text;
alter table users add column notify_push integer not null default 0;
alter table users add column last_sign_in_at text;

alter table sessions add column created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- 即時查價「現在多少錢」：跟 Supabase store_prices 一模一樣（D1 的 store_prices 是每週生鮮／例外價，不是這個）
create table if not exists live_prices (
  store_id text not null,
  product_id text not null,
  product_key text,
  available integer not null default 1,
  price real,
  price_unit text,
  was_price real,
  is_special integer default 0,
  club_only integer default 0,
  multi_buy text,                          -- JSON
  unit_price real,
  unit_price_unit text,
  name text,
  fetched_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source text not null default 'live' check (source in ('batch', 'live', 'user')),
  primary key (store_id, product_id)
);
create index if not exists live_prices_key on live_prices (product_key);

-- 自由輸入請 Mac mini 去超市網站搜的結果：一張單 × 一個字一列（搜不到也寫一列空陣列）
create table if not exists search_results (
  request_id text not null references price_requests(id) on delete cascade,
  store_id text not null,
  term text not null,
  candidates text not null default '[]',   -- JSON array
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (request_id, term)
);

create index if not exists price_requests_user on price_requests (user_id, created_at);
