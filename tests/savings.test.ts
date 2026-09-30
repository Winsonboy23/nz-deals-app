// 首頁「你本週已省下」：這週打勾、有原價的才算（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { savedThisWeek } from '../src/lib/savings.ts'

const MON = '2026-09-28'   // 這週一（紐西蘭）
const WED = '2026-09-30T01:00:00.000Z'   // 紐西蘭週三下午兩點
const WW = 'woolworths:9433'
const NW = 'newworld:be37802e-1355-466e-9a1b-1ede5a099705'
const PNS = 'paknsave:b39562a4-2b72-43fe-b9ba-eda1d651ad0b'
// key → 你的店最便宜的那筆（Group.best）
const best: Record<string, { special: { store_id: string; price: number; was_price: number | null } }> = {
  butter: { special: { store_id: WW, price: 5.5, was_price: 7.2 } },   // 省 1.70
  cheese: { special: { store_id: NW, price: 9.99, was_price: 12.49 } },   // 省 2.50
  milk: { special: { store_id: NW, price: 4.2, was_price: null } },   // 沒原價
  eggs: { special: { store_id: PNS, price: 8, was_price: 9.5 } },   // 黃超：畫面上從不顯示它的原價，這裡也不算
  bread: { special: { store_id: WW, price: 3, was_price: 3 } },   // 原價沒比較貴
}
const bestOf = (k: string) => best[k]
const item = (key: string | null, o: { qty?: number; checked?: boolean; checkedAt?: string | null } = {}) => ({ key, qty: 1, checked: true, checkedAt: WED, ...o })

test('有原價的算 (原價 − 特價)；沒原價、黃超、這週沒特價、自由輸入不算，記在 uncounted', () => {
  const r = savedThisWeek([item('butter'), item('cheese'), item('milk'), item('eggs'), item('bread'), item('gone'), item(null)], bestOf, MON)
  assert.deepEqual(r, { amount: 4.2, counted: 2, uncounted: 5 })
})

test('數量 2 算兩倍', () => {
  assert.deepEqual(savedThisWeek([item('butter', { qty: 2 })], bestOf, MON), { amount: 3.4, counted: 1, uncounted: 0 })
})

test('上週打勾的不算：看紐西蘭的日期，不是 UTC', () => {
  // 9/27 起是夏令時間（UTC+13）：UTC 9/27 11:30 = 紐西蘭週一 00:30 → 算；UTC 9/27 10:30 = 紐西蘭週日 23:30 → 上週
  assert.equal(savedThisWeek([item('butter', { checkedAt: '2026-09-27T11:30:00.000Z' })], bestOf, MON).counted, 1)
  assert.deepEqual(savedThisWeek([item('butter', { checkedAt: '2026-09-27T10:30:00.000Z' })], bestOf, MON), { amount: 0, counted: 0, uncounted: 0 })
  // 登入後從資料庫讀回來的格式（+00:00）
  assert.equal(savedThisWeek([item('cheese', { checkedAt: '2026-09-29T02:03:04.5+00:00' })], bestOf, MON).amount, 2.5)
})

test('取消打勾的不算；舊資料打了勾但沒有打勾時間的也不算', () => {
  const r = savedThisWeek([item('butter', { checked: false, checkedAt: null }), item('cheese', { checkedAt: undefined })], bestOf, MON)
  assert.deepEqual(r, { amount: 0, counted: 0, uncounted: 0 })
})
