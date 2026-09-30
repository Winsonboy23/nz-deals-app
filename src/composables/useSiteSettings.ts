// 後台的開關與公告（settings 表，公開讀；docs/admin-spec.md §2.6）。
// 啟動時讀一次就好，讀不到照預設跑（即時查價開、AI 食譜開、沒有公告）。
// 注意跟 useSettings.ts 不同：那支是這台裝置自己的偏好（只看食品），這支是全站設定。
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const livePrices = ref(true)
const aiRecipes = ref(true)
const announce = ref('')
/** 換網域：新網址的 host（例如 kitewise.co.nz，不含 https://）；空字串 = 關。只有舊網址會照這個跳過去（main.ts） */
const migrateHost = ref('')
let started: Promise<void> | null = null

/** 只讀一次；再叫拿到同一個 promise，所以 await 它就是等到真的讀完（main.ts 換網域要等讀完才判斷） */
function loadSiteSettings(): Promise<void> {
  return (started ??= read())
}

async function read(): Promise<void> {
  const { data, error } = await supabase.from('settings').select('key,value')
  if (error || !data) return
  const v = new Map((data as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]))
  livePrices.value = v.get('live_prices') !== 'off'
  aiRecipes.value = v.get('ai_recipes') !== 'off'
  announce.value = v.get('announce') ?? ''
  migrateHost.value = v.get('migrate_host') ?? ''
}
void loadSiteSettings()

export function useSiteSettings() {
  return { livePrices, aiRecipes, announce, migrateHost, loadSiteSettings }
}
