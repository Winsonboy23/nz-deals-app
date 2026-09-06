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

createApp(App).use(router).mount('#app')
