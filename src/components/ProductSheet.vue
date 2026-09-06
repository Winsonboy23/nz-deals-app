<script setup lang="ts">
import { computed, ref } from 'vue'
import ProductThumb from './ProductThumb.vue'
import TagChip from './TagChip.vue'
import { dealPrice, tagsFor } from '../lib/compare'
import {
  catParts,
  chainClass,
  chainOf,
  displayName,
  money,
  priceSuffix,
  unitLabel,
  wasPriceOf,
} from '../lib/format'
import { useSpecials } from '../composables/useSpecials'
import { useCategories } from '../composables/useCategories'
import { useList } from '../composables/useList'
import { catName, chainBadge, t } from '../composables/useI18n'

const props = defineProps<{ pkey: string }>()
const emit = defineEmits<{ close: [] }>()

const { groupFor } = useSpecials()
const { nameOf } = useCategories()
const { add, has } = useList()

const group = computed(() => groupFor(props.pkey))
const best = computed(() => group.value?.best)
const rest = computed(() => group.value?.offers.slice(1) ?? [])
const crumb = computed(() => {
  const id = best.value?.special.category_id
  if (!id) return ''
  const parts = catParts(id)
  return parts
    .map((_, i) => catName(nameOf(parts.slice(0, i + 1).join('/'))))
    .filter(Boolean)
    .join(' › ')
})
const added = ref(false)
function addToList() {
  if (!best.value) return
  add(props.pkey, displayName(best.value.special))
  added.value = true
}
const inList = computed(() => added.value || has(props.pkey))

function detailLine(storeId: string, hasWas: number | null, unit: string | null): string {
  if (chainOf(storeId) === 'paknsave') return t('p.lowPrice')
  const bits: string[] = []
  if (hasWas) bits.push(`was ${money(hasWas)}`)
  if (unit) bits.push(unit)
  return bits.join(' · ')
}
</script>

<template>
  <div class="dim" @click="emit('close')" />
  <div class="bsheet">
    <div class="grab" />
    <template v-if="group && best">
      <div style="display: flex; gap: 14px; align-items: flex-start">
        <ProductThumb
          :special="best.special"
          variant="big"
          style="width: 104px; height: 104px; border-radius: 12px; flex: none"
        />
        <div style="flex: 1; min-width: 0">
          <div style="font-size: 12px; color: var(--ink-2)" class="ell">{{ crumb }}</div>
          <div class="h2" style="font-size: 25px; margin-top: 3px">
            {{ displayName(best.special) }}
          </div>
          <div v-if="unitLabel(best.special)" class="sub" style="margin-top: 3px; font-size: 13px">
            {{ unitLabel(best.special) }}
          </div>
          <div style="margin-top: 7px">
            <span v-if="group.offers.length >= 2" class="tag same">
              {{ t('cmp.same', { n: group.offers.length }) }}
            </span>
            <span v-else class="tag only">{{ t('cmp.only') }}</span>
          </div>
        </div>
      </div>

      <div class="hrow" style="margin-top: 18px; align-items: flex-end">
        <div class="grow">
          <div style="display: flex; align-items: center; gap: 7px">
            <span class="dot" :class="chainClass(best.store.id)" />
            <span class="sec ell">{{ t('cmp.cheapest', { s: best.store.name }) }}</span>
          </div>
          <div class="sub" style="margin-top: 4px; font-size: 13px">
            {{ detailLine(best.store.id, wasPriceOf(best.special), unitLabel(best.special)) }}
          </div>
          <div v-if="group.payGap" class="gap" style="margin-top: 3px">
            {{ t('cmp.gap', { v: money(group.payGap) }) }}
            <span v-if="group.unitDecided" class="muted"> · {{ t('cmp.byUnit') }}</span>
          </div>
        </div>
        <div class="price" style="font-size: 36px; margin-top: 0; flex: none">
          {{ money(dealPrice(best.special)) }}
          <span v-if="priceSuffix(best.special)" class="unit" style="font-size: 14px">
            {{ priceSuffix(best.special) }}
          </span>
        </div>
      </div>

      <div style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap">
        <TagChip v-for="(tg, i) in tagsFor(best.special)" :key="i" :tag="tg" />
      </div>

      <div v-if="rest.length" class="box" style="margin-top: 14px">
        <div v-for="o in rest" :key="o.store.id" class="lrow" style="padding: 12px">
          <div class="bar" :class="chainClass(o.store.id)" style="height: 36px; align-self: center" />
          <div class="grow">
            <div class="t ell" style="font-size: 16px">{{ o.store.name }}</div>
            <div class="s ell">
              <template v-if="o.special.club_only">{{ t('p.clubNeeded') }}</template>
              <template v-else>
                {{ detailLine(o.store.id, wasPriceOf(o.special), unitLabel(o.special)) }}
              </template>
            </div>
          </div>
          <div class="p" style="font-size: 21px">{{ money(dealPrice(o.special)) }}</div>
        </div>
      </div>

      <div style="display: flex; gap: 10px; margin-top: 14px">
        <button class="btn" style="flex: 1" :disabled="inList" @click="addToList">
          {{ inList ? t('p.added') : t('p.addToList') }}
        </button>
        <button class="btn ghost" style="width: 126px; font-size: 16px; opacity: 0.45" disabled>
          {{ t('p.follow') }}
        </button>
      </div>
      <div class="sub muted" style="margin-top: 8px; font-size: 12px; text-align: center">
        {{ t('p.followNote') }}
      </div>

      <div class="sec" style="margin-top: 18px">{{ t('p.listedAs') }}</div>
      <div style="margin-top: 8px; font-size: 13px; line-height: 1.9; color: var(--ink-2)">
        <div v-for="o in group.offers" :key="o.store.id" class="ell">
          <span class="dot" :class="chainClass(o.store.id)" style="display: inline-block; margin-right: 6px" />
          <b style="color: var(--ink)">{{ chainBadge(o.store.id) }}</b>
          {{ o.special.name }}
          <a
            v-if="o.special.product_url"
            :href="o.special.product_url"
            target="_blank"
            rel="noopener"
            style="text-decoration: underline"
            >{{ t('p.open') }}</a
          >
        </div>
      </div>
      <div class="sec" style="margin-top: 16px">{{ t('recipes.title') }}</div>
      <div class="sub muted" style="margin-top: 6px; font-size: 12.5px">{{ t('recipes.soon') }}</div>
    </template>
    <template v-else>
      <div class="empty" style="margin-top: 10px">
        <div class="h3">{{ t('p.notFound') }}</div>
      </div>
      <button class="btn" style="margin-top: 14px" @click="emit('close')">
        {{ t('common.done') }}
      </button>
    </template>
  </div>
</template>
