// 會員卡疊卡的純函式（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTap, nextIndex, prevIndex, stackOrder } from '../src/lib/cardStack.ts'

test('nextIndex：拖超過 60px 放開 → 換下一張，往左往右都一樣', () => {
  assert.equal(nextIndex(0, 3, -61), 1)
  assert.equal(nextIndex(0, 3, 61), 1)
  assert.equal(nextIndex(1, 3, -200), 2)
})

test('nextIndex：最後一張再換 → 繞回第一張', () => {
  assert.equal(nextIndex(2, 3, -80), 0)
  assert.equal(nextIndex(1, 2, 80), 0)
})

test('nextIndex：拖太短（剛好 60 也算短）→ 彈回原位、同一張', () => {
  for (const dx of [0, 7, -7, 30, -59, 60, -60]) assert.equal(nextIndex(1, 3, dx), 1, String(dx))
})

test('nextIndex：只有 0、1 張不換；門檻可以改', () => {
  assert.equal(nextIndex(0, 1, -300), 0)
  assert.equal(nextIndex(0, 0, -300), 0)
  assert.equal(nextIndex(0, 3, -50, 40), 1)
  assert.equal(nextIndex(0, 3, -50, 80), 0)
})

test('nextIndex：current 超出範圍（刪了卡）先轉回範圍內', () => {
  assert.equal(nextIndex(3, 3, 0), 0)
  assert.equal(nextIndex(3, 3, -80), 1)
})

test('prevIndex：最後面那張回到前面，第一張的上一張是最後一張', () => {
  assert.equal(prevIndex(1, 3), 0)
  assert.equal(prevIndex(0, 3), 2)
  assert.equal(prevIndex(0, 1), 0)
  assert.equal(prevIndex(0, 0), 0)
})

test('stackOrder：由前到後，current 在最前、照順序繞一圈', () => {
  assert.deepEqual(stackOrder(0, 3), [0, 1, 2])
  assert.deepEqual(stackOrder(1, 3), [1, 2, 0])
  assert.deepEqual(stackOrder(2, 3), [2, 0, 1])
  assert.deepEqual(stackOrder(0, 1), [0])
  assert.deepEqual(stackOrder(0, 0), [])
  assert.deepEqual(stackOrder(4, 3), [1, 2, 0])
  assert.deepEqual(stackOrder(-1, 3), [2, 0, 1])
})

test('isTap：移動不到 8px 算點一下', () => {
  assert.equal(isTap(0, 0), true)
  assert.equal(isTap(5, -5), true)
  assert.equal(isTap(8, 0), false)
  assert.equal(isTap(0, -12), false)
  assert.equal(isTap(6, 6), false)
})
