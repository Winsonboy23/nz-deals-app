// Web Push 訂閱（Phase 3；2026-09-07 決定先只做推播、不寄 Email）。
// 訂閱存 push_subscriptions（RLS：只能碰自己的）；週一抓完由 src/notify.ts 用 VAPID 私鑰推，notifications 表同週不重發。
// iPhone 只有「加入主畫面」再從那裡開的 App 才能訂閱，Safari 分頁裡開不了；Android／電腦瀏覽器直接可以。
import { ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type PushState = 'unsupported' | 'ios-not-installed' | 'denied' | 'off' | 'on' | 'busy'

const VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''
const state = ref<PushState>('off')
const error = ref('')
const { user } = useAuth()
let started = false

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
const supported = () => !!VAPID && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function refresh(): Promise<void> {
  if (isIOS() && !standalone()) { state.value = 'ios-not-installed'; return }
  if (!supported()) { state.value = 'unsupported'; return }
  if (Notification.permission === 'denied') { state.value = 'denied'; return }
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  state.value = sub ? 'on' : 'off'
}

async function enable(): Promise<void> {
  const uid = user.value?.id
  if (!uid || !supported()) return
  state.value = 'busy'
  error.value = ''
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') { state.value = perm === 'denied' ? 'denied' : 'off'; return }
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) throw new Error('service worker not registered')
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID }))
    const { error: e } = await supabase.from('push_subscriptions').upsert({ user_id: uid, endpoint: sub.endpoint, keys: sub.toJSON().keys }, { onConflict: 'endpoint' })
    if (e) throw e
    await supabase.from('profiles').update({ notify_push: true }).eq('id', uid)
    state.value = 'on'
  } catch (e) {
    error.value = String((e as Error).message ?? e)
    state.value = 'off'
  }
}

async function disable(): Promise<void> {
  const uid = user.value?.id
  state.value = 'busy'
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe() }
    if (uid) await supabase.from('profiles').update({ notify_push: false }).eq('id', uid)
  } finally {
    await refresh()
  }
}

export function usePush() {
  if (!started) { started = true; watch(user, () => void refresh(), { immediate: true }) }
  return { state, error, enable, disable, refresh }
}
