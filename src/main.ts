import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles/app.css'
import { readCache } from './lib/cache'
import { useSiteSettings } from './composables/useSiteSettings'
import { OLD_HOST, encodePayload, exportGuestData } from './lib/migrate'

// Nothing to compare until stores are picked, so the picker is the front door.
router.beforeEach((to) => {
  if (['/stores', '/admin', '/migrate', '/privacy', '/delete-data'].includes(to.path)) return true   // 後台不用選店；搬家頁要先把舊網址的店搬進來；隱私權政策、刪除資料說明是給 Meta 審核的公開網址
  const picked = readCache<string[]>('selected')
  return picked && picked.length ? true : '/stores'
})

// 每次部署 JS 檔名都會換；還開著舊版的頁面去載新頁會 404（"Failed to fetch dynamically imported module"）。
// 遇到就重新整理一次拿新版，不然點什麼都沒反應。
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  location.reload()
})
router.onError((err) => {
  if (/dynamically imported module|Importing a module script failed/.test(String(err))) location.reload()
})

// 換網域：後台 settings.migrate_host 填了新網址、而且現在開的是舊網址 → 帶著訪客資料跳過去（lib/migrate.ts、views/MigrateView.vue）。
// 新網址（host 就是 migrate_host）和本機開發（host 不是舊網址）都不會觸發。
const { migrateHost, loadSiteSettings } = useSiteSettings()
void loadSiteSettings().then(() => {
  const newHost = migrateHost.value
  if (newHost && location.host !== newHost && location.host === OLD_HOST) {
    let d = ''
    try {
      d = encodePayload(exportGuestData(localStorage))
    } catch {
      /* 瀏覽器不給讀 localStorage 就只跳、不帶資料 */
    }
    location.replace('https://' + newHost + '/#/migrate?d=' + d)
  }
})

createApp(App).use(router).mount('#app')
