// 自由輸入配對：候選去重與排序、送去網站搜的字、規則 key 要跟後端一模一樣（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catTightness, isCjk, mergeCands, rankCands, remoteTerm, tightness, type CandRow } from '../src/lib/freeText.ts'
import { ruleKey } from '../src/lib/ruleKey.ts'

const WW = 'woolworths:9433'
const NW = 'newworld:be37802e-1355-466e-9a1b-1ede5a099705'
const PNS = 'paknsave:b39562a4-2b72-43fe-b9ba-eda1d651ad0b'
const row = (o: Partial<CandRow> & Pick<CandRow, 'store_id' | 'product_id'>): CandRow => ({
  key: null, name: 'x', brand: null, size: null, price: 1, price_unit: 'each', category_id: null, image_url: null, score: 1, from: 'catalog', ...o,
})

test('同 key 併、New World 和 PAK’nSAVE 同編號併、Woolworths 同編號不跟 Foodstuffs 併', () => {
  const cands = mergeCands([
    row({ store_id: NW, product_id: '5001-EA-000', key: 'anchor_milk_2l', price: 5.2, from: 'special' }),
    row({ store_id: PNS, product_id: '5001-EA-000', price: 4.9 }),   // 沒 key，但同編號 → 併進上面
    row({ store_id: WW, product_id: '282819', key: 'anchor_milk_2l', price: 5.79 }),   // 同 key → 也併
    row({ store_id: WW, product_id: '5001-EA-000', price: 3 }),   // 綠超剛好同編號：不同連鎖群，不併
  ])
  assert.equal(cands.length, 2)
  const milk = cands.find((c) => c.key === 'anchor_milk_2l')!
  assert.deepEqual(milk.stores.sort(), [NW, PNS, WW].sort())
  assert.equal(milk.minPrice, 4.9)
  assert.equal(milk.fromSpecial, true)
  assert.equal(milk.rep.from, 'special')   // 採用時用特價那列（key 一定在 products）
})

test('沒特價列時 rep 是有價的最便宜那列', () => {
  const [c] = mergeCands([
    row({ store_id: NW, product_id: 'a', price: null }),
    row({ store_id: PNS, product_id: 'a', price: 2.5 }),
  ])
  assert.equal(c.rep.store_id, PNS)
  assert.equal(c.fromSpecial, false)
})

test('排序：分數＋幾家有 → 價格；gate 擋掉分數差太多的', () => {
  const cands = mergeCands([
    row({ store_id: NW, product_id: 'choc', score: 1 }), row({ store_id: PNS, product_id: 'choc', score: 1 }), row({ store_id: WW, product_id: 'c2', key: 'k', score: 1 }),
    row({ store_id: NW, product_id: 'milk1', score: 1.5, price: 3 }), row({ store_id: PNS, product_id: 'milk1', score: 1.5, price: 3 }),
    row({ store_id: NW, product_id: 'milk2', score: 1.5, price: 2 }), row({ store_id: PNS, product_id: 'milk2', score: 1.5, price: 2 }),
    row({ store_id: WW, product_id: 'milk3', score: 1.5, price: 1 }),
  ])
  const ranked = rankCands(cands, { gate: true })
  assert.deepEqual(ranked.map((c) => c.rep.product_id), ['milk2', 'milk1', 'milk3'])   // 巧克力（1 < 1.5 × 0.75）被擋掉；兩家有的先、同家數比價格
  assert.equal(rankCands(cands).length, 5)
})

test('像很多的一家有，排在只像一點的兩家有前面（Avocado ea vs 酪梨油）', () => {
  const ranked = rankCands(mergeCands([
    row({ store_id: NW, product_id: 'oil', score: 1.25 }), row({ store_id: PNS, product_id: 'oil', score: 1.25 }),
    row({ store_id: WW, product_id: 'avo', score: 2.5 }),
  ]), { gate: true })
  assert.deepEqual(ranked.map((c) => c.rep.product_id), ['avo'])   // 1.25 < 2.5 × 0.75，酪梨油直接擋掉
  const close = rankCands(mergeCands([
    row({ store_id: NW, product_id: 'a', score: 2 }), row({ store_id: PNS, product_id: 'a', score: 2 }),
    row({ store_id: WW, product_id: 'b', score: 2.1 }),
  ]), { gate: true })
  assert.deepEqual(close.map((c) => c.rep.product_id), ['a', 'b'])   // 差不多像：兩家有的先
})

