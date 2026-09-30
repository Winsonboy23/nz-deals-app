<script setup lang="ts">
// 會員卡條碼：JsBarcode 畫成 SVG，只有線條、不印字（號碼另外用大字印）。
// 寬度撐滿、高度照外面給的 class 拉（一維條碼只看橫向，拉高不影響掃描）；左右各留 11 格空白（quiet zone），掃描器才找得到頭尾。
// 存的格式畫不出來（EAN13 檢查碼不對、ITF 位數是單數…）→ 改畫 CODE128，任何掃描器都讀得到。
import { onMounted, ref, watch } from 'vue'
import JsBarcode from 'jsbarcode'

const props = defineProps<{ code: string; format: string }>()
const svg = ref<SVGSVGElement | null>(null)

const OPTS = {
  width: 2,
  height: 100,
  margin: 0,
  marginLeft: 22,
  marginRight: 22,
  displayValue: false,
  flat: true,   // EAN / UPC 的護線不另外加長，整排一樣高
  background: '#ffffff',
  lineColor: '#000000',
}

/** 畫得出來回 true。號碼不合格式時 JsBarcode 只叫 valid(false)；不認得的格式名會直接丟錯，一起接住。 */
function tryDraw(el: SVGSVGElement, format: string): boolean {
  let ok = true
  try {
    JsBarcode(el, props.code, { ...OPTS, format, valid: (v: boolean) => { ok = v } })
  } catch {
    ok = false
  }
  return ok
}

function draw(): void {
  const el = svg.value
  if (!el) return
  if (!tryDraw(el, props.format)) tryDraw(el, 'CODE128')
  el.setAttribute('preserveAspectRatio', 'none')
}
onMounted(draw)
watch(() => [props.code, props.format], draw)
</script>

<template>
  <svg ref="svg" class="card-barcode" role="img" :aria-label="code" />
</template>

<style scoped>
/* 高度由用的地方給（卡片、放大） */
.card-barcode { display: block; width: 100%; }
</style>
