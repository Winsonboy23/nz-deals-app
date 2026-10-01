<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStores } from '../composables/useStores'
import { useSettings } from '../composables/useSettings'
import { useAuth } from '../composables/useAuth'
import { useSync } from '../composables/useSync'
import { usePush } from '../composables/usePush'
import { useAdmin } from '../composables/useAdmin'
import { cardCls, cardTitle, useCards } from '../composables/useCards'
import CardBarcode from '../components/CardBarcode.vue'
import { lang, setLang, t } from '../composables/useI18n'
import { chainName } from '../lib/format'
import { AccountError, deleteAccount } from '../lib/account'

const { selectedStores } = useStores()
const { foodOnly } = useSettings()
const { user, isIn, name, avatar, signOut } = useAuth()
/** 用哪個帳號登入的（Supabase 的 app_metadata.provider：google / facebook） */
const providerName = computed(() => (user.value?.app_metadata?.provider === 'facebook' ? 'Facebook' : 'Google'))
const { watched, merged } = useSync()
const { isAdmin } = useAdmin()
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

/** 會員卡（2026-10-01 改版，照設計稿疊成一疊）：前 3 張，第一張在最上面，後面兩張往左右斜出來露出顏色；點了去 /me/cards */
const { cards, loading: cardsLoading } = useCards()
const pile = computed(() => cards.value.slice(0, 3))

function toggleFood() {
  foodOnly.value = !foodOnly.value
}

// 刪除帳號：點「刪除帳號」展開確認，再按「我確定要刪除」才真的刪。成功會整頁重載，不會回到這裡。
const confirming = ref(false)
const deleting = ref(false)
const deleteError = ref('')
async function doDelete() {
  if (deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await deleteAccount()
  } catch (e) {
    deleteError.value = e instanceof AccountError && e.code === 'signIn' ? t('me.deleteSignIn') : t('me.deleteFailed', { e: e instanceof Error ? e.message : String(e) })
    deleting.value = false
  }
}
</script>

<template>
  <div class="screen">
    <!-- E1 · Merged：剛登入、訪客資料合併進帳號 -->
    <div v-if="merged" class="pad" style="margin-top: 12px">
      <div class="note" style="display: flex; gap: 10px; align-items: center">
        <span style="font-size: 18px">✓</span>
        <span style="font-size: 13px; font-weight: 600">{{ t('auth.merged') }}</span>
        <button class="link" style="margin-left: auto" @click="merged = false">×</button>
      </div>
    </div>

    <!-- E3 · 登入後：頭像＋名字（設計稿）／E4 · 訪客：綠底卡 -->
    <div v-if="isIn" class="pad me-top">
      <span class="me-av">
        <img v-if="avatar" :src="avatar" alt="" referrerpolicy="no-referrer" />
        <template v-else>{{ name.slice(0, 1).toUpperCase() }}</template>
      </span>
      <div style="flex: 1; min-width: 0">
        <div class="me-name ell">{{ name }}</div>
        <div class="me-via">{{ t('auth.signedInAs', { p: providerName }) }}</div>
      </div>
      <button class="me-out" @click="signOut()">{{ t('auth.signOut') }}</button>
    </div>
    <div v-else class="pad" style="margin-top: 16px">
      <div class="guest">
        <div class="h2">{{ t('me.guest') }}</div>
        <div class="guest-body">{{ t('me.guestBody') }}</div>
        <RouterLink class="btn" to="/signin">{{ t('auth.google') }}</RouterLink>
      </div>
    </div>

    <!-- 會員卡：登入才有。有卡＝前 3 張疊成一疊；沒卡＝虛線框 -->
    <template v-if="isIn">
      <div class="pad hrow" style="margin-top: 22px">
        <div class="h2">{{ t('me.cards') }}</div>
        <RouterLink v-if="cards.length" class="link" to="/me/cards">{{ t('cards.count', { n: cards.length }) }}</RouterLink>
      </div>
      <RouterLink v-if="pile.length" class="pile" :class="'n' + pile.length" to="/me/cards" :aria-label="t('me.cards')">
        <div v-for="(c, i) in pile" :key="c.id" class="pc" :class="[cardCls(c), 'pc' + i]">
          <div class="pc-top">
            <div class="pc-name">{{ cardTitle(c) }}</div>
            <!-- Club+ 卡面：右上紅黃兩點（紅超黃超都能用） -->
            <span v-if="c.chain === 'clubplus'" class="pc-dots" aria-hidden="true"><i class="nw" /><i class="pns" /></span>
          </div>
          <div class="pc-panel">
            <CardBarcode class="pc-bar" :code="c.code" :format="c.format" />
            <div class="pc-num ell">{{ c.code }}</div>
          </div>
          <div class="pc-foot">{{ t('me.cards') }}</div>
        </div>
      </RouterLink>
      <div v-else-if="cardsLoading" class="pad" style="margin-top: 10px"><div class="skel" style="height: 96px; border-radius: var(--r)" /></div>
      <div v-else class="pad" style="margin-top: 10px">
        <RouterLink class="addfirst" to="/me/cards">{{ t('cards.addFirst') }}</RouterLink>
      </div>
    </template>

    <div class="pad" style="margin-top: 22px">
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
        <!-- 後台：只有 admins 表裡的 email 看得到（docs/admin-spec.md §1） -->
        <RouterLink v-if="isAdmin" class="lrow tap" to="/admin" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">後台</div></div>
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

    <div class="pad" style="margin-top: 16px">
      <div class="box">
        <RouterLink class="lrow tap" to="/about" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('me.about') }}</div></div>
          <div class="link">›</div>
        </RouterLink>
        <RouterLink class="lrow tap" to="/privacy" style="padding: 14px 12px">
          <div class="grow"><div class="t" style="font-size: 16px">{{ t('legal.privacy') }}</div></div>
          <div class="link">›</div>
        </RouterLink>
        <!-- 刪除帳號（登入才有） -->
        <button v-if="isIn" class="lrow tap" style="padding: 14px 12px" :disabled="deleting" @click="confirming = !confirming">
          <div class="grow"><div class="t" style="font-size: 16px; color: #b00020">{{ t('me.deleteAccount') }}</div></div>
        </button>
        <div v-if="isIn && confirming" style="border-top: 1px solid var(--line); padding: 14px 12px">
          <div style="font-size: 14px; line-height: 1.5">{{ t('me.deleteBody') }}</div>
          <button class="btn" style="margin-top: 12px; height: 48px; font-size: 16px" :style="{ background: deleting ? 'var(--ink-3)' : '#b00020' }" :disabled="deleting" @click="doDelete">
            {{ deleting ? t('me.deleting') : t('me.deleteConfirm') }}
          </button>
          <div v-if="deleteError" style="margin-top: 8px; font-size: 13px; line-height: 1.4; color: #b00020">{{ deleteError }}</div>
          <button v-if="!deleting" class="link" style="display: block; margin: 12px auto 0" @click="confirming = false">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>

    <div class="pad sub muted" style="margin-top: 16px; font-size: 13px">{{ t('me.footnote') }}</div>
  </div>
