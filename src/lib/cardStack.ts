// 會員卡疊卡（CardsView，2026-10-01 Chris 規格「疊卡左右滑」）的純函式：放開時換不換卡、疊的順序。
// tests/cardStack.test.ts 用 node --test 直接跑，所以不 import 任何東西。

/** 手指移動不到這麼多（px）放開＝點一下（放大）；超過就是拖曳，不放大 */
export const TAP_SLOP = 8

/** 0..count-1 之間繞圈（負的、超過的都轉回來）；沒有卡回 0 */
function wrap(i: number, count: number): number {
  return count > 0 ? ((i % count) + count) % count : 0
}

/** 位移 dx、dy（px）算不算「點一下」 */
export function isTap(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) < TAP_SLOP
}

/**
 * 拖曳放開後最前面是哪一張：左右拖超過 threshold（px）→ 最前面那張甩到最後、下一張換上來（往左往右都一樣，方向只決定往哪邊甩）；
 * 拖太短 → 彈回原位，還是同一張。只有 0、1 張時不換。
 */
export function nextIndex(current: number, count: number, dx: number, threshold = 60): number {
  if (count < 2 || !(Math.abs(dx) > threshold)) return wrap(current, count)
  return wrap(current + 1, count)
}

/** 「‹ 上一張」：最後面那張回到最前面 */
export function prevIndex(current: number, count: number): number {
  return wrap(current - 1, count)
}

/** 由前到後的卡片索引：current 在最前，後面照清單順序繞一圈（3 張、current 1 → [1, 2, 0]） */
export function stackOrder(current: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, k) => wrap(current + k, count))
}
