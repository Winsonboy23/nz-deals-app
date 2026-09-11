<script setup lang="ts">
// 後台「使用者」（docs/admin-spec.md §2.5）：誰註冊了、選了哪幾家店、清單／關注幾樣、推播開了沒，
// 加上通知記錄、AI 食譜用量與最近生成的。只看不改。
import { computed, onMounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'

const err = ref('')
const loading = ref(true)

interface U {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
}
const users = ref<U[]>([])
const lang = ref<Map<string, string>>(new Map())
const stores = ref<Map<string, string[]>>(new Map())
const listCount = ref<Map<string, number>>(new Map())
const watchCount = ref<Map<string, number>>(new Map())
const pushed = ref<Set<string>>(new Set())

interface Note {
  user_id: string
  week_start: string
  kind: string
  payload: any
  sent_at: string
}
const notes = ref<Note[]>([])
interface Usage {
  caller: string
  day: string
  count: number
}
const usage = ref<Usage[]>([])
interface Recipe {
  id: string
  user_id: string
  created_at: string
  title: string
}
const recipes = ref<Recipe[]>([])

const emailOf = computed(() => new Map(users.value.map((u) => [u.id, u.email])))
const who = (id: string) => emailOf.value.get(id) ?? id.slice(0, 8)

async function load() {
  const { data: us, error } = await supabase.rpc('admin_users')
  if (error) {
    err.value = error.message
    loading.value = false
    return
  }
  users.value = (us ?? []) as U[]

  const [{ data: profiles }, { data: userStores }, { data: lists }, { data: items }, { data: watch }, { data: subs }, { data: nt }, { data: au }, { data: ar }] =
    await Promise.all([
      supabase.from('profiles').select('id,lang'),
      supabase.from('user_stores').select('user_id,store_id,position'),
      supabase.from('shopping_lists').select('id,user_id'),
      supabase.from('list_items').select('list_id'),
      supabase.from('watchlist').select('user_id'),
      supabase.from('push_subscriptions').select('user_id'),
      supabase.from('notifications').select('user_id,week_start,kind,payload,sent_at').order('sent_at', { ascending: false }).limit(50),
      supabase.from('ai_usage').select('caller,day,count').gte('day', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
      supabase.from('ai_recipes').select('id,user_id,created_at,title').order('created_at', { ascending: false }).limit(20),
    ])

  lang.value = new Map(((profiles ?? []) as Array<{ id: string; lang: string }>).map((p) => [p.id, p.lang]))

  const us2 = (userStores ?? []) as Array<{ user_id: string; store_id: string; position: number | null }>
  const ids = [...new Set(us2.map((r) => r.store_id))]
  const nameOf = new Map<string, string>()
  if (ids.length) {
    const { data: st } = await supabase.from('stores').select('id,name').in('id', ids)
    for (const s of (st ?? []) as Array<{ id: string; name: string }>) nameOf.set(s.id, s.name)
  }
  const sm = new Map<string, string[]>()
  for (const r of us2.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const list = sm.get(r.user_id) ?? []
    list.push(nameOf.get(r.store_id) ?? r.store_id)
    sm.set(r.user_id, list)
  }
  stores.value = sm

  const ownerOf = new Map(((lists ?? []) as Array<{ id: string; user_id: string }>).map((l) => [l.id, l.user_id]))
  const lc = new Map<string, number>()
  for (const it of (items ?? []) as Array<{ list_id: string }>) {
    const uid = ownerOf.get(it.list_id)
    if (uid) lc.set(uid, (lc.get(uid) ?? 0) + 1)
  }
  listCount.value = lc

  const wc = new Map<string, number>()
  for (const w of (watch ?? []) as Array<{ user_id: string }>) wc.set(w.user_id, (wc.get(w.user_id) ?? 0) + 1)
  watchCount.value = wc
  pushed.value = new Set(((subs ?? []) as Array<{ user_id: string }>).map((s) => s.user_id))

  notes.value = (nt ?? []) as Note[]
  usage.value = (au ?? []) as Usage[]
  recipes.value = (ar ?? []) as Recipe[]
  loading.value = false
}

/** 全站每天幾次（caller g:all）；沒有 g:all 那列的日子就用那天所有 u:/d: 的加總補 */
const perDay = computed(() => {
  const days = [...new Set(usage.value.map((u) => u.day))].sort().reverse()
  return days.map((day) => {
    const rows = usage.value.filter((u) => u.day === day)
    const all = rows.find((r) => r.caller === 'g:all')
    const sum = rows.filter((r) => r.caller.startsWith('u:') || r.caller.startsWith('d:')).reduce((a, b) => a + b.count, 0)
    return { day, n: all?.count ?? sum }
  })
})
/** 前 5 名 caller（7 天加總，不算 g:all / ip:） */
const topCallers = computed(() => {
  const m = new Map<string, number>()
  for (const u of usage.value) {
    if (u.caller === 'g:all' || u.caller.startsWith('ip:')) continue
    m.set(u.caller, (m.get(u.caller) ?? 0) + u.count)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
})

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '—')
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-TW') : '—')
/** 通知內容摘要：payload 裡有什麼就顯示什麼 */
function noteSummary(p: any): string {
  if (!p) return ''
  if (typeof p === 'string') return p
  return [p.title, p.body].filter(Boolean).join(' · ') || JSON.stringify(p).slice(0, 120)
}
/** caller 是 u:<uid> 就換成 email */
const callerName = (c: string) => (c.startsWith('u:') ? who(c.slice(2)) : c)

onMounted(() => void load())
</script>

<template>
  <div>
    <div v-if="err" class="note" style="margin-bottom: 12px; color: #b00020">{{ err }}</div>
    <div v-if="loading" class="sub muted">載入中…</div>

    <template v-else>
      <div class="sec" style="margin-bottom: 8px">使用者（{{ users.length }}）</div>
      <div class="box" style="margin-bottom: 22px">
        <div v-for="u in users" :key="u.id" class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">{{ u.email }}</div>
            <div class="s muted">
              註冊 {{ fmtDay(u.created_at) }} · 最後登入 {{ fmtTime(u.last_sign_in_at) }} · 語言 {{ lang.get(u.id) ?? '—' }} ·
              推播 {{ pushed.has(u.id) ? '有' : '沒有' }}
            </div>
            <div class="s">
              店：{{ (stores.get(u.id) ?? []).join('、') || '沒選' }} · 清單 {{ listCount.get(u.id) ?? 0 }} 樣 ·
              關注 {{ watchCount.get(u.id) ?? 0 }} 樣
            </div>
          </div>
        </div>
      </div>

      <div class="sec" style="margin-bottom: 8px">通知記錄（最近 {{ notes.length }} 則）</div>
      <div v-if="!notes.length" class="sub muted" style="margin-bottom: 22px">還沒發過。</div>
      <div v-else class="box" style="margin-bottom: 22px; max-height: 320px; overflow: auto">
        <div v-for="(n, i) in notes" :key="i" class="lrow" style="padding: 10px 14px">
          <div class="grow">
            <div class="t">{{ who(n.user_id) }} · {{ n.kind }}</div>
            <div class="s muted">{{ n.week_start }} · {{ fmtTime(n.sent_at) }} · {{ noteSummary(n.payload) }}</div>
          </div>
        </div>
      </div>

      <div class="sec" style="margin-bottom: 8px">AI 食譜用量（最近 7 天）</div>
      <div class="box" style="margin-bottom: 22px">
        <div v-if="!perDay.length" class="lrow" style="padding: 10px 14px"><div class="s muted">這 7 天沒人用。</div></div>
        <div v-for="d in perDay" :key="d.day" class="lrow" style="padding: 8px 14px">
          <div class="grow t">{{ d.day }}</div>
          <div class="s">{{ d.n }} 次</div>
        </div>
        <div v-if="topCallers.length" class="lrow" style="padding: 10px 14px; display: block">
          <div class="sec">用最多的</div>
          <div v-for="[c, n] in topCallers" :key="c" class="s">{{ callerName(c) }} — {{ n }} 次</div>
        </div>
      </div>

      <div class="sec" style="margin-bottom: 8px">最近生成的食譜（{{ recipes.length }}）</div>
      <div v-if="!recipes.length" class="sub muted">還沒有。</div>
      <div v-else class="box">
        <div v-for="r in recipes" :key="r.id" class="lrow" style="padding: 8px 14px">
          <div class="grow">
            <div class="t">{{ r.title }}</div>
            <div class="s muted">{{ who(r.user_id) }} · {{ fmtTime(r.created_at) }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
