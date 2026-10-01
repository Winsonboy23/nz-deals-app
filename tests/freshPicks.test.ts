// 首頁「生鮮特價」：肉 2、海鮮 2、蔬菜 2、水果 2；不夠的互補；同一樣只留最便宜；省最多的排前面（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshKind, freshPicks, type FreshSpecial } from '../src/lib/freshPicks.ts'

const WW = 'woolworths:9433'
const NW = 'newworld:be37802e-1355-466e-9a1b-1ede5a099705'
const PNS = 'paknsave:b39562a4-2b72-43fe-b9ba-eda1d651ad0b'
const CAT = {
  beef: 'meat-poultry-and-seafood/beef/steak',
  chicken: 'meat-poultry-and-seafood/chicken-and-poultry/chicken-breast',
  mince: 'meat-poultry-and-seafood/mince-sausages-and-meatballs/sausages',
  lamb: 'meat-poultry-and-seafood/lamb/lamb-chops',
  fish: 'meat-poultry-and-seafood/seafood/fresh-fish',
  veg: 'fruit-and-vegetables/vegetables/broccoli-and-cauliflower',
  salad: 'fruit-and-vegetables/fresh-salad-and-herbs/salad-bags',
  fruit: 'fruit-and-vegetables/fruit/apples-and-pears',
  deli: 'meat-poultry-and-seafood/deli-meats/ham',
  organic: 'fruit-and-vegetables/organic-fruit-and-vegetables/organic-vegetables',
}
let n = 0
/** 一列特價；預設綠超、按件賣、沒原價 */
function row(id: string, cat: string, o: Partial<FreshSpecial> = {}) {
  n += 1
  return { id, special: { store_id: WW, product_id: `p${n}`, product_key: id, price: 5, price_unit: 'each', was_price: null, unit_price: null, unit_price_unit: null, category_id: cat, ...o } }
}
const ids = (rs: Array<{ id: string }>) => rs.map((r) => r.id)

test('分類：只看第二層；熟食冷肉、有機蔬果不算', () => {
  assert.equal(freshKind(CAT.beef), 'meat')
  assert.equal(freshKind(CAT.mince), 'meat')
  assert.equal(freshKind(CAT.fish), 'seafood')
  assert.equal(freshKind(CAT.salad), 'veg')
  assert.equal(freshKind(CAT.fruit), 'fruit')
  assert.equal(freshKind('fruit-and-vegetables/fruit'), 'fruit')
  assert.equal(freshKind(CAT.deli), null)
  assert.equal(freshKind(CAT.organic), null)
  assert.equal(freshKind('pantry/baking/flour'), null)
  assert.equal(freshKind(null), null)
})

test('每類 2 個，順序肉、海鮮、蔬菜、水果；每類挑折數最大的', () => {
  const rows = [
    row('fruit-a', CAT.fruit, { price: 3, was_price: 4 }), // 25%
    row('fruit-b', CAT.fruit, { price: 2, was_price: 4 }), // 50%
    row('fruit-c', CAT.fruit, { price: 3.6, was_price: 4 }), // 10%
    row('veg-a', CAT.veg, { price: 1, was_price: 2 }),
    row('veg-b', CAT.salad, { price: 3, was_price: 4 }),
    row('fish-a', CAT.fish, { price: 20, was_price: 25 }),
    row('fish-b', CAT.fish, { price: 10, was_price: 25 }),
    row('beef-a', CAT.beef, { price: 9, was_price: 10 }),
    row('chicken-a', CAT.chicken, { price: 6, was_price: 12 }),
    row('mince-a', CAT.mince, { price: 7, was_price: 10 }),
    row('ham', CAT.deli, { price: 1, was_price: 10 }), // 熟食不算，折數再大也不放
  ]
  assert.deepEqual(ids(freshPicks(rows)), ['chicken-a', 'mince-a', 'fish-b', 'fish-a', 'veg-a', 'veg-b', 'fruit-b', 'fruit-a'])
})

