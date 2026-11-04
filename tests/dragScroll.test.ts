// 橫滑列滑鼠拖曳的純函式（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DRAG_SLOP, arrowState, isDrag, nearestIndex } from '../src/lib/dragScroll.ts'

test('isDrag：移動不到 5px 算點一下，超過才是拖', () => {
  assert.equal(isDrag(0), false)
  assert.equal(isDrag(4), false)
  assert.equal(isDrag(-DRAG_SLOP), false)
  assert.equal(isDrag(6), true)
  assert.equal(isDrag(-40), true)
})

test('arrowState：在最左邊只有 ›、中間兩個都有、最右邊只有 ‹', () => {
  assert.deepEqual(arrowState(0, 480, 1600), { left: false, right: true })
  assert.deepEqual(arrowState(300, 480, 1600), { left: true, right: true })
  assert.deepEqual(arrowState(1120, 480, 1600), { left: true, right: false })
})

test('arrowState：差 1px 內算到底（scrollLeft 有小數）；內容沒超出就兩個都不要', () => {
  assert.deepEqual(arrowState(0.5, 480, 1600), { left: false, right: true })
  assert.deepEqual(arrowState(1119.4, 480, 1600), { left: true, right: false })
  assert.deepEqual(arrowState(0, 480, 400), { left: false, right: false })
})

test('nearestIndex：捲到 x 最接近哪一張；一樣近取前面那張；沒有卡回 0', () => {
  const lefts = [0, 162, 324, 486]
  assert.equal(nearestIndex(lefts, 0), 0)
  assert.equal(nearestIndex(lefts, 70), 0)
  assert.equal(nearestIndex(lefts, 100), 1)
  assert.equal(nearestIndex(lefts, 81), 0)
  assert.equal(nearestIndex(lefts, 900), 3)
  assert.equal(nearestIndex([], 50), 0)
})
