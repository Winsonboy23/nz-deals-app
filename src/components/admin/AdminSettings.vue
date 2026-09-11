<script setup lang="ts">
// 後台「開關」（docs/admin-spec.md §2.6）：settings 表五個鍵。App 和 Edge Function 會讀這裡。
import { onMounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { useSiteSettings } from '../../composables/useSiteSettings'

const err = ref('')
const saved = ref(false)
const loading = ref(true)
const restarted = ref(false)

const livePrices = ref(true)
const aiRecipes = ref(true)
const aiCap = ref('300')
const priceCap = ref('5000')
const announce = ref('')

async function load() {
  const { data, error } = await supabase.from('settings').select('key,value')
  if (error) {
    err.value = error.message
    loading.value = false
    return
  }
  const v = new Map(((data ?? []) as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]))
  livePrices.value = v.get('live_prices') !== 'off'
  aiRecipes.value = v.get('ai_recipes') !== 'off'
  aiCap.value = v.get('ai_daily_cap') ?? '300'
  priceCap.value = v.get('price_daily_cap') ?? '5000'
  announce.value = v.get('announce') ?? ''
  loading.value = false
}

async function save() {
  const now = new Date().toISOString()
  const rows = [
    { key: 'live_prices', value: livePrices.value ? 'on' : 'off', updated_at: now },
    { key: 'ai_recipes', value: aiRecipes.value ? 'on' : 'off', updated_at: now },
    { key: 'ai_daily_cap', value: String(Number(aiCap.value) || 0), updated_at: now },
    { key: 'price_daily_cap', value: String(Number(priceCap.value) || 0), updated_at: now },
    { key: 'announce', value: announce.value, updated_at: now },
  ]
  const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' })
  if (error) {
    err.value = error.message
    return
  }
  err.value = ''
  saved.value = true
  setTimeout(() => (saved.value = false), 2500)
  // 這個分頁自己也照新設定走，不用重新整理
  const site = useSiteSettings()
  site.livePrices.value = livePrices.value
  site.aiRecipes.value = aiRecipes.value
  site.announce.value = announce.value
}

async function restart() {
  if (!confirm('要叫 Mac mini 上的 price-worker 重啟嗎？（launchd 會自動把它開回來）')) return
  const { error } = await supabase.from('admin_jobs').insert({ kind: 'restart_worker', payload: {} })
  if (error) {
    err.value = error.message
    return
  }
  restarted.value = true
  setTimeout(() => (restarted.value = false), 4000)
}

onMounted(() => void load())
</script>

<template>
  <div>
    <div v-if="err" class="note" style="margin-bottom: 12px; color: #b00020">{{ err }}</div>
    <div v-if="loading" class="sub muted">載入中…</div>

    <template v-else>
      <div class="box" style="margin-bottom: 16px">
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">即時查價（live_prices）</div>
            <div class="s muted">關掉之後 App 的一站不送單，顯示「即時查價暫停中」。</div>
          </div>
          <button class="tg" :class="{ off: !livePrices }" style="flex: none" @click="livePrices = !livePrices" />
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">AI 食譜（ai_recipes）</div>
            <div class="s muted">關掉之後清單底部的按鈕變灰，函式直接回 503。</div>
          </div>
          <button class="tg" :class="{ off: !aiRecipes }" style="flex: none" @click="aiRecipes = !aiRecipes" />
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">AI 每天全站上限（ai_daily_cap）</div>
            <div class="s muted">一次約 NZ$0.01–0.02。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="aiCap" type="number" min="0" step="10" style="flex: 1; min-width: 0" />
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">查價單每天全站上限（price_daily_cap）</div>
            <div class="s muted">超過就回 busy。</div>
          </div>
          <div class="field" style="height: 40px; font-size: 14px; width: 120px; flex: none">
            <input v-model="priceCap" type="number" min="0" step="100" style="flex: 1; min-width: 0" />
          </div>
        </div>
        <div class="lrow" style="padding: 12px 14px; display: block">
          <div class="t">首頁公告（announce）</div>
          <div class="s muted" style="margin-bottom: 8px">留空 = 不顯示。使用者關掉之後，同一句不再出現。</div>
          <textarea v-model="announce" rows="2" maxlength="200" style="width: 100%; box-sizing: border-box; font: inherit; padding: 8px 10px; border: 1.5px solid var(--line); border-radius: 12px" />
        </div>
      </div>

      <div class="chips" style="margin-bottom: 22px">
        <button class="chip on" @click="save">存</button>
        <span v-if="saved" class="tag half">已存</span>
      </div>

      <div class="sec" style="margin-bottom: 8px">Mac mini</div>
      <div class="box">
        <div class="lrow" style="padding: 12px 14px">
          <div class="grow">
            <div class="t">重啟 price-worker</div>
            <div class="s muted">插一張 restart_worker 派工單；worker 收到就自己結束，launchd 會重開。</div>
          </div>
          <button class="chip" style="flex: none" @click="restart">重啟</button>
        </div>
        <div v-if="restarted" class="lrow" style="padding: 10px 14px"><div class="s">派工單送出了。</div></div>
      </div>
    </template>
  </div>
</template>
