<script setup lang="ts">
import { computed } from 'vue'
import ProductThumb from './ProductThumb.vue'
import TagChip from './TagChip.vue'
import { dealPrice, primaryTag } from '../lib/compare'
import { chainClass, chainName, displayName, money, unitLabel, wasPriceOf } from '../lib/format'
import { t } from '../composables/useI18n'
import type { Group } from '../lib/types'

const props = defineProps<{ group: Group; title?: string }>()
const heading = computed(() => props.title ?? displayName(props.group.best.special))
const to = computed(() => `/p/${encodeURIComponent(props.group.key)}`)
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
      v-for="o in group.offers"
      :key="o.store.id"
      class="lrow"
      :to="to"
      :style="{ padding: '7px 12px', background: o === group.best ? '#FFFCF0' : '' }"
    >
      <ProductThumb :special="o.special" variant="sq" />
      <span class="dot" :class="chainClass(o.store.id)" />
      <div class="grow">
        <div class="t ell">{{ chainName(o.store.id) }}</div>
        <div class="s ell">
          <TagChip
            v-if="primaryTag(o.special)"
            :tag="primaryTag(o.special)!"
            style="height: 17px; font-size: 10px; margin-right: 5px"
          />
          <s v-if="wasPriceOf(o.special)">{{ money(wasPriceOf(o.special)!) }}</s>
          <span v-else-if="unitLabel(o.special)">{{ unitLabel(o.special) }}</span>
        </div>
      </div>
      <div class="p">{{ money(dealPrice(o.special)) }}</div>
      <div
        style="font-family: 'Inter Tight', Inter, sans-serif; font-weight: 900; font-size: 16px; flex: none; width: 14px"
      >
        {{ o === group.best && group.offers.length >= 2 ? '✓' : '' }}
      </div>
    </RouterLink>
  </div>
</template>
