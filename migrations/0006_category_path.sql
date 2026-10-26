-- 全國版階段 6 第 3 塊（2026-10-26）：chain_items 加超市自己的分類路徑（docs/national-plan.md §2.2）。
-- 回填分類（後台「回填本週」、對照表改了之後）要用原始路徑重算 Foodstuffs 分類；快照裡沒有這個，所以存在每連鎖每樣一列的 chain_items。
alter table chain_items add column category_path text;   -- 'Fruit & Veg > Vegetables > Onions'（以 ' > ' 接）
