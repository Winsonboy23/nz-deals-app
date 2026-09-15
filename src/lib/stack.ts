import type { Special } from './types'
import { catLevel } from './format'

/** A run of rows that belong together: the head is the one shown, the rest unfold on tap. */
export interface Stack<T> {
  key: string
  head: T
  items: T[]
}

/** Group rows by key, keeping the input order: the first row seen for a key becomes the head, so sort before stacking. */
export function stackBy<T>(list: T[], keyOf: (t: T) => string): Stack<T>[] {
  const map = new Map<string, T[]>()
  for (const t of list) {
    const k = keyOf(t)
    const cur = map.get(k)
    if (cur) cur.push(t)
    else map.set(k, [t])
  }
  return [...map.entries()].map(([key, items]) => ({ key, head: items[0], items }))
}

/**
 * "Same range" key: brand + level-2 category (Cadbury blocks, Moccona coffees). Null when the row has
 * no brand — callers fall back to a per-row key so unbranded produce never stacks by accident.
 */
export function rangeKey(s: Special): string | null {
  const b = (s.brand ?? '').trim().toLowerCase()
  return b ? `${b}|${catLevel(s.category_id, 2) ?? ''}` : null
}
