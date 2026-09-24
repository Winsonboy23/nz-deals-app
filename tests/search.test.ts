// pnpm test（node 內建 test runner，直接跑 TS）。例子都是 2026-09-22 合作夥伴在 Flaxmere Woolworths 貨架抄回來、舊搜尋找不到的。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_SCORE, matchScore, parseQuery, tokenize } from '../src/lib/search.ts'

const item = (name: string, brand: string | null = null, size: string | null = null) => ({ name, brand, size })
const score = (q: string, name: string, brand: string | null = null, size: string | null = null) =>
  matchScore(parseQuery(q)!, item(name, brand, size))

test('tokenize：& → and、符號當空白、撇號拿掉、ww → woolworths、330 g 併起來', () => {
  assert.deepEqual(tokenize("UP&GO Energize Choc-Hit, Arnott's"), ['up', 'and', 'go', 'energize', 'choc', 'hit', 'arnotts'])
  assert.deepEqual(tokenize('WW Tasty 1.5L 330 g'), ['woolworths', 'tasty', '1.5l', '330g'])
})

test('parseQuery：丟掉 and / n / with / the / of，規格另外放', () => {
  assert.deepEqual(parseQuery('Eta Thick n Creamy Aioli'), { words: ['eta', 'thick', 'creamy', 'aioli'], sizes: [] })
  assert.deepEqual(parseQuery('Arataki Manuka Honey UMF5+ 1kg'), { words: ['arataki', 'manuka', 'honey', 'umf5'], sizes: ['1000g'] })
  assert.equal(parseQuery('a'), null)
})

test('字序不同、差一個字也找得到', () => {
  assert.equal(score('Sealord Heat and Eat Fish Pie', 'Sealord Heat & Eat Tuna Fish Pie 200g', 'Sealord'), 1)
  assert.equal(score('WW Grated Tasty Cheese', 'Woolworths Tasty Cheese Grated 300g', 'Woolworths'), 1)
  assert.equal(score('Eta Thick n Creamy Aioli', 'Eta Garlic Aioli Thick & Creamy 295mL', 'Eta'), 1)
  assert.equal(score('Milo Duo Vanilla Cereal', 'Milo Cereal Duo 340g', 'Milo'), 0.75)
})

test('字首兩個方向都算，短的至少 3 個字', () => {
  assert.equal(score('Snacka Balls', 'Tom & Luke Snack Balls Peanut Butter 396g'), 1)
  assert.equal(score('snack balls', 'Snacka Balls'), 1)
  assert.equal(score('choc hit', 'Up&Go Choc Hit 250mL'), 1)
  assert.equal(score('choc biscuit', 'Chocolate Biscuits'), 1)
  // go（2 個字）不能當字首去對 golden
  assert.equal(score('go crunch', 'Golden Crunch'), 0.5)
})

test('規格對到加分、對不到不扣分', () => {
  const a = score('Arataki Manuka Honey 330g', 'Arataki Honey Monofloral Manuka Umf5+ 330g', 'Arataki')
  const b = score('Arataki Manuka Honey 330g', 'Arataki Honey Monofloral Manuka Umf5+ 500g', 'Arataki')
  assert.ok(a > b)
  assert.equal(b, 1)
  assert.equal(score('honey 1kg', 'Manuka Honey', null, '1000g') > 1, true)
})

test('對不到一半就不列', () => {
  assert.ok(score('Sealord Tuna Lemon Pepper', 'Sealord Hoki Fillets') < MIN_SCORE)
  assert.ok(score('Sealord Tuna Lemon Pepper', 'Sealord Tuna Olive Oil') >= MIN_SCORE)
})

test('只打一個字：照以前，字首 1、字串裡剛好有 0.5', () => {
  assert.equal(score('milk', 'Anchor Blue Milk 2L'), 1)
  assert.equal(score('milk', 'Buttermilk Pancake Mix'), 0.5)
  assert.equal(score('ww', 'Woolworths Tasty Cheese'), 1)
  assert.equal(score("arnott's", 'Arnotts Tim Tam'), 1)
  assert.equal(score('cheese', 'Sealord Tuna'), 0)
})
