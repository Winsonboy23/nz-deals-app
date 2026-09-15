# 後端（爬蟲 / 資料）待改紀錄

整理日期：2026-09-15
來源：桌面筆記《今天的整理：問題與解法》（2026-09-13）＋ 當天直接查 Supabase 本週（2026-09-14 那週）資料的結果。
爬蟲與 price-worker 在 Mac mini 上，不在這個 repo；這份是給爬蟲那邊的規格。前端六項已於 2026-09-15 做完（commit f54e7e2）。

---

## 0. 查證到的現況（改之前的基準線）

| 項目 | 數字 |
|---|---|
| 每店本週筆數 | 綠超 2,507–2,862；紅超 1,562–2,143；黃超 1,222–1,305 |
| 綠超 promo_type（4 店合計） | Special 5,523、PercentageOff_* 3,938、Multibuy_Special 577、LowPrice 341、Multibuy_FreshDeal 88、Multibuy_LowPrice 37、**FreshDeal（單價型）0、MemberPrice 0** |
| 綠超 club_only=true | **0 筆**（筆記說會員價有 1,008 項） |
| Hastings 綠超 fruit-and-vegetables | **21 筆**（筆記說 Fresh Deal 就有 51 項） |
| Hastings 綠超 pantry | 1,218 筆（網站分類寫 1,378） |
| 紅超 club_only=true | 7,617 筆，一般價存在 was_price |
| 黃超 | 全部 Special / Multibuy，沒有 was_price |
| 同店同 product_id 重複 | 0（已用編號去重） |
| products.display_name 品牌重複（抽樣 1,000） | 198 筆，例如 "Aero Aero Chocolate Block…"、"Woolworths Woolworths Potato Brushed 5kg" |
| 黃超湊件商品的 price 欄位 | 是單件價（上週花椰菜 price 1.79、multi_buy 2 件 $3）— 筆記說沒存，實際有存 |

結論：筆記的問題一、四、六成立；問題二部分成立；問題三、五、七的病因跟筆記寫的不同（三是前端顯示混用，已修；五已經在做；七是前端沒拼品牌，已修）。

---

## 1. 先全抓，徽章存成獨立欄位（筆記問題一）

**問題**：綠超單價型 Fresh Deal（只有一個價、綠色圓標）一筆都沒進來；抓的時候用「有沒有原價／有沒有多件」判斷是不是特價，判斷放太前面。

**規格**
- 抓到的商品一律寫入，不在抓取階段過濾。
- `specials` 新增 `badges text[]`（例：`{Special}`、`{FreshDeal}`、`{LowPrice}`、`{MemberPrice}`、`{Multibuy,Special}`、`{HalfPrice}`、`{PercentageOff_33}`），原始徽章字串照抄，不做正規化以外的判斷。
- `is_special` 由徽章決定（有任一徽章即為特價），不再由 was_price / multi_buy 推導。
- 現有 `promo_type` 可保留過渡，但前端不再依賴它。

**驗收**
- Hastings 綠超 fruit-and-vegetables 筆數 ≥ 50。
- 綠超 `badges @> '{FreshDeal}'` 且 `multi_buy is null` 的筆數 > 0。
- 韭蔥（leek）、Crown Pumpkin、胡蘿蔔在 Hastings 綠超查得到。

---

## 2. 價格欄位拆清楚，綠超會員價要抓進來（筆記問題三、四）

**問題**：綠超 Member Price 目前 0 筆；紅超會員價用 was_price 存一般價，欄位語意被借用；筆記觀察的 Mainland Edam 700g 綠超「會員 $9.99 / 非會員 $13.89」在資料庫是 $11.50 Special（was 13.90），對不起來，要查爬蟲怎麼讀綠超的價格欄。

**規格**
- 新增 `regular_price numeric`：單件一般價，**永遠要有值**（有特價時是原價；只有會員價時是非會員價；沒折扣時等於 price）。
- 新增 `member_price numeric null`：要刷會員卡才有的價。
- `price`：維持「任何人買一件付多少」（黃超、綠超 Special、Fresh Deal 等）；只有會員價時 price = 非會員價，member_price = 會員價。
- `was_price` 只留給真的「劃掉原價」；紅超 Clubcard 的一般價改存 regular_price。
- `multi_buy` 維持 `{qty,total}`，price 一律是單件價（現在已是）。
- 過渡期：前端目前讀 `club_only` + `was_price`（club_only 時當一般價）。後端欄位到位後前端再切換；切換前請**同時**維持舊欄位語意，不要先拿掉。

**驗收**
- 綠超 `member_price is not null` 筆數 > 0（筆記估計約 1,000）。
- Mainland Edam 700g（Havelock North 紅超 / 綠超）欄位：member_price、regular_price、price 三個數字各自對得上網站。
- 任何一筆 `regular_price is null` 視為失敗。

---

## 3. 走分類抓、拆子分類、麵包屑當分類（筆記問題二、五）

