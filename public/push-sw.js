// Web Push（NZ Deals）。vite-plugin-pwa 產生的 sw.js 會 importScripts 這支（vite.config.ts workbox.importScripts）。
// 週一 src/notify.ts 推的 JSON：{ title, body, url, tag }。
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  const icon = new URL('icon-192.png', self.registration.scope).href
  e.waitUntil(self.registration.showNotification(d.title || 'NZ Deals', { body: d.body || '', icon, badge: icon, tag: d.tag || 'nz-deals', data: { url: d.url || './' } }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((w) => w.url.startsWith(self.registration.scope))
    if (c) { if ('navigate' in c) c.navigate(url); return c.focus() }
    return self.clients.openWindow(url)
  }))
})
