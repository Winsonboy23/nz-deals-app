import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles/app.css'
import { readCache } from './lib/cache'

// Nothing to compare until stores are picked, so the picker is the front door.
router.beforeEach((to) => {
  if (to.path === '/stores') return true
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