test('海鮮只有 1 個：多放 1 個肉，排在海鮮後面；蔬菜沒有：水果補滿 4 個', () => {
  const rows = [
    row('m1', CAT.beef, { price: 5, was_price: 10 }),
    row('m2', CAT.beef, { price: 6, was_price: 10 }),
    row('m3', CAT.chicken, { price: 7, was_price: 10 }),
    row('m4', CAT.chicken, { price: 8, was_price: 10 }),
    row('s1', CAT.fish, { price: 9, was_price: 10 }),
    row('f1', CAT.fruit, { price: 1, was_price: 2 }),
    row('f2', CAT.fruit, { price: 3, was_price: 4 }),
    row('f3', CAT.fruit, { price: 4, was_price: 5 }),
    row('f4', CAT.fruit, { price: 9, was_price: 10 }),
    row('f5', CAT.fruit, { price: 9.5, was_price: 10 }),
  ]
  assert.deepEqual(ids(freshPicks(rows)), ['m1', 'm2', 's1', 'm3', 'f1', 'f2', 'f3', 'f4'])
})

test('肉只有 1 個：多放的海鮮也排在這一段最後面', () => {
  const rows = [
    row('s1', CAT.fish, { price: 5, was_price: 10 }),
    row('s2', CAT.fish, { price: 6, was_price: 10 }),
    row('s3', CAT.fish, { price: 7, was_price: 10 }),
    row('m1', CAT.lamb, { price: 9, was_price: 10 }),
  ]
  assert.deepEqual(ids(freshPicks(rows)), ['m1', 's1', 's2', 's3'])
})

test('兩類加起來不到 4 個就有幾個放幾個；什麼都沒有回空的', () => {
  const rows = [row('m1', CAT.beef), row('v1', CAT.veg), row('ham', CAT.deli)]
  assert.deepEqual(ids(freshPicks(rows)), ['m1', 'v1'])
  assert.deepEqual(freshPicks([]), [])
})

test('同一樣商品（product_key）只留你的店裡最便宜那筆', () => {
  const rows = [
    row('broccoli@ww', CAT.veg, { product_key: 'broccoli', price: 2.5, was_price: 3.5 }),
    row('broccoli@pns', CAT.veg, { product_key: 'broccoli', store_id: PNS, price: 1.99 }),
    row('broccoli@nw', CAT.veg, { product_key: 'broccoli', store_id: NW, price: 2.2, was_price: 3 }),
    row('carrots', CAT.veg, { price: 1.5, was_price: 2 }),
  ]
  // 黃超最便宜 → 留它；它沒原價，所以排在有折扣的紅蘿蔔後面
  assert.deepEqual(ids(freshPicks(rows)), ['carrots', 'broccoli@pns'])
})

test('沒原價的（黃超）排在有折扣的後面，彼此按每公斤單價小到大；黃超就算有 was_price 也不算折扣', () => {
  const rows = [
    row('pns-dear', CAT.chicken, { store_id: PNS, price: 12.99, price_unit: 'kg', unit_price: 12.99, unit_price_unit: 'kg' }),
    row('pns-cheap', CAT.chicken, { store_id: PNS, price: 7.99, price_unit: 'kg', unit_price: 7.99, unit_price_unit: 'kg' }),
    row('pns-was', CAT.beef, { store_id: PNS, price: 9.99, was_price: 30, unit_price: 9.99, unit_price_unit: 'kg' }),
    row('ww-small-saving', CAT.beef, { price: 19, was_price: 20, unit_price: 38, unit_price_unit: 'kg' }),
    row('no-kg', CAT.beef, { store_id: PNS, price: 4 }),
  ]
  assert.deepEqual(ids(freshPicks(rows)), ['ww-small-saving', 'pns-cheap', 'pns-was', 'pns-dear'])
})

test('沒有 product_key 的不會被當成同一樣', () => {
  const rows = [
    row('a', CAT.fruit, { product_key: null, price: 2 }),
    row('b', CAT.fruit, { product_key: null, price: 3 }),
  ]
  assert.deepEqual(ids(freshPicks(rows)), ['a', 'b'])
})
