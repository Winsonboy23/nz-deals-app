import { ref, shallowRef } from 'vue'
import { supabase } from '../lib/supabase'
import { readCache, writeCache } from '../lib/cache'
import type { Category } from '../lib/types'

const byId = shallowRef<Record<string, Category>>(readCache('categories') ?? {})
const loaded = ref(Object.keys(byId.value).length > 0)

async function loadCategories(): Promise<void> {
  const { data, error } = await supabase.from('categories').select('id,level,parent_id,name')
  if (error || !data) return
  const map: Record<string, Category> = {}
  for (const c of data as Category[]) map[c.id] = c
  byId.value = map
  loaded.value = true
  writeCache('categories', map)
}

/** English name of a category id, falling back to the last slug segment. */
function nameOf(id: string | null): string {
  if (!id) return ''
  const c = byId.value[id]
  if (c) return c.name
  const last = id.split('/').pop() ?? ''
  return last.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

export function useCategories() {
  return { byId, loaded, loadCategories, nameOf }
}