test('中文：先比哪一類對得準再比幾家有，同一類最多兩個', () => {
  const ranked = rankCands(mergeCands([
    ...['b1', 'b2', 'b3'].flatMap((id) => [row({ store_id: NW, product_id: id, score: 1, group: 'bacon_streaky' }), row({ store_id: PNS, product_id: id, score: 1, group: 'bacon_streaky' })]),
    row({ store_id: WW, product_id: 'belly', score: 1.07, group: 'pork_belly' }),
    row({ store_id: PNS, product_id: 'bites', score: 1.25, group: 'pork_belly_bites' }),
  ]), { gate: true, sort: 'score', perGroup: 2 })
  assert.deepEqual(ranked.map((c) => c.rep.product_id), ['bites', 'belly', 'b1', 'b2'])
})

test('tightness：品名裡打的字佔幾成', () => {
  assert.equal(tightness(['milk'], ['milk', 'standard']), 0.5)
  assert.equal(tightness(['milk'], ['long', 'life', 'milk', 'chocolate']), 0.25)
  assert.equal(tightness(['avocado'], ['avocado']), 1)
  assert.equal(tightness(['avocados'], ['avocado', 'oil']), 0.5)   // 單複數一樣
  assert.equal(tightness(['milk'], ['lime', 'milkshake', 'milk']), 1 / 3)   // milkshake 不算
  assert.equal(tightness(['milk'], []), 0)
  assert.equal(catTightness(['milk'], 'fridge-deli-and-eggs/milk/fresh-milk'), 1)
  assert.equal(catTightness(['milk'], 'pantry/canned-foods-and-packets/coconut-cream-and-milk'), 1 / 3)
  assert.equal(catTightness(['avocado'], 'fruit-and-vegetables/fruit/avocados'), 1)
  assert.equal(catTightness(['milk'], null), 0)
})

test('網站搜到的：幾家有 → 網站的順序 → 價格；一個連鎖群最多 4 個', () => {
  const fs = (id: string, order: number, price: number) => [row({ store_id: NW, product_id: id, from: 'search', order, price, group: 'foodstuffs' }), row({ store_id: PNS, product_id: id, from: 'search', order, price, group: 'foodstuffs' })]
  const ranked = rankCands(mergeCands([
    ...fs('tissue1', 0, 8.89), ...fs('tissue2', 1, 9.69), ...fs('tissue3', 2, 7.29), ...fs('tissue4', 3, 2.89), ...fs('towel', 8, 2.29),
    row({ store_id: WW, product_id: 'ww2', from: 'search', order: 1, price: 2.89, group: 'woolworths' }),
    row({ store_id: WW, product_id: 'ww1', from: 'search', order: 0, price: 8.35, group: 'woolworths' }),
  ]), { sort: 'site', perGroup: 4 })
  assert.deepEqual(ranked.slice(0, 6).map((c) => c.rep.product_id), ['tissue1', 'tissue2', 'tissue3', 'tissue4', 'ww1', 'ww2'])   // 擦手紙（網站第 9 個）被擠掉
})

test('送去網站搜的字：去自家牌、留形容詞；中文判斷', () => {
  assert.equal(remoteTerm('  Woolworths   Free Range Eggs '), 'Free Range Eggs')
  assert.equal(remoteTerm('Pams Finest butter'), 'butter')
  assert.equal(remoteTerm('Pams'), 'Pams')   // 只打自家牌：照原樣
  assert.equal(remoteTerm('x'.repeat(80)).length, 60)
  assert.equal(isCjk('豬五花'), true)
  assert.equal(isCjk('pork belly'), false)
})

test('規則 key 跟後端 product-key.ts 一樣（2026-09-24 對過 2,006 列 catalog 0 差異）', () => {
  assert.equal(ruleKey({ name: 'Woolworths NZ Free Farmed Pork Shoulder Roast Boneless 1.6kg' }), 'boneless_farmed_free_pork_roast_shoulder_1.6kg')
  assert.equal(ruleKey({ name: 'The Odd Bunch Fresh Avocado (Minimum 5 Per Pack) 1kg', brand: 'The Odd Bunch' }), 'avocado_minimum_1kg')
  assert.equal(ruleKey({ name: 'Pams Finest Salted Butter', brand: 'Pams Finest', size: '500g' }), 'butter_finest_salted_500g')
  assert.equal(ruleKey({ name: 'Coke 12x250ml', brand: 'Coca-Cola' }), 'coca_coke_cola_12x250ml')
  assert.equal(ruleKey({ name: 'Chicken Nibbles', size: 'kg', priceUnit: 'kg' }), 'chicken_nibble_kg')
  assert.equal(ruleKey({ name: 'Sorbent Toilet Tissue 12 Pack', brand: 'Sorbent', size: '12pk' }), 'sorbent_tissue_toilet_12pk')
})
