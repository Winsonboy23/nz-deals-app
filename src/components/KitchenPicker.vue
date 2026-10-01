<script setup lang="ts">
// AI 食譜問卷第 2 頁「你家有哪些廚具」（KiteWise 3-7）：Chris 定稿的可愛風廚房插圖（public/kitchen/，原圖 2816×1536 縮成 1200／800 寬），
// 9 樣廚具在圖上各疊一個透明按鈕（熱區）。點一下切換有／沒有：有＝品牌深綠圓角框＋淡綠光暈＋右上角綠圓勾；沒有＝蓋一層半透明白，變淡。
// 圖是點陣圖，改不了東西本身的顏色，所以都用疊的。點到的那一樣跳出名字 1.5 秒（手機上圖很小，看不出是什麼）。
// 熱區外的背景（盆栽、刀架、櫥櫃、插座、磁磚…）點了沒反應；熱區是矩形，難免包到一點背景（例如調味罐在爐台框裡）。
import { onBeforeUnmount, ref } from 'vue'
import { t } from '../composables/useI18n'

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const BASE = import.meta.env.BASE_URL
/**
 * 熱區：left / top / width / height 都是圖寬、圖高的百分比，任何寬度都對得準（在 2000 寬縮圖上量、疊圖截圖逐一校正，彼此不重疊）。
 * 陣列順序＝Tab 順序（大致左到右）。果汁機、烤麵包機夾在隔壁廚具中間，手機 393 寬時約 28×34 px，已經放到不壓到隔壁。
 * 果汁機只框露出來的上半截，下半截和底座被大湯鍋擋住，算在爐台裡。
 * tip：名字標籤預設在熱區上方置中；end＝靠熱區右緣（靠右的兩樣，才不會被切掉）；in＝放熱區內側上方（烤箱貼著圖的上緣）。
 */
interface Spot { key: string; x: number; y: number; w: number; h: number; tip?: 'end' | 'in end' }
const SPOTS: Spot[] = [
  { key: 'bbq', x: 6.65, y: 31.71, w: 13.9, h: 20.9 },
  { key: 'air-fryer', x: 6.7, y: 52.89, w: 14.35, h: 27.31 },
  { key: 'rice-cooker', x: 21.2, y: 54.81, w: 11.25, h: 21.17 },
  { key: 'slow-cooker', x: 32.6, y: 50.6, w: 9.75, h: 18.79 },
  { key: 'toaster', x: 42.5, y: 51.88, w: 7.4, h: 17.97 },
  { key: 'stovetop', x: 50.05, y: 56.1, w: 24.15, h: 19.89 },
  { key: 'blender', x: 67.5, y: 39.6, w: 7.55, h: 16.22 },
  { key: 'oven', x: 75.25, y: 10.36, w: 22.9, h: 30.25, tip: 'in end' },
  { key: 'microwave', x: 75.15, y: 46.29, w: 22.9, h: 34.65, tip: 'end' },
]
const tip = ref<Spot | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(timer))

function toggle(s: Spot) {
  const cur = props.modelValue
  emit('update:modelValue', cur.includes(s.key) ? cur.filter((k) => k !== s.key) : [...cur, s.key])
  tip.value = s
  clearTimeout(timer)
  timer = setTimeout(() => (tip.value = null), 1500)
}
/** 名字標籤的錨點：熱區上緣，置中或靠右緣（往上／往內推交給 CSS） */
function tipAt(s: Spot) {
  return { left: (s.tip ? s.x + s.w : s.x + s.w / 2) + '%', top: s.y + '%' }
}
</script>

<template>
  <div class="kp" role="group" :aria-label="t('ai.kitTitle')">
    <!-- 圖寬＝App 最寬 480 減左右 11px 邊距；手機 2 倍螢幕拿 800、3 倍拿 1200 -->
    <img
      class="pic"
      :src="BASE + 'kitchen/kitchen-1200.jpg'"
      :srcset="`${BASE}kitchen/kitchen-800.jpg 800w, ${BASE}kitchen/kitchen-1200.jpg 1200w`"
      sizes="(max-width: 480px) calc(100vw - 22px), 458px"
      :alt="t('ai.kitImgAlt')"
      loading="eager"
      decoding="async"
      draggable="false"
    />
    <button
      v-for="s in SPOTS"
      :key="s.key"
      type="button"
      class="hs"
      :class="{ on: modelValue.includes(s.key) }"
      :style="{ left: s.x + '%', top: s.y + '%', width: s.w + '%', height: s.h + '%' }"
      :aria-pressed="modelValue.includes(s.key)"
      :aria-label="t('recipes.appliance.' + s.key)"
      @click="toggle(s)"
    />
    <Transition name="fade">
      <span v-if="tip" :key="tip.key" class="tip" :class="[tip.tip, { off: !modelValue.includes(tip.key) }]" :style="tipAt(tip)" aria-hidden="true">{{ t('recipes.appliance.' + tip.key) }}</span>
    </Transition>
  </div>
</template>

<style scoped>
/* 深綠＝家裡有（App 目前只有淺色模式）。isolation：勾勾和名字標籤的 z-index 只在圖裡面比，不會蓋到頁面上其他東西 */
.kp {
  --pick: var(--brand);
  position: relative;
  isolation: isolate;
  aspect-ratio: 2816 / 1536;
  border-radius: 14px;
  overflow: hidden;
  background: #f2e4da;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}
.pic { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
/* 熱區：沒有＝白霧蓋著變淡、沒框；有＝透明、品牌深綠框＋淡綠光暈（2026-10-01 跟著首頁改版的色票） */
.hs {
  position: absolute;
  border: 2.5px solid transparent;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.62);
  overflow: visible;
  transition: background-color 0.2s var(--ease), border-color 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.hs.on { background: transparent; border-color: var(--pick); box-shadow: 0 0 0 3px rgba(90, 133, 98, 0.45); }
/* 右上角小綠圓勾：疊在框角上、蓋過隔壁的框和白霧；不吃點擊（點擊範圍只有熱區本身） */
.hs::after {
  content: '';
  position: absolute;
  z-index: 2;
  top: -6px;
  right: -6px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--pick) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4.6 8.4l2.2 2.2 4.6-4.8' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 100% no-repeat;
  opacity: 0;
  transform: scale(0.6);
  transition: opacity 0.2s var(--ease), transform 0.2s var(--ease);
  pointer-events: none;
}
.hs.on::after { opacity: 1; transform: none; }
.hs:focus-visible { outline: 2px dashed var(--pick); outline-offset: 2px; }
/* 點到的那一樣：名字標籤 1.5 秒。選了是深綠底白字；取消了是白底灰字、劃線 */
.tip {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, calc(-100% - 6px));
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--pick);
  color: var(--paper);
  font-size: 12.5px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(17, 17, 17, 0.18);
}
.tip.end { transform: translate(-100%, calc(-100% - 6px)); }
.tip.in.end { transform: translate(calc(-100% - 8px), 8px); }
.tip.off { background: var(--paper); color: var(--ink-3); text-decoration: line-through; box-shadow: 0 0 0 1.5px var(--line), 0 2px 8px rgba(17, 17, 17, 0.12); }
@media (prefers-reduced-motion: reduce) {
  .hs, .hs::after, .tip { transition: none; }
}
</style>
