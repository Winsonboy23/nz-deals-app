<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useSiteSettings } from '../composables/useSiteSettings'
import { t } from '../composables/useI18n'

const router = useRouter()
const { signIn, isIn } = useAuth()
/** Facebook 鈕：後台 settings.facebook_login = 'on' 才出現（Supabase 的 Facebook provider 設好之前按了會失敗） */
const { facebookLogin } = useSiteSettings()
const logo = import.meta.env.BASE_URL + 'brand/kitewise-logo-a.svg'
if (isIn.value) void router.replace('/me')

/** 按了之後那顆轉圈到 Google／Facebook 頁面出現為止；失敗才會回來把圈圈收掉。 */
const busy = ref<'google' | 'facebook' | null>(null)
async function go(provider: 'google' | 'facebook') {
  if (busy.value) return
  busy.value = provider
  try {
    await signIn(provider)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <!-- E1 · Sign in（Google；Facebook 看後台開關） -->
  <div class="screen" style="padding-bottom: 40px">
    <div class="pad" style="margin-top: 6px">
      <RouterLink class="back" to="/me">‹ {{ t('me.title') }}</RouterLink>
      <img :src="logo" alt="KiteWise" style="display: block; width: 100%; height: auto; margin-top: 12px" />
      <div class="h1" style="margin-top: 18px">{{ facebookLogin ? t('common.signIn') : t('auth.title') }}</div>
      <div class="sub" style="margin-top: 8px; font-size: 15px; line-height: 1.5">{{ t('auth.guestNote') }}</div>
    </div>
    <div class="pad" style="margin-top: 22px">
      <div class="box">
        <div v-for="k in ['auth.why1', 'auth.why2', 'auth.why3']" :key="k" class="lrow" style="padding: 13px 12px">
          <span style="font-size: 18px; flex: none; color: var(--brand)">✓</span>
          <div class="t" style="font-size: 15px">{{ t(k) }}</div>
        </div>
      </div>
    </div>
    <div class="pad" style="margin-top: 22px">
      <button class="btn" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 12px" :disabled="!!busy" @click="go('google')">
        <svg v-if="busy === 'google'" class="spin" width="20" height="20" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="19" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="86 120" /></svg>
        <svg v-else width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.6 2.3 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.3 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-3.8-13.5-9.3l-7.9 6C6.6 42.6 14.6 48 24 48z"/></svg>
        {{ t('auth.google') }}
      </button>
      <button v-if="facebookLogin" class="btn" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 12px; background: #1877F2; color: #fff" :disabled="!!busy" @click="go('facebook')">
        <svg v-if="busy === 'facebook'" class="spin" width="20" height="20" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="19" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="86 120" /></svg>
        <svg v-else width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>
        {{ t('auth.facebook') }}
      </button>
    </div>
    <div class="pad" style="margin-top: 20px; text-align: center">
      <RouterLink class="link" to="/privacy" style="font-size: 13px; text-decoration: underline">{{ t('legal.privacy') }}</RouterLink>
    </div>
  </div>
</template>