**問題**：綠超清單頁最多顯示 1,008 筆（28 頁 × 36），分類數量超過就被截，而且不報錯。現況每店已超過 1,008，代表已經不是單一清單抓，但 pantry 1,218 vs 網站 1,378 仍有缺口。

**規格**
- 照網站分類樹逐分類抓；單一分類（或子分類）抓到 **≥ 900** 筆就再往下拆一層。門檻用 900 不用 1,008，留緩衝。
- 商品分類以商品頁麵包屑為準（`Home / Fruit & Veg / Vegetables / …`），不用「從哪條路走進去」的路徑。
- 同一次抓取內用 `product_id` 去重（目前已做到，維持），不要用名字去重。
- 分類樹每次抓取重新讀，不寫死；記錄「這次看到幾個分類」，數量變動寫進 `crawl_runs.report`（現有 `unmappedCategories` 旁邊）。

**驗收**
- 每個（店 × 分類）抓到的筆數 = 網站分類標示的數字（例「冷凍肉類 (31)」）。
- Hastings 綠超 pantry ≥ 1,378。

---

## 4. 修 products.display_name 的品牌重複（筆記問題七的後端面）

**問題**：拼 display_name 時 brand + name 沒判斷 name 已含品牌，綠超商品約兩成變成「Aero Aero …」；這個字串流進 `name_matches.term`（例 "hellers hellers streaky bacon"），影響名字配對。

**規格**
- 拼法對齊前端 `displayName()`（src/lib/format.ts）：name 已以 brand 開頭就不加 brand；name 已含 size 就不加 size。
- 回填現有 products 表，並重跑受影響的 name_matches。

**驗收**
- `select count(*) from products where display_name ~* '^(\S+( \S+)?) \1\b'` 為 0。

---

## 5. 保命機制下放到分類與徽章（筆記「三個保命機制」）

**現況**：`crawl_stores` 已有每店 ok / items / rows / added / changed / removed，只到店這一層；日誌顯示總數層級的失敗擋得住。

**規格**
- 每（店 × 分類）記錄「網站標示數」與「實抓數」，對不上 → 這家店這次不覆蓋，保留舊資料，標記 failed。
- 每（店 × 徽章）記錄筆數；某徽章前一次 > 0、這次 = 0 → 先當抓取失敗，連續 2–3 次為 0 才接受為「真的沒有」。
- 分類清單數量變動、對不到的分類路徑 → 寫進 report 並通知（現有 unmappedCategories 機制擴充）。

**驗收**
- 故意讓某分類回傳空陣列，該店該次應標 failed 且舊資料仍在。

---

## 6. 抓取時間與全商品目錄

**現況**：每天 08:00、20:00（另從 last_fetched_at 看到 15:00 左右也有一次）。紅超、黃超約在 02:00、08:00、10:00、13:00、17:00 換檔，最長延遲 10 小時。兩天半只有 3 樣真的改價，超市主要是換「哪些在特價」。

**規格**
- 加 13:30 一次，延遲縮到 3 小時內。前端快取已改成跟著 `stores.last_fetched_at` 作廢，抓完使用者下次開 app 就會看到。
- 全商品目錄每週抓一次：**另開一張表**（例 `store_items` 或 `catalog`），不要塞進 specials（specials 是一店一週一列的特價快照）。平日只更新特價狀態。

---

## 7. 前端這邊已經配合好的（給後端對接參考）

- 排序與顯示一律用單件價 `price`；多件優惠、會員價只當條件標記顯示（PriceLine.vue）。
- 前端目前的欄位期待：`price`＝單件價、`multi_buy {qty,total}`、`club_only`、`was_price`（club_only 時當一般價）。第 2 點欄位上線後，前端要改讀 `regular_price` / `member_price`，屆時再一起改。
- 所有「本週無特價」文案已改成「沒有資料」，後端抓漏不會再被講成「確定沒有」。

---

## 8. 筆記裡還沒查的

1. 紅超、黃超是不是也有 1,008 上限（現況每店 1,200–2,100 筆，看起來沒有單一清單截斷，但沒驗證）。
2. 綠超「Boosts」徽章是什麼（本週資料 0 筆）。
3. 綠超 Fresh Deals 專區頁有時是空的，原因未查；改走分類抓之後可不管。

---

## 9. 改完拿這些來測

| 商品 | 店 | 應該看到 |
|---|---|---|
| Woolworths Fresh Broccoli Head | Hastings 綠超 | price 2.00、multi_buy 2 件 $3.00、badges 含 FreshDeal |
| Leeks | Hastings 綠超 | 查得到，badges 含 FreshDeal |
| Crown Pumpkin | Hastings 綠超 | 查得到，price 3.99 |
| Broccoli | Hastings 黃超 | price 單買價、multi_buy 若有則 qty/total |
| Avocado | Hastings 黃超 | 搜「Avocado」不能回「沒有資料」 |
| Mainland Edam 700g | Havelock North 紅超 | member_price、regular_price 各自正確，club_only 為真 |
| 任一綠超 Member Price 商品 | 任一綠超 | member_price 非空 |
