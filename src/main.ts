import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles/app.css'
import { readCache } from './lib/cache'

// Nothing to compare until stores are picked, so the picker is the front door.
router.beforeEach((to) => {
  if (['/stores', '/admin', '/privacy', '/delete-data'].includes(to.path)) return true   // 後台不用選店；隱私權政策、刪除資料說明是給 Meta 審核的公開網址，沒選店也要打得開
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

createApp(App).use(router).mount('#app')
