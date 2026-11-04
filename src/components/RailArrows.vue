<script setup lang="ts">
// 橫滑列的外框（2026-11-04）：包住一條 .hscroll，電腦上滑鼠能按住拖（lib/dragScroll.ts），兩邊各一顆 ‹ ›，
// 捲到最左邊 ‹ 不出現、最右邊 › 不出現；點一下捲一個畫面寬。手機（沒有滑鼠）整個不顯示箭頭、拖的程式也不會動。
// 用法：<RailArrows><div class="hscroll …">…</div></RailArrows>；v-if 放在 RailArrows 外面（裡面那條列要一直在）。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { arrowState, dragScroll } from '../lib/dragScroll'

const root = ref<HTMLElement>()
const can = ref({ left: false, right: false })
let rail: HTMLElement | null = null
let stop: (() => void) | undefined
let ro: ResizeObserver | undefined
let mo: MutationObserver | undefined

function update() {
  if (rail) can.value = arrowState(rail.scrollLeft, rail.clientWidth, rail.scrollWidth)
}
/** 捲一個畫面寬（扣掉兩邊留白）；有 scroll-snap 的列捲完自己會對齊卡片 */
function step(dir: -1 | 1) {
  rail?.scrollBy({ left: dir * Math.max(1, rail.clientWidth - 32), behavior: 'smooth' })
}

onMounted(() => {
  rail = root.value?.querySelector(':scope > .hscroll') ?? null
  if (!rail) return
  stop = dragScroll(rail)
  rail.addEventListener('scroll', update, { passive: true })
  ro = new ResizeObserver(update)
  ro.observe(rail)
  mo = new MutationObserver(update)   // 卡片換了（資料載好、換店）內容寬度會變
  mo.observe(rail, { childList: true })
  update()
})
onBeforeUnmount(() => {
  stop?.()
  rail?.removeEventListener('scroll', update)
  ro?.disconnect()
  mo?.disconnect()
})
</script>

<template>
  <div ref="root" class="rw">
    <slot />
    <button v-show="can.left" type="button" class="ra l" aria-label="‹" @click="step(-1)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>
    </button>
    <button v-show="can.right" type="button" class="ra r" aria-label="›" @click="step(1)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>
    </button>
  </div>
</template>

<style scoped>
.rw { position: relative; }
/* 箭頭：白色圓鈕、淡陰影、深色線條，垂直置中壓在列的左右邊上；只有有滑鼠的裝置才顯示 */
.ra {
  display: none;
  position: absolute;
  top: 50%;
  z-index: 3;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--card);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(28, 33, 29, 0.12), 0 4px 12px -2px rgba(28, 33, 29, 0.25);
  transform: translateY(-50%);
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ra.l { left: 4px; }
.ra.r { right: 4px; }
.ra svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.ra:hover { background: var(--brand-tint); }
@media (hover: hover) and (pointer: fine) {
  .ra { display: flex; }
}
</style>
