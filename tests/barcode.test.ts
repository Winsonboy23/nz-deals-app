// 會員卡條碼的純函式（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanCode, ean13Valid, toJsBarcodeFormat } from '../src/lib/barcode.ts'

test('toJsBarcodeFormat：BarcodeDetector 的格式名 → JsBarcode', () => {
  assert.equal(toJsBarcodeFormat('ean_13'), 'EAN13')
  assert.equal(toJsBarcodeFormat('code_128'), 'CODE128')
  assert.equal(toJsBarcodeFormat('code_39'), 'CODE39')
  assert.equal(toJsBarcodeFormat('upc_a'), 'UPC')
  assert.equal(toJsBarcodeFormat('itf'), 'ITF')
})

test('toJsBarcodeFormat：ZXing 的大寫名（BarcodeFormat[n]）一樣認得', () => {
  assert.equal(toJsBarcodeFormat('EAN_13'), 'EAN13')
  assert.equal(toJsBarcodeFormat('CODE_128'), 'CODE128')
  assert.equal(toJsBarcodeFormat('CODE_39'), 'CODE39')
  assert.equal(toJsBarcodeFormat('UPC_A'), 'UPC')
  assert.equal(toJsBarcodeFormat('ITF'), 'ITF')
})

test('toJsBarcodeFormat：其他或不知道的 → CODE128', () => {
  for (const f of ['qr_code', 'ean_8', 'upc_e', 'codabar', 'code_93', 'QR_CODE', 'unknown', '', 'constructor', '__proto__', null, undefined]) {
    assert.equal(toJsBarcodeFormat(f), 'CODE128', String(f))
  }
})

test('cleanCode：去掉所有空白（半形、全形、不斷行、換行、tab、零寬），其他字不動', () => {
  assert.equal(cleanCode(' 9400 1234\t5678\n'), '940012345678')
  assert.equal(cleanCode('6014　3520 1234'), '601435201234')
  assert.equal(cleanCode('12​34﻿'), '1234')
  assert.equal(cleanCode('AB-12/c'), 'AB-12/c')
  assert.equal(cleanCode('   '), '')
})

test('ean13Valid：13 位數字 + 檢查碼', () => {
  assert.equal(ean13Valid('4006381333931'), true)
  assert.equal(ean13Valid('5901234123457'), true)
  assert.equal(ean13Valid('9400000000030'), true)   // 檢查碼 0（加總剛好是 10 的倍數）
  assert.equal(ean13Valid('4006381333932'), false)   // 檢查碼錯
  assert.equal(ean13Valid('400638133393'), false)   // 12 位
  assert.equal(ean13Valid('40063813339310'), false)   // 14 位
  assert.equal(ean13Valid('40063813339a1'), false)   // 有字母
  assert.equal(ean13Valid('4006 381333931'), false)   // 有空白：先 cleanCode
  assert.equal(ean13Valid(''), false)
})
