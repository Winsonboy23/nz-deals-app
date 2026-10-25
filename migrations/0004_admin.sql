-- 全國版階段 5（docs/stage5-contract.md §1，2026-10-26）：後台搬 /admin 要的字典表與欄位。只加不改。

-- 跨店配對字典（= Supabase product_dict）：待審 = source 'ai' 且 matched_to 非空且 confidence < 0.8
create table if not exists product_dict (
  dict_key     text primary key,            -- '<chain group>|<product_id>'，例如 foodstuffs|5001001-EA-000
  product_key  text not null,
  matched_to   text,                        -- 配到的 Woolworths SKU
  confidence   real,
  source       text,                        -- rule | ai | manual
  updated_at   text
);
create index if not exists product_dict_review on product_dict (source, confidence);
create index if not exists product_dict_key on product_dict (product_key);

-- 同類字典（= Supabase family_dict，一樣一列）；products.family_key / families 是套用結果
create table if not exists family_dict (
  product_key  text primary key,
  family_key   text not null,
  name_en      text,
  name_zh      text,
  confidence   real,
  source       text,                        -- gpt | rule | manual
  cat2         text,                        -- 問 GPT 時用的 Foodstuffs 第二層分類
  updated_at   text
);
create index if not exists family_dict_family on family_dict (family_key);
create index if not exists family_dict_conf on family_dict (confidence);

-- Woolworths 分類路徑 → Foodstuffs 分類路徑（= Supabase taxonomy_map）
create table if not exists taxonomy_map (
  level       integer not null,            -- 1 / 2 / 3
  ww_path     text not null,               -- 'Fruit & Veg > Vegetables'
  fs_path     text,                        -- null = 對不到
  ww_key      text,
  status      text,                        -- auto | manual | unmapped
  score       real,
  note        text,
  updated_at  text,
  primary key (level, ww_path)
);

-- Mac mini 健康（ops/health.sh 每 10 分鐘一列）
create table if not exists health (
  at           text primary key,
  load         real,
  top          text,                       -- JSON [{cpu, name}]
  chrome       integer,
  orphan       integer,
  mem_free_mb  integer
);

-- 名字配對：後台要顯示搜了什麼字、人工判的標記
alter table name_matches add column term text;
alter table name_matches add column decided_by text;
