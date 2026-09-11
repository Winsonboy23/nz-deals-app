<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ProductThumb from '../components/ProductThumb.vue'
import { supabase } from '../lib/supabase'
import { useSpecials } from '../composables/useSpecials'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'
import { dealPrice } from '../lib/compare'
import { chainClass, chainName, displayName, money, priceSuffix, unitLabel, wasPriceOf } from '../lib/format'
import { chainBadge, t } from '../composables/useI18n'
import type { Group } from '../lib/types'

// 關注中：商品頁按 ☆ 的東西。這週你的店有特價的排上面（可點進商品頁），沒特價的排下面只列名字。
const { isIn } = useAuth()
const { watched, toggleWatch } = useSync()
const { groups } = useSpecials()

const hits = computed<Group[]>(() =>
  [...watched.value].map((k) => groups.value.get(k)).filter((g): g is Group => !!g),
)
const missing = computed<string[]>(() => [...watched.value].filter((k) => !groups.value.has(k)))

/** 沒特價的商品只有 key，名字去 products 表查一次（公開讀）。 */
const names = ref<Record<string, string>>({})
watch(
  missing,
  async (keys) => {
    const need = keys.filter((k) => !(k in names.value))
    if (!need.length) return
    const { data } = await supabase.from('products').select('key,display_name').in('key', need)
    const next = { ...names.value }
    for (const r of data ?? []) next[r.key as string] = r.display_name as string
    for (const k of need) if (!(k in next)) next[k] = k.replace(/_/g, ' ')
    names.value = next
  },
  { immediate: true },
)

function detail(g: Group): string {
  const s = g.best.special
  if (s.club_only) return `Clubcard · ${unitLabel(s) ?? money(s.price)}`
  const was = wasPriceOf(s)
  if (was) return `was ${money(was)}`
  return unitLabel(s) ?? t('tag.low')
}
function others(g: Group): string {
  if (g.offers.length < 2) return ''
  return t('cmp.others', { v: g.offers.slice(1).map((o) => money(dealPrice(o.special))).join(' · ') })
}
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 8px">
      <RouterLink class="back" to="/me">{{ t('watching.back') }}</RouterLink>
      <div class="h1" style="margin-top: 4px">{{ t('watching.title') }}</div>
      <div v-if="isIn && watched.size" class="sub" style="margin-top: 5px">
        {{ t('watching.sub', { n: watched.size }) }}
      </div>
    </div>

    <!-- 沒登入 -->
    <div v-if="!isIn" class="pad" style="margin-top: 16px">
      <div class="note sub">{{ t('watching.signIn') }}</div>
      <RouterLink class="btn" to="/signin" style="margin-top: 12px; width: 100%; display: flex; align-items: center; justify-content: center">
        {{ t('auth.google') }}
      </RouterLink>
    </div>

    <!-- 空的 -->
    <div v-else-if="!watched.size" class="pad" style="margin-top: 20px">
      <div class="empty">
        <div style="font-size: 22px; color: #c4c4c0; line-height: 1">☆</div>
        <div class="h3" style="margin-top: 9px; font-size: 15.5px">{{ t('watching.empty') }}</div>
        <div class="s" style="margin-top: 3px">{{ t('watching.emptyHint') }}</div>
      </div>
    </div>

    <template v-else>
      <!-- 這週有特價 -->
      <template v-if="hits.length">
        <div class="pad" style="margin-top: 16px"><div class="sec">{{ t('watching.onSpecial') }}</div></div>
        <div class="pad" style="margin-top: 6px">
          <RouterLink
            v-for="g in hits"
            :key="g.key"
            class="lrow"
            :to="`/p/${encodeURIComponent(g.key)}`"
            style="padding: 8px 0; border-top: 1px solid var(--line); gap: 9px"
          >
            <ProductThumb :special="g.best.special" variant="tn" style="width: 46px; height: 46px" />
            <div class="grow" style="min-width: 0">
              <div class="t ell" style="font-size: 14.5px">{{ displayName(g.best.special) }}</div>
              <div style="display: flex; align-items: center; gap: 7px; margin-top: 4px">
                <span v-if="g.offers.length >= 2" class="tag best" :class="chainClass(g.best.store.id)">✓ {{ chainBadge(g.best.store.id) }}</span>
                <template v-else><span class="dot" :class="chainClass(g.best.store.id)" /><span class="small" style="flex: none">{{ chainName(g.best.store.id) }}</span></template>
                <span class="ell" style="font-size: 12px; color: var(--ink-2)">{{ detail(g) }}</span>
              </div>
              <div v-if="others(g)" class="others" style="margin-top: 3px">{{ others(g) }}</div>
            </div>
            <div style="text-align: right; flex: none">
              <div class="price" style="margin-top: 0; font-size: 20px">
                {{ money(dealPrice(g.best.special)) }}<span v-if="priceSuffix(g.best.special)" class="unit">{{ priceSuffix(g.best.special) }}</span>
              </div>
              <button class="btn ghost" style="margin-top: 6px; margin-left: auto; width: auto; height: 30px; padding: 0 10px; font-size: 12.5px; border-radius: 9px; white-space: nowrap" @click.prevent.stop="toggleWatch(g.key)">
                {{ t('watching.unfollow') }}
              </button>
            </div>
          </RouterLink>
        </div>
      </template>

      <!-- 這週沒特價 -->
      <template v-if="missing.length">
        <div class="pad" style="margin-top: 18px"><div class="sec">{{ t('watching.noSpecial') }}</div></div>
        <div class="pad" style="margin-top: 6px">
          <div
            v-for="k in missing"
            :key="k"
            class="lrow"
            style="padding: 8px 0; border-top: 1px solid var(--line); gap: 9px"
          >
            <div class="tn" style="width: 46px; height: 46px" />
            <div class="grow" style="min-width: 0; opacity: 0.6">
              <div class="t ell" style="font-size: 14.5px">{{ names[k] ?? '…' }}</div>
              <div class="s ell">{{ t('cmp.noSpecial') }}</div>
            </div>
            <button class="btn ghost" style="flex: none; width: auto; height: 30px; padding: 0 10px; font-size: 12.5px; border-radius: 9px; white-space: nowrap" @click="toggleWatch(k)">
              {{ t('watching.unfollow') }}
            </button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
