<script setup lang="ts">
import { computed } from 'vue'
import { useStores } from '../composables/useStores'
import { useSettings } from '../composables/useSettings'
import { lang, setLang, t } from '../composables/useI18n'
import { chainName } from '../lib/format'

const { selectedStores } = useStores()
const { foodOnly } = useSettings()

const town = computed(() => {
  const first = selectedStores.value[0]
  if (!first) return ''
  return first.name.replace(chainName(first.id), '').replace(/\s+/g, ' ').trim() || first.name
})

function toggleFood() {
  foodOnly.value = !foodOnly.value
}
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 14px"><div class="h1">{{ t('me.title') }}</div></div>

    <div class="pad" style="margin-top: 14px">
      <div style="background: #111; border-radius: 18px; padding: 18px">
        <div class="h2" style="color: #fff">{{ t('me.guest') }}</div>
        <div style="margin-top: 8px; font-size: 14px; line-height: 1.45; color: #b9b9b9">
          {{ t('me.guestBody') }}
        </div>
        <button
          class="btn"
          style="margin-top: 16px; background: #fff; color: #111; height: 52px; width: 100%; opacity: 0.6"
          disabled
        >
          {{ t('common.signIn') }} · {{ t('me.soon') }}
        </button>
      </div>
    </div>

    <div class="pad" style="margin-top: 16px">
      <div class="box">
        <RouterLink class="lrow tap" to="/stores" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.myStores') }}</div></div>
          <div class="link">
            <template v-if="town">{{ town }} · </template>{{ selectedStores.length }} ›
          </div>
        </RouterLink>
        <div class="lrow" style="padding: 9px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.language') }}</div></div>
          <div class="seg" style="width: 150px; flex: none">
            <div :class="{ on: lang === 'en' }" @click="setLang('en')">EN</div>
            <div :class="{ on: lang === 'zh' }" @click="setLang('zh')">中文</div>
          </div>
        </div>
        <div class="lrow" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.foodOnly') }}</div></div>
          <button class="tg" :class="{ off: !foodOnly }" @click="toggleFood" />
        </div>
      </div>
    </div>

    <div class="pad sub muted" style="margin-top: 16px; font-size: 13px">{{ t('me.footnote') }}</div>
  </div>
</template>