</template>

<style scoped>
/* 頭像＋名字 */
.me-top { display: flex; align-items: center; gap: 14px; margin-top: 18px; }
.me-av {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  flex: none;
  overflow: hidden;
  border: 2px solid var(--card);
  box-shadow: var(--shadow);
  background: var(--brand-tint);
  color: var(--brand-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-head);
  font-weight: 700;
  font-size: 24px;
}
.me-av img { width: 100%; height: 100%; object-fit: cover; }
.me-name { font-family: var(--font-head); font-weight: 700; font-size: 22px; line-height: 1.2; letter-spacing: -0.2px; }
.me-via { margin-top: 2px; font-size: 13px; color: var(--ink-3); }
.me-out { flex: none; height: 32px; padding: 0 13px; border-radius: 16px; border: 1.5px solid var(--brand); color: var(--brand-deep); background: var(--card); font-size: 13px; font-weight: 700; }

/* 訪客：中間綠底白字卡，按鈕白底深綠字 */
.guest { background: var(--brand); color: #fff; border-radius: 18px; padding: 18px; box-shadow: var(--shadow); }
.guest-body { margin-top: 8px; font-size: 14px; line-height: 1.5; color: rgba(255, 255, 255, 0.9); }
.guest .btn { margin-top: 16px; height: 52px; background: var(--card); color: var(--brand-deep); }

/* 會員卡疊：第一張正放在最上面，第二、三張往左右斜出去露出邊和顏色 */
.pile { position: relative; display: block; height: 268px; margin: 12px var(--gutter) 0; }
.pc {
  position: absolute;
  left: 50%;
  top: 8px;
  width: 210px;
  height: 248px;
  margin-left: -105px;
  border-radius: 18px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
  box-shadow: 0 10px 22px -12px rgba(16, 30, 20, 0.55);
}
/* 右下角一塊淡淡的圓弧（設計稿卡面上的裝飾） */
.pc::after { content: ''; position: absolute; right: -46px; bottom: -46px; width: 120px; height: 120px; border-radius: 50%; border: 22px solid rgba(255, 255, 255, 0.16); }
/* Club+ 深色卡面（跟會員卡頁一樣）、Everyday Rewards 綠超色、其他深灰 */
.pc.cp { background: linear-gradient(145deg, #2b3b31 0%, #18221b 55%, #101712 100%); }
.pc.ww { background: var(--ww); }
.pc.other { background: #3a3a3a; }
.pc0 { z-index: 3; }
.pc1 { z-index: 2; transform: translateX(-38px) rotate(-8deg); }
.pc2 { z-index: 1; transform: translateX(38px) rotate(8deg); }
/* 只有兩張：後面那張往右斜 */
.n2 .pc1 { transform: translateX(34px) rotate(7deg); }
.pc-top { display: flex; align-items: center; gap: 8px; }
/* 名字最多兩行（「Everyday Rewards」一行放不下） */
.pc-name { flex: 1; min-width: 0; font-family: var(--font-head); font-weight: 700; font-size: 21px; line-height: 1.2; padding: 0 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.pc-dots { flex: none; display: inline-flex; gap: 4px; }
.pc-dots i { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.9); }
.pc-dots .nw { background: var(--nw); }
.pc-dots .pns { background: var(--pns); }
.pc-panel { position: relative; z-index: 1; margin-top: auto; background: #fff; color: var(--ink); border-radius: 12px; padding: 12px 6px 8px; }
.pc-bar { height: 62px; }
.pc-num { margin-top: 6px; text-align: center; font-family: 'Inter Tight', Inter, sans-serif; font-weight: 800; font-size: 14px; letter-spacing: 0.5px; font-variant-numeric: tabular-nums; }
.pc-foot { position: relative; z-index: 1; margin-top: 10px; font-size: 12px; font-weight: 700; opacity: 0.85; }

/* 沒卡：一張虛線框 */
.addfirst {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96px;
  border: 1.5px dashed #AEB8AB;
  border-radius: var(--r);
  font-family: var(--font-head);
  font-weight: 600;
  font-size: 16px;
  color: var(--brand-deep);
}
</style>
