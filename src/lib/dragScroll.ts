// 橫滑列在電腦上的滑鼠操作（2026-11-04，Chris 用電腦測：按住拖會把商品圖拖出來、把字反白，列不會動）。
// 手機照舊：這裡只處理 pointerType 'mouse'，手指滑還是瀏覽器自己的捲動。
// 純函式（isDrag / arrowState / nearestIndex）給 tests/dragScroll.test.ts 用 node --test 跑，所以載入時不碰 window。

/** 滑鼠移動不到這麼多（px）放開＝點一下（開商品）；超過就是拖曳，放開時吞掉那一下點擊 */
export const DRAG_SLOP = 5

/** 位移 dx（px）算不算拖曳 */
export function isDrag(dx: number): boolean {
  return Math.abs(dx) > DRAG_SLOP
}

/** ‹ › 要不要顯示：捲到最左邊就不要 ‹、捲到最右邊就不要 ›（差 1px 內算到底，瀏覽器的 scrollLeft 常有小數） */
export function arrowState(scrollLeft: number, clientWidth: number, scrollWidth: number): { left: boolean; right: boolean } {
  return { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 }
}

/** 每張卡左緣離第一張的距離 lefts，現在捲到 x，最接近的是第幾張（沒有卡回 0） */
export function nearestIndex(lefts: number[], x: number): number {
  let best = 0
  for (let i = 1; i < lefts.length; i++) if (Math.abs(lefts[i] - x) < Math.abs(lefts[best] - x)) best = i
  return best
}

/**
 * 讓 el（overflow-x:auto 的橫滑列）能用滑鼠按住拖。回傳解除函式。
 * - 按下去就加 .dragging（app.css：user-select:none、cursor:grabbing），字不會反白；放開拿掉
 * - 按住期間 move / up 聽在 document 上：滑鼠一下子甩出列外也算得到；拖超過 DRAG_SLOP 才算拖，這時關掉 scroll-snap
 *   （不然每動一下都被吸回去）並抓住指標；沒超過就放開＝一般點擊，照常開卡片
 * - 放開：還原 scroll-snap，順順捲到最近的那張；緊接著的 click 在 capture 階段擋掉一次，卡片不會打開
 * - dragstart 一律擋掉：商品圖和連結（<a> 本來就可以拖）不會變成拖出去的鬼影
 */
export function dragScroll(el: HTMLElement): () => void {
  let drag: { id: number; x: number; left: number; moved: boolean } | null = null
  let swallowClick = false

  const listen = (on: boolean) => {
    if (on) {
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', up)
    } else {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
    }
  }
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    drag = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false }
    el.classList.add('dragging')
    listen(true)
  }
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    const dx = e.clientX - drag.x
    if (!drag.moved) {
      if (!isDrag(dx)) return
      drag.moved = true
      el.style.scrollSnapType = 'none'
      el.setPointerCapture(e.pointerId)
    }
    el.scrollLeft = drag.left - dx
  }
  const settle = () => {
    const kids = [...el.children] as HTMLElement[]
    if (!kids.length) return
    const x0 = kids[0].offsetLeft
    const i = nearestIndex(kids.map((k) => k.offsetLeft - x0), el.scrollLeft)
    el.scrollTo({ left: kids[i].offsetLeft - x0, behavior: 'smooth' })
  }
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    const moved = drag.moved
    drag = null
    listen(false)
    el.classList.remove('dragging')
    if (!moved) return
    el.style.scrollSnapType = ''
    settle()
    swallowClick = true
    setTimeout(() => (swallowClick = false))
  }
  const click = (e: MouseEvent) => {
    if (!swallowClick) return
    swallowClick = false
    e.preventDefault()
    e.stopPropagation()
  }
  const noDrag = (e: DragEvent) => e.preventDefault()

  el.addEventListener('pointerdown', down)
  el.addEventListener('click', click, true)
  el.addEventListener('dragstart', noDrag)
  return () => {
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('click', click, true)
    el.removeEventListener('dragstart', noDrag)
    listen(false)
    el.classList.remove('dragging')
    el.style.scrollSnapType = ''
  }
}
