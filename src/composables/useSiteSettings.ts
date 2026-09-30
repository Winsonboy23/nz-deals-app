// 後台的開關與公告（settings 表，公開讀；docs/admin-spec.md §2.6）。
// 啟動時讀一次就好，讀不到照預設跑（即時查價開、AI 食譜開、沒有公告、Facebook 登入關）。
// 注意跟 useSettings.ts 不同：那支是這台裝置自己的偏好（只看食品），這支是全站設定。
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const livePrices = ref(true)
const aiRecipes = ref(true)
const announce = ref('')
/** 登入頁的 Facebook 鈕：Supabase 的 Facebook provider 設好之前關著，值是 'on' 才開（2026-09-30） */
const facebookLogin = ref(false)
let started = false

async function loadSiteSettings(): Promise<void> {
  if (started) return
  started = true
  const { data, error } = await supabase.from('settings').select('key,value')
  if (error || !data) return
  const v = new Map((data as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]))
  livePrices.value = v.get('live_prices') !== 'off'
  aiRecipes.value = v.get('ai_recipes') !== 'off'
  announce.value = v.get('announce') ?? ''
  facebookLogin.value = v.get('facebook_login') === 'on'
}
void loadSiteSettings()

export function useSiteSettings() {
  return { livePrices, aiRecipes, announce, facebookLogin, loadSiteSettings }
}
