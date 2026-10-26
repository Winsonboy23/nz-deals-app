-- 全國版階段 6（2026-10-26）：貨架價存在 chain_items（每連鎖每樣一列，docs/national-plan.md §2.2 加欄）＋ price_changes 搬 D1。只加不改。
-- 為什麼放 chain_items：包裝貨三家連鎖同價（全國版的前提），所以「這家有賣、貨架多少錢」每連鎖存一份就夠，不用每店 9,000 列。
-- 一站的替代品算價、自由輸入搜貨架、採用商品時的分類，d1 模式以前是空的，現在讀這幾欄。

alter table chain_items add column shelf_price real;             -- 貨架價（不是特價）；null = 還沒翻過貨架
alter table chain_items add column shelf_price_unit text;        -- each / kg …
alter table chain_items add column shelf_unit_price real;        -- 每 kg / 每 L
alter table chain_items add column shelf_unit_price_unit text;
alter table chain_items add column shelf_size text;              -- 超市列的規格（products.size 可能是 null）
alter table chain_items add column shelf_at text;                -- 翻貨架的時間
create index if not exists chain_items_shelf on chain_items (chain_id, shelf_at);

-- 變動記錄（= Supabase price_changes；爬蟲每次比對出的 新上架／改價／下架 一筆一列，報告信「過去 24 小時逐小時變動」用）。留 30 天，/ingest/prune 順手刪。
create table if not exists price_changes (
  id           integer primary key autoincrement,
  at           text not null,
  store_id     text not null,
  chain        text not null,
  product_id   text not null,
  product_key  text,
  name         text,
  kind         text not null,                -- added | changed | removed
  old_price    real,
  new_price    real,
  old_text     text,
  new_text     text,
  old_promo    text,
  new_promo    text
);
create index if not exists price_changes_at ON price_changes (at);
create index if not exists price_changes_store ON price_changes (store_id, at);
