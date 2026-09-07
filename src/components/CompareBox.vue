<script setup lang="ts">
import { computed } from 'vue'
import ProductThumb from './ProductThumb.vue'
import TagChip from './TagChip.vue'
import { dealPrice, primaryTag } from '../lib/compare'
import { chainClass, chainName, chainOf, displayName, money, unitLabel, wasPriceOf } from '../lib/format'
import { t } from '../composables/useI18n'
import type { Group, Offer } from '../lib/types'

const props = defineProps<{ group: Group; title?: string }>()
const heading = computed(() => props.title ?? displayName(props.group.best.special))
const to = computed(() => `/p/${encodeURIComponent(props.group.key)}`)

/** 一列一家店，寫分店名；同一家超市、同價的分店合成一列「Woolworths · 2 家店」（選了兩家 Woolworths 才不會看起來重複）。 */
interface Row { key: string; label: string; offer: Offer; isBest: boolean }
const rows = computed<Row[]>(() => {
  const byChainPrice = new Map<string, Offer[]>()
  for (const o of props.group.offers) {
    const k = `${chainOf(o.store.id)}|${dealPrice(o.special).toFixed(2)}`
    const list = byChainPrice.get(k)
    if (list) list.push(o)
    else byChainPrice.set(k, [o])
  }
  return [...byChainPrice.values()].map((offers) => ({
    key: offers.map((o) => o.store.id).join('+'),
    label: offers.length === 1 ? offers[0].store.name : t('cmp.nStores', { c: chainName(offers[0].store.id), n: offers.length }),
    offer: offers[0],
    isBest: offers.includes(props.group.best),
  }))
})
</script>

<template>
  <div class="box">
    <div class="hrow" style="padding: 8px 12px; border-bottom: 1px solid var(--line)">
      <div class="h3 ell grow">{{ heading }}</div>
      <div style="flex: none; text-align: right">
        <span class="tag same" style="font-size: 10px">
          {{ t('cmp.same', { n: group.offers.length }) }}
        </span>
        <div v-if="group.unitDecided" class="small muted" style="margin-top: 2px">
          ✓ {{ t('cmp.byUnit') }}
        </div>
      </div>
    </div>
    <RouterLink
      v-for="r in rows"
      :key="r.key"
      class="lrow"
      :to="to"
      :style="{ padding: '7px 12px', background: r.isBest ? '#FFFCF0' : '' }"
    >
      <ProductThumb :special="r.offer.special" variant="sq" />
      <span class="dot" :class="chainClass(r.offer.store.id)" />
      <div class="grow">
        <div class="t ell">{{ r.label }}</div>
        <div class="s ell">
          <TagChip
            v-if="primaryTag(r.offer.special)"
            :tag="primaryTag(r.offer.special)!"
            style="height: 17px; font-size: 10px; margin-right: 5px"
          />
          <s v-if="wasPriceOf(r.offer.special)">{{ money(wasPriceOf(r.offer.special)!) }}</s>
          <span v-else-if="unitLabel(r.offer.special)">{{ unitLabel(r.offer.special) }}</span>
        </div>
      </div>
      <div class="p">{{ money(dealPrice(r.offer.special)) }}</div>
      <div
        style="font-family: 'Inter Tight', Inter, sans-serif; font-weight: 900; font-size: 16px; flex: none; width: 14px"
      >
        {{ r.isBest && rows.length >= 2 ? '✓' : '' }}
      </div>
    </RouterLink>
  </div>
</template>
