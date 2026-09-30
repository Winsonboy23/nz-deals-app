// 會員卡（我的 → 會員卡）的條碼小工具。純函式，tests/barcode.test.ts 用 node --test 直接跑，所以不 import 任何東西。

/** 讀到的格式（BarcodeDetector 的 ean_13…、ZXing 的 EAN_13…，大小寫都收）→ JsBarcode 的格式名 */
const JS_FORMAT = new Map([
  ['ean_13', 'EAN13'],
  ['code_128', 'CODE128'],
  ['code_39', 'CODE39'],
  ['upc_a', 'UPC'],
  ['itf', 'ITF'],
])

/** 其他（QR、EAN-8…）或不知道的一律 CODE128：什麼號碼都畫得出來，店裡任何掃描器都讀得到。 */
export function toJsBarcodeFormat(detectorFormat: string | null | undefined): string {
  return JS_FORMAT.get(String(detectorFormat ?? '').toLowerCase()) ?? 'CODE128'
}

/** 號碼去掉所有空白：手打的「9400 1234」、全形空白、換行、複製貼上夾帶的零寬空白都算。 */
export function cleanCode(str: string): string {
  return str.replace(/[\s​-‍⁠﻿]+/g, '')
}

/** 13 位數字、最後一位檢查碼對得上才是 EAN-13（前 12 位奇數位 ×1、偶數位 ×3）。 */
export function ean13Valid(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1)
  return (10 - (sum % 10)) % 10 === Number(code[12])
}
