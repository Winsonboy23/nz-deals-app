import { ref, watch } from 'vue'
import { readCache, writeCache } from '../lib/cache'

const foodOnly = ref<boolean>(readCache<boolean>('foodOnly') ?? true)
watch(foodOnly, (v) => writeCache('foodOnly', v))

export function useSettings() {
  return { foodOnly }
}
