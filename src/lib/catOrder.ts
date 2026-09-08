import order from '../data/category-order.json'

const index = new Map<string, number>((order as string[]).map((id, i) => [id, i]))

/** 超市自己的分類順序（雞肉→牛肉→羊肉→豬肉→…→植物替代）。不在清單裡的排最後。 */
export function catRank(id: string | null): number {
  return id == null ? 1e9 : (index.get(id) ?? 1e9)
}
