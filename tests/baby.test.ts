// 寶寶支線存檔前的鹽糖蜂蜜檢查：前面 6 個字（英文 6 個詞）內有不加／不要／不放／no／without／skip 就不算（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { babyRisks } from '../src/lib/baby.ts'

test('中文：直接寫要加就算；前面 6 個字內有不加／不要／不放就不算', () => {
  assert.deepEqual(babyRisks('起鍋前撒一小撮鹽'), ['鹽'])
  assert.deepEqual(babyRisks('寶寶這份不加鹽、糖'), [])
  assert.deepEqual(babyRisks('不要放蜂蜜'), [])
  assert.deepEqual(babyRisks('不放任何鹽'), [])
})

test('中文：否定詞在 6 個字外不算數；同一樣出現兩次，有一次前面沒否定就算', () => {
  assert.deepEqual(babyRisks('不加調味，最後撒一點鹽'), ['鹽'])
  assert.deepEqual(babyRisks('不加鹽。起鍋前再撒一點鹽'), ['鹽'])
})

test('英文：看前面 6 個詞，大小寫都認，回小寫', () => {
  assert.deepEqual(babyRisks('No salt or sugar'), [])
  assert.deepEqual(babyRisks('Cook without any added salt'), [])
  assert.deepEqual(babyRisks('Skip the honey'), [])
  assert.deepEqual(babyRisks('Season with a pinch of Salt'), ['salt'])
  assert.deepEqual(babyRisks('No need to rush; add a pinch of salt and some sugar'), ['salt', 'sugar'])
})

test('no 要是整個詞：nothing 不算否定', () => {
  assert.deepEqual(babyRisks('nothing else, just a little salt'), ['salt'])
})

test('沒提到就是空的', () => {
  assert.deepEqual(babyRisks(''), [])
  assert.deepEqual(babyRisks('撈出牛肉 60 g，加 4 大匙還沒調味的原湯打成泥'), [])
})
