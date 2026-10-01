<script setup lang="ts">
// 綠色頂欄（2026-10-01 改版，照 Chris 設計稿）：上面一小行是「我的店」（點了去選店），下面是白色搜尋框（點了去 /search）、
// 清單（右上角數字＝清單幾項）、頭像（登入是大頭貼或名字第一個字，沒登入是「登入」，都去 /me）。
// 首頁、食譜、分類三頁用，頁面外層要加 class="screen has-header"（頂欄自己貼到最上面、自己留瀏海的安全區）；其他子頁維持原本的返回列。
import { computed } from 'vue'
import StorePill from './StorePill.vue'
import { useAuth } from '../composables/useAuth'
import { useList } from '../composables/useList'
import { t } from '../composables/useI18n'

const { isIn, name, avatar } = useAuth()
const { items } = useList()
/** 頭像下面那行：名字的第一個詞（Chris Demo → Chris；沒名字只有 email 就用 @ 前面） */
const first = computed(() => name.value.split('@')[0].trim().split(/\s+/)[0] ?? '')
</script>

<template>
  <header class="hd">
    <StorePill class="hd-store" />
    <div class="hd-row">
      <RouterLink class="hd-search" to="/search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span class="ell">{{ t('search.placeholder') }}</span>
      </RouterLink>
      <RouterLink class="hd-icon" to="/list" :aria-label="t('tab.list')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 3.5h2.6l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2l1.6-7.3H6.2" /><circle cx="9.5" cy="20" r="1.4" /><circle cx="17.5" cy="20" r="1.4" /></svg>
        <span v-if="items.length" class="hd-badge">{{ items.length > 99 ? '99+' : items.length }}</span>
      </RouterLink>
      <RouterLink class="hd-me" to="/me">
        <span class="hd-av">
          <img v-if="isIn && avatar" :src="avatar" alt="" referrerpolicy="no-referrer" />
          <template v-else-if="isIn">{{ first.slice(0, 1).toUpperCase() }}</template>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
        </span>
        <span class="hd-name ell">{{ isIn ? first : t('common.signIn') }}</span>
      </RouterLink>
    </div>
  </header>
</template>

<style scoped>
.hd {
  background: var(--brand);
  color: #fff;
  padding: max(10px, env(safe-area-inset-top)) var(--gutter) 14px;
  border-radius: 0 0 22px 22px;
}
/* 我的店：白字、沒有框；店色圓點加白圈，紅綠兩點壓在綠底上才看得到 */
.hd-store {
  height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: rgba(255, 255, 255, 0.94);
  font-size: 13px;
  font-weight: 600;
  gap: 5px;
}
.hd-store :deep(.dot) { box-shadow: 0 0 0 1.5px #fff; }
.hd-store :deep(.dots) { gap: 5px; }
.hd-row { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.hd-search {
  flex: 1;
  min-width: 0;
  height: 42px;
  border-radius: 21px;
  background: var(--card);
  color: var(--ink-3);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  font-size: 15px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.hd-search svg { width: 19px; height: 19px; flex: none; fill: none; stroke: var(--ink-3); stroke-width: 2.2; stroke-linecap: round; }
.hd-icon { position: relative; width: 40px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center; }
.hd-icon svg { width: 27px; height: 27px; fill: none; stroke: #fff; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
/* 清單幾項：風箏橘小圓點、深綠字（橘底白字太淡） */
.hd-badge {
  position: absolute;
  top: 1px;
  right: -2px;
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  border-radius: 10px;
  background: var(--kite);
  color: var(--brand-deep);
  box-shadow: 0 0 0 2px var(--brand);
  font-size: 11px;
  font-weight: 800;
  line-height: 19px;
  text-align: center;
}
.hd-me { width: 50px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.hd-av {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid #fff;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-head);
  font-weight: 700;
  font-size: 15px;
}
.hd-av img { width: 100%; height: 100%; object-fit: cover; }
.hd-av svg { width: 20px; height: 20px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; }
.hd-name { max-width: 100%; font-size: 11px; font-weight: 600; line-height: 1.2; }
</style>
