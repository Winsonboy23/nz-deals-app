// 口味 / 規格按鈕的純函式（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVariant, variantRows } from '../src/lib/variants.ts'

test('parseVariant：4 x 250ml 是 4 件共 1000ml', () => {
  const p = parseVariant('V Blue Guarana 4 x 250ml')
  assert.deepEqual(p, { flavourWords: ['V', 'Blue', 'Guarana'], size: '4 x 250ml', amount: 1000, count: 4 })
})

test('parseVariant：kg、L 換成 g、ml；26 Pack 只有件數', () => {
  assert.equal(parseVariant('Milk 1.5L').amount, 1500)
  assert.equal(parseVariant('Flour 1kg').amount, 1000)
  const p = parseVariant('Nescafe Sachets Caramel 26 Pack')
  assert.equal(p.size, '26 Pack')
  assert.equal(p.count, 26)
  assert.equal(p.amount, 0)
})

test('variantRows：Chris 的 V 例子——同口味排一起、小容量在前、標籤「口味 · 規格」', () => {
  const names = [
    'V Original Guarana 500ml', 'V Pineapple & Watermelon 4 x 250ml', 'V Blue Guarana 4 x 250ml',
    'V Original Guarana 250ml', 'V Refresh Blackcurrant Yuzu 4 x 250ml', 'V Green Guarana 4 x 250ml', 'V Blue Guarana 250ml',
  ]
  const labels = variantRows(names, (n) => n).map((r) => r.label)
  assert.deepEqual(labels, [
    'Blue Guarana · 250ml', 'Blue Guarana · 4 x 250ml',
    'Green Guarana · 4 x 250ml',
    'Original Guarana · 250ml', 'Original Guarana · 500ml',
    'Pineapple & Watermelon · 4 x 250ml',
    'Refresh Blackcurrant Yuzu · 4 x 250ml',
  ])
})

test('variantRows：Nescafé 的字序不同當同口味、共同字 Sachets 不算口味', () => {
  const labels = variantRows(['Nescafe Caramel Sachets 10 x 17g', 'Nescafe Sachets Caramel 26 Pack', 'Nescafe Sachets Mocha 10 x 18g'], (n) => n).map((r) => r.label)
  assert.deepEqual(labels, ['Caramel · 10 x 17g', 'Caramel · 26 Pack', 'Mocha · 10 x 18g'])
})

test('variantRows：只差容量 → 只有規格；完全認不出規格 → 原名', () => {
  assert.deepEqual(variantRows(['Pams Butter 500g', 'Pams Butter 250g'], (n) => n).map((r) => r.label), ['250g', '500g'])
  assert.deepEqual(variantRows(['Lemon', 'Lime'], (n) => n).map((r) => r.label), ['Lemon', 'Lime'])
})
