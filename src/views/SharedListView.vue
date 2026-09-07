<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import ProductThumb from '../components/ProductThumb.vue'
import { supabase } from '../lib/supabase'
import { useList } from '../composables/useList'
import { useSpecials } from '../composables/useSpecials'
import { t } from '../composables/useI18n'
import type { Special } from '../lib/types'

interface Row { id: string; product_key: string | null; free_text: string | null; qty: number | null; checked: boolean | null }
const route = useRoute()
const { add, addFreeText } = useList()
const name = ref('')
const rows = ref<Row[]>([])
const state = ref<'loading' | 'ok' | 'missing'>('loading')
const copied = ref(false)

// 照片：看的人的店有這樣東西就直接用；沒有的話去 specials 抓這週任一家店的那一筆（只要圖用的欄位）。
const { groups, thisWeek } = useSpecials()
const pics = ref<Record<string, Special>>({})
const thumb = (r: Row): Special | null =>
  r.product_key ? (groups.value.get(r.product_key)?.best.special ?? pics.value[r.product_key] ?? null) : null
const weekBefore = (mon: string) => { const d = new Date(mon + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10) }
async function loadPics(keys: string[]): Promise<void> {
  const need = keys.filter((k) => !groups.value.has(k))
  if (!need.length) return
  // 週一凌晨這週還沒抓到 → 退一週
  for (const week of [thisWeek.value, weekBefore(thisWeek.value)]) {
    const { data } = await supabase.from('specials').select('product_key,store_id,product_id,image_url,name,category_id').eq('week_start', week).in('product_key', need)
    if (!data?.length) continue
    const next = { ...pics.value }
    for (const r of data) if (!next[r.product_key as string]) next[r.product_key as string] = r as unknown as Special
    pics.value = next
    return
  }
}

onMounted(async () => {
  const token = String(route.params.token ?? '')
  const { data } = await supabase.from('shopping_lists').select('id,name,list_items(id,product_key,free_text,qty,checked,position)').eq('share_token', token).limit(1)
  const list = data?.[0]
  if (!list) { state.value = 'missing'; return }
  name.value = list.name
  rows.value = ((list.list_items ?? []) as Array<Row & { position: number | null }>).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  state.value = 'ok'
  void loadPics(rows.value.map((r) => r.product_key).filter((k): k is string => !!k))
})
function copyIn() {
  for (const r of rows.value) { if (r.product_key) add(r.product_key, r.free_text ?? r.product_key); else if (r.free_text) addFreeText(r.free_text) }
  copied.value = true
}
</script>

<template>
  <!-- D2 · Shared list（唯讀） -->
  <div class="screen">
    <div class="pad" style="margin-top: 8px">
      <div class="h1">{{ t('shared.title') }}</div>
      <div class="sub" style="margin-top: 4px">{{ t('shared.readonly') }}</div>
    </div>
    <div v-if="state === 'loading'" class="pad" style="margin-top: 16px"><div class="skel" style="height: 60px" /></div>
    <div v-else-if="state === 'missing'" class="pad" style="margin-top: 16px"><div class="empty sub">{{ t('shared.notFound') }}</div></div>
    <template v-else>
      <div class="pad" style="margin-top: 14px">
        <div class="box">
          <div class="ghead" style="background: #111; color: #fff"><span class="ell">{{ name }}</span><span>{{ t('common.items', { n: rows.length }) }}</span></div>
          <div v-for="r in rows" :key="r.id" class="lrow" style="padding: 9px 12px; gap: 9px">
            <div class="cb" :class="{ on: r.checked }" style="width: 24px; height: 24px; font-size: 12px">✓</div>
            <ProductThumb v-if="thumb(r)" :special="thumb(r)!" variant="sq" class="list-tn" />
            <div v-else class="tn sq list-tn" />
            <div class="grow ell t" style="font-size: 14px">{{ r.free_text ?? r.product_key }}</div>
            <div class="small muted" style="flex: none">× {{ r.qty ?? 1 }}</div>
          </div>
        </div>
      </div>
      <div class="pad" style="margin-top: 14px">
        <button class="btn" style="width: 100%" :disabled="copied" @click="copyIn">{{ copied ? t('shared.copied') : t('shared.copy') }}</button>
      </div>
    </template>
  </div>
</template>
