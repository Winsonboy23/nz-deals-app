<script setup lang="ts">
// Originkit「Moving Gradient Button」的 Vue 版（使用者 2026-09-10 指定給 AI 食譜用）。
// 照元件預設：黑底白字、6px 白色邊帶、全圓角、邊帶裡兩道藍→綠的光順時針轉（約 11 秒一圈）。
// 字級改成 App 的 17px（原本 40px / 40px 64px 內距是桌機用的）。
defineProps<{ to?: string; disabled?: boolean }>()
</script>

<template>
  <component :is="to ? 'RouterLink' : 'button'" class="gbtn" :class="{ dim: disabled }" :to="to" :disabled="disabled">
    <span class="band" aria-hidden="true"><span class="glow" /></span>
    <span class="inner"><slot /></span>
  </component>
</template>

<style scoped>
.gbtn {
  position: relative;
  display: flex;
  width: 100%;
  height: 62px;
  padding: 6px;
  box-sizing: border-box;
  border-radius: 999px;
  background: #fff;
  color: #fff;
  text-decoration: none;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.gbtn.dim { opacity: 0.45; }
.gbtn:active .inner { background: #1a1a1a; }
.band { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; }
.glow {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 200%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  background: repeating-conic-gradient(from 0deg, transparent 0deg, #3600ff 99deg, #00ff94 180deg);
  animation: gspin 11.4s linear infinite;
}
.inner {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border-radius: 999px;
  background: #000;
  font-family: 'Inter Tight', Inter, sans-serif;
  font-weight: 800;
  font-size: 17px;
  white-space: nowrap;
}
@keyframes gspin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
</style>
