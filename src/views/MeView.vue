<script setup lang="ts">
import { computed } from 'vue'
import { useStores } from '../composables/useStores'
import { useSettings } from '../composables/useSettings'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'
import { usePush } from '../composables/usePush'
import { lang, setLang, t } from '../composables/useI18n'
import { chainName } from '../lib/format'

const { selectedStores } = useStores()
const { foodOnly } = useSettings()
const { isIn, name, avatar, signOut } = useAuth()
const { watched, merged } = useSync()
const push = usePush()
const pushLine = computed(() => {
  if (push.error.value) return t('me.notifyFailed', { e: push.error.value })
  const k: Record<string, string> = { on: 'me.notifyOn', off: 'me.notifyHint', busy: 'me.notifyBusy', denied: 'me.notifyDenied', unsupported: 'me.notifyUnsupported', 'ios-not-installed': 'me.notifyIos' }
  return t(k[push.state.value] ?? 'me.notifyHint')
})
const pushToggle = computed(() => ['on', 'off', 'busy'].includes(push.state.value))

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

    <!-- E1 · Merged：剛登入、訪客資料合併進帳號 -->
    <div v-if="merged" class="pad" style="margin-top: 12px">
      <div class="note" style="display: flex; gap: 10px; align-items: center">
        <span style="font-size: 18px">✓</span>
        <span style="font-size: 13px; font-weight: 600">{{ t('auth.merged') }}</span>
        <button class="link" style="margin-left: auto" @click="merged = false">×</button>
      </div>
    </div>

    <!-- E3 · 登入後 / E4 · 訪客 -->
    <div class="pad" style="margin-top: 14px">
      <div v-if="isIn" style="background: #111; border-radius: 18px; padding: 18px; display: flex; gap: 14px; align-items: center">
        <img v-if="avatar" :src="avatar" alt="" style="width: 52px; height: 52px; border-radius: 50%; flex: none" referrerpolicy="no-referrer" />
        <div v-else style="width: 52px; height: 52px; border-radius: 50%; background: #333; flex: none" />
        <div style="flex: 1; min-width: 0">
          <div class="h2 ell" style="color: #fff; font-size: 20px">{{ name }}</div>
          <div style="margin-top: 3px; font-size: 13px; color: #b9b9b9">{{ t('auth.signedInAs') }}</div>
        </div>
        <button class="link" style="color: #fff; flex: none" @click="signOut()">{{ t('auth.signOut') }}</button>
      </div>
      <div v-else style="background: #111; border-radius: 18px; padding: 18px">
        <div class="h2" style="color: #fff">{{ t('me.guest') }}</div>
        <div style="margin-top: 8px; font-size: 14px; line-height: 1.45; color: #b9b9b9">{{ t('me.guestBody') }}</div>
        <RouterLink class="btn" to="/signin" style="margin-top: 16px; background: #fff; color: #111; height: 52px; width: 100%; display: flex; align-items: center; justify-content: center">
          {{ t('auth.google') }}
        </RouterLink>
      </div>
    </div>

    <div class="pad" style="margin-top: 16px">
      <div class="box">
        <RouterLink class="lrow tap" to="/stores" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.myStores') }}</div></div>
          <div class="link"><template v-if="town">{{ town }} · </template>{{ selectedStores.length }} ›</div>
        </RouterLink>
        <RouterLink v-if="isIn" class="lrow tap" to="/watching" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.watching') }}</div></div>
          <div class="link">{{ watched.size }} ›</div>
        </RouterLink>
        <RouterLink v-if="isIn" class="lrow tap" to="/me/recipes" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.recipes') }}</div></div>
          <div class="link">›</div>
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

    <!-- 推播（登入才有）。iPhone 要加入主畫面才開得了 -->
    <div v-if="isIn" class="pad" style="margin-top: 16px">
      <div class="box">
        <div class="lrow" style="padding: 14px 12px">
          <div class="grow" style="min-width: 0">
            <div class="t" style="font-size: 16px">{{ t('me.notify') }}</div>
            <div class="s" style="white-space: normal">{{ pushLine }}</div>
          </div>
          <button v-if="pushToggle" class="tg" :class="{ off: push.state.value !== 'on' }" :disabled="push.state.value === 'busy'" style="flex: none" @click="push.state.value === 'on' ? push.disable() : push.enable()" />
        </div>
      </div>
    </div>

    <div class="pad sub muted" style="margin-top: 16px; font-size: 13px">{{ t('me.footnote') }}</div>
  </div>
</template>
