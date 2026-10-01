<script setup lang="ts">
// AI 食譜問卷第 2 頁「你家有哪些廚具」（KiteWise 3-7，Chris 的設計）：一張扁平風廚房插圖，9 樣廚具直接在圖上點。
// 點一下切換有／沒有：有的描邊變深綠、微微放大，沒有的變淡；點到的那一樣旁邊跳出名字 1.5 秒（手機上圖很小，看不出是什麼）。
// 抽油煙機、吊櫃、調味罐、插座、窗戶、刀架、檯面、下櫃都是背景，點了沒反應。座標都是 viewBox 393×300。
import { onBeforeUnmount, ref } from 'vue'
import { t } from '../composables/useI18n'

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

/**
 * 名字標籤貼在哪（viewBox 座標）：預設在廚具正上方置中。右邊兩樣靠右對齊（end），窄螢幕才不會被切掉；
 * 微波爐貼著天花板，放下面（below）；烤箱上面是爐台，蓋在烤箱門中間（mid）。
 */
const TIP: Record<string, { x: number; y: number; at?: 'end' | 'below end' | 'mid' }> = {
  microwave: { x: 384, y: 57, at: 'below end' },
  bbq: { x: 203, y: 94 },
  stovetop: { x: 56, y: 180 },
  blender: { x: 136, y: 143 },
  toaster: { x: 182, y: 167 },
  'rice-cooker': { x: 231, y: 166 },
  'slow-cooker': { x: 293, y: 165 },
  'air-fryer': { x: 374, y: 149, at: 'end' },
  oven: { x: 62, y: 262, at: 'mid' },
}
const tip = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(timer))

function toggle(key: string) {
  const cur = props.modelValue
  emit('update:modelValue', cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key])
  tip.value = key
  clearTimeout(timer)
  timer = setTimeout(() => (tip.value = null), 1500)
}
/** 每樣廚具外層 <g> 的屬性：整組可點、Tab 走得到、Enter／空白鍵也能切；螢幕報讀唸名字和有沒有選 */
function ap(key: string) {
  const on = props.modelValue.includes(key)
  return {
    class: ['ap', { on }],
    role: 'button',
    tabindex: 0,
    'data-key': key,
    'aria-pressed': on,
    'aria-label': t('recipes.appliance.' + key),
    onClick: () => toggle(key),
    onKeydown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      toggle(key)
    },
  }
}
</script>

<template>
  <div class="kp">
    <svg viewBox="0 0 393 300" role="group" :aria-label="t('ai.kitTitle')" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
      <!-- 背景（點了沒反應） -->
      <g aria-hidden="true">
        <rect class="f-wall" width="393" height="300" stroke="none" />
        <!-- 吊櫃：四扇門，右邊一格空著放微波爐 -->
        <rect class="f-wood" x="116" y="6" width="290" height="54" rx="4" />
        <rect class="f-wood" x="122" y="12" width="40" height="42" rx="3" />
        <rect class="f-wood" x="166" y="12" width="40" height="42" rx="3" />
        <rect class="f-wood" x="210" y="12" width="40" height="42" rx="3" />
        <rect class="f-wood" x="254" y="12" width="40" height="42" rx="3" />
        <rect class="f-top" x="298" y="12" width="102" height="42" rx="3" />
        <g class="f-line" stroke="none">
          <rect x="155" y="42" width="3" height="8" rx="1.5" />
          <rect x="170" y="42" width="3" height="8" rx="1.5" />
          <rect x="243" y="42" width="3" height="8" rx="1.5" />
          <rect x="258" y="42" width="3" height="8" rx="1.5" />
        </g>
        <!-- 抽油煙機 -->
        <rect class="f-steel" x="50" y="-4" width="28" height="40" rx="2" />
        <path class="f-steel" d="M44 34 H84 L104 68 H24 Z" />
        <rect class="f-steel" x="18" y="66" width="92" height="10" rx="3" />
        <!-- 爐台上方的調味罐架 -->
        <rect class="f-wood" x="28" y="138" width="72" height="6" rx="2" />
        <rect class="f-white" x="35" y="124" width="12" height="14" rx="3" />
        <rect class="f-acc" x="35" y="119" width="12" height="6" rx="2" />
        <rect class="f-white" x="51" y="120" width="12" height="18" rx="3" />
        <rect class="f-leaf" x="51" y="115" width="12" height="6" rx="2" />
        <rect class="f-white" x="67" y="126" width="12" height="12" rx="3" />
        <rect class="f-dark" x="67" y="121" width="12" height="6" rx="2" />
        <rect class="f-white" x="83" y="122" width="12" height="16" rx="3" />
        <rect class="f-acc" x="83" y="117" width="12" height="6" rx="2" />
        <!-- 插座 -->
        <rect class="f-white" x="122" y="118" width="22" height="14" rx="3" />
        <g class="f-line" stroke="none">
          <rect x="127" y="123" width="3" height="4" rx="1" />
          <rect x="136" y="123" width="3" height="4" rx="1" />
        </g>
        <!-- 窗戶：窗外是天空、樹叢和露台（BBQ 在露台上，是可以點的那樣） -->
        <rect class="f-white" x="150" y="64" width="106" height="94" rx="4" />
        <rect class="f-sky" x="157" y="71" width="92" height="80" rx="2" stroke="none" />
        <g class="f-white" stroke="none">
          <circle cx="177" cy="88" r="5" />
          <circle cx="185" cy="85" r="7" />
          <rect x="171" y="87" width="24" height="7" rx="3.5" />
        </g>
        <g class="f-leaf" stroke="none">
          <circle cx="167" cy="125" r="9" />
          <circle cx="182" cy="119" r="11" />
          <circle cx="226" cy="120" r="11" />
          <circle cx="240" cy="125" r="9" />
          <rect x="157" y="121" width="92" height="15" />
        </g>
        <rect class="f-deck" x="157" y="134" width="92" height="17" stroke="none" />
        <path class="f-none" d="M157 134 H249 M157 142.5 H249" />
        <rect class="f-none" x="157" y="71" width="92" height="80" rx="2" />
        <rect class="f-white" x="144" y="156" width="118" height="7" rx="2" />
        <!-- 刀架（牆上的磁條） -->
        <rect class="f-dark" x="304" y="92" width="70" height="6" rx="3" />
        <path class="f-steel" d="M311 93 H319 V114 L311 126 Z" />
        <rect class="f-dark" x="312" y="80" width="6" height="14" rx="2.5" />
        <path class="f-steel" d="M327 93 H333 V107 L327 115 Z" />
        <rect class="f-dark" x="327.5" y="82" width="5" height="12" rx="2" />
        <rect class="f-steel" x="341" y="93" width="14" height="24" rx="2" />
        <rect class="f-dark" x="345" y="80" width="6" height="14" rx="2.5" />
        <path class="f-steel" d="M362 93 H368 V122 L362 130 Z" />
        <rect class="f-dark" x="362" y="80" width="6" height="14" rx="2.5" />
        <!-- 檯面、下櫃、地板 -->
        <rect class="f-top" x="-2" y="204" width="404" height="10" rx="2" />
        <rect class="f-wood" x="-2" y="214" width="404" height="78" />
        <rect class="f-wood" x="119" y="219" width="48" height="67" rx="3" />
        <rect class="f-wood" x="171" y="219" width="48" height="67" rx="3" />
        <rect class="f-wood" x="223" y="219" width="48" height="67" rx="3" />
        <rect class="f-wood" x="275" y="219" width="48" height="67" rx="3" />
        <rect class="f-wood" x="327" y="219" width="48" height="67" rx="3" />
        <rect class="f-wood" x="379" y="219" width="48" height="67" rx="3" />
        <g class="f-line" stroke="none">
          <rect x="135" y="225" width="16" height="3" rx="1.5" />
          <rect x="187" y="225" width="16" height="3" rx="1.5" />
          <rect x="239" y="225" width="16" height="3" rx="1.5" />
          <rect x="291" y="225" width="16" height="3" rx="1.5" />
          <rect x="343" y="225" width="16" height="3" rx="1.5" />
        </g>
        <rect class="f-top" x="-2" y="292" width="397" height="10" />
      </g>

      <!-- 9 樣廚具：每樣一個 <g>，第一個透明方塊是點擊範圍（比畫的大一圈，手機好點；彼此不重疊） -->
      <!-- 微波爐：嵌在吊櫃右邊那格 -->
      <g v-bind="ap('microwave')">
        <rect class="hit" x="300" y="11" width="88" height="45" rx="6" />
        <rect class="f-white" x="304" y="15" width="80" height="37" rx="4" />
        <rect class="f-dark" x="310" y="21" width="48" height="25" rx="3" />
        <path class="f-acc" d="M326 37 H342 A8 5 0 0 1 326 37 Z" stroke="none" />
        <rect class="f-steel" x="318" y="41" width="32" height="2.5" rx="1.25" stroke="none" />
        <g class="f-dark" stroke="none">
          <rect x="363" y="21" width="15" height="6" rx="2" />
          <circle cx="366.5" cy="34" r="1.8" />
          <circle cx="374.5" cy="34" r="1.8" />
          <circle cx="366.5" cy="41" r="1.8" />
          <circle cx="374.5" cy="41" r="1.8" />
        </g>
      </g>
      <!-- BBQ：窗外露台上 -->
      <g v-bind="ap('bbq')">
        <rect class="hit" x="163" y="92" width="80" height="61" rx="6" />
        <circle class="f-dark" cx="189" cy="145" r="4.5" />
        <circle class="f-dark" cx="217" cy="145" r="4.5" />
        <rect class="f-steel" x="183" y="121" width="40" height="22" rx="3" />
        <path class="f-none" d="M203 124 V140" />
        <rect class="f-steel" x="167" y="113" width="16" height="4" rx="2" />
        <rect class="f-steel" x="223" y="113" width="16" height="4" rx="2" />
        <rect class="f-steel" x="179" y="111" width="48" height="11" rx="3" />
        <path class="f-dark" d="M182 112 V105 A8 8 0 0 1 190 97 H216 A8 8 0 0 1 224 105 V112 Z" />
        <rect class="f-steel" x="193" y="101" width="20" height="3" rx="1.5" stroke="none" />
        <circle class="f-white" cx="203" cy="107.5" r="2" stroke="none" />
        <g class="f-dark" stroke="none">
          <circle cx="195" cy="116.5" r="1.8" />
          <circle cx="203" cy="116.5" r="1.8" />
          <circle cx="211" cy="116.5" r="1.8" />
        </g>
      </g>
      <!-- 爐台：檯面上嵌的爐子，兩個爐口，左邊放平底鍋、右邊在燒 -->
      <g v-bind="ap('stovetop')">
        <rect class="hit" x="0" y="168" width="114" height="39" rx="6" />
        <path class="f-acc" d="M72 186 C74.8 190.5 75.5 193 75.5 193 A3.5 3.5 0 0 1 68.5 193 C68.5 193 69.2 190.5 72 186 Z" stroke="none" />
        <path class="f-acc" d="M84 182 C87.2 188 88 191.5 88 192 A4 4 0 0 1 80 192 C80 191.5 80.8 188 84 182 Z" stroke="none" />
        <path class="f-acc" d="M96 186 C98.8 190.5 99.5 193 99.5 193 A3.5 3.5 0 0 1 92.5 193 C92.5 193 93.2 190.5 96 186 Z" stroke="none" />
        <g class="f-bread" stroke="none">
          <ellipse cx="72" cy="194" rx="1.6" ry="2.4" />
          <ellipse cx="84" cy="193.5" rx="2" ry="3" />
          <ellipse cx="96" cy="194" rx="1.6" ry="2.4" />
        </g>
        <rect class="f-dark" x="0" y="184.5" width="22" height="5.5" rx="2.75" transform="rotate(10 21 187)" />
        <path class="f-dark" d="M18 186 H62 L57 197 H23 Z" />
        <ellipse class="f-dark" cx="40" cy="186" rx="22" ry="4" />
        <ellipse class="f-white" cx="41" cy="185.8" rx="9" ry="2.4" stroke="none" />
        <ellipse class="f-acc" cx="42" cy="185.6" rx="2.6" ry="1.4" stroke="none" />
        <g class="f-dark" stroke="none">
          <rect x="22" y="197" width="36" height="3" rx="1.5" />
          <rect x="66" y="197" width="36" height="3" rx="1.5" />
        </g>
        <rect class="f-dark" x="14" y="200" width="96" height="5" rx="2" />
      </g>
      <!-- 果汁機 -->
      <g v-bind="ap('blender')">
        <rect class="hit" x="116" y="142" width="38" height="64" rx="6" />
        <path class="f-none" d="M145 161 H149 A2 2 0 0 1 151 163 V177 A2 2 0 0 1 149 179 H144" />
        <path class="f-glass" d="M122 156 H146 L142 188 H126 Z" />
        <path class="f-acc" d="M125.5 172 H142.5 L140.8 186 H127.2 Z" stroke="none" />
        <rect class="f-dark" x="130" y="146" width="8" height="5" rx="1.5" />
        <rect class="f-dark" x="121" y="150" width="26" height="7" rx="2.5" />
        <path class="f-dark" d="M123 204 L125 188 H143 L145 204 Z" />
        <circle class="f-white" cx="134" cy="197" r="2.5" stroke="none" />
      </g>
      <!-- 烤麵包機 -->
      <g v-bind="ap('toaster')">
        <rect class="hit" x="156" y="164" width="52" height="42" rx="6" />
        <rect class="f-bread" x="165" y="170" width="14" height="14" rx="4" />
        <rect class="f-bread" x="182" y="172" width="14" height="12" rx="4" />
        <rect class="f-acc" x="158" y="180" width="44" height="24" rx="8" />
        <rect class="f-dark" x="201" y="186" width="5" height="4" rx="1.5" stroke="none" />
        <rect class="f-white" x="164" y="192" width="18" height="4" rx="2" stroke="none" />
        <circle class="f-white" cx="193" cy="194" r="3" stroke="none" />
      </g>
      <!-- 電子鍋 -->
      <g v-bind="ap('rice-cooker')">
        <rect class="hit" x="210" y="165" width="46" height="41" rx="6" />
        <path class="f-white" d="M213 182 C213 170 249 170 249 182 Z" />
        <rect class="f-white" x="210" y="179" width="42" height="25" rx="10" />
        <rect class="f-dark" x="226" y="169" width="10" height="5" rx="2.5" />
        <rect class="f-dark" x="221" y="186" width="20" height="9" rx="3" />
        <circle class="f-acc" cx="236.5" cy="190.5" r="1.8" stroke="none" />
      </g>
      <!-- 慢燉鍋：兩邊有把手、玻璃蓋 -->
      <g v-bind="ap('slow-cooker')">
        <rect class="hit" x="260" y="162" width="66" height="44" rx="6" />
        <rect class="f-dark" x="264" y="185" width="9" height="6" rx="2" />
        <rect class="f-dark" x="313" y="185" width="9" height="6" rx="2" />
        <path class="f-glass" d="M270 183 C270 171 316 171 316 183 Z" />
        <rect class="f-steel" x="268" y="181" width="50" height="23" rx="9" />
        <rect class="f-dark" x="287" y="168" width="12" height="7" rx="3" />
        <circle class="f-white" cx="293" cy="193" r="4.5" />
        <path class="f-none" d="M293 193 V190" />
      </g>
      <!-- 氣炸鍋：上面螢幕、下面抽屜 -->
      <g v-bind="ap('air-fryer')">
        <rect class="hit" x="328" y="148" width="50" height="58" rx="6" />
        <rect class="f-white" x="332" y="152" width="42" height="52" rx="11" />
        <rect class="f-dark" x="343" y="159" width="20" height="9" rx="3" />
        <rect class="f-steel" x="336" y="175" width="34" height="25" rx="7" />
        <rect class="f-dark" x="344" y="184" width="18" height="6" rx="3" />
      </g>
      <!-- 烤箱：嵌在爐台下面的下櫃裡 -->
      <g v-bind="ap('oven')">
        <rect class="hit" x="10" y="212" width="104" height="82" rx="6" />
        <rect class="f-steel" x="14" y="216" width="96" height="74" rx="3" />
        <rect class="f-white" x="20" y="220" width="84" height="11" rx="3" />
        <g class="f-dark" stroke="none">
          <circle cx="32" cy="225.5" r="3" />
          <circle cx="44" cy="225.5" r="3" />
          <circle cx="56" cy="225.5" r="3" />
          <rect x="78" y="222.5" width="20" height="6" rx="2" />
        </g>
        <rect class="f-white" x="20" y="235" width="84" height="50" rx="3" />
        <rect class="f-dark" x="30" y="239" width="64" height="4" rx="2" stroke="none" />
        <rect class="f-dark" x="30" y="248" width="64" height="30" rx="4" />
        <rect class="f-acc" x="40" y="266" width="44" height="7" rx="3" stroke="none" />
      </g>
    </svg>
    <Transition name="fade">
      <span v-if="tip" :key="tip" class="tip" :class="[TIP[tip].at, { off: !modelValue.includes(tip) }]" :style="{ left: (TIP[tip].x / 393) * 100 + '%', top: (TIP[tip].y / 300) * 100 + '%' }" aria-hidden="true">{{ t('recipes.appliance.' + tip) }}</span>
    </Transition>
  </div>
</template>

<style scoped>
/* 顏色：深綠＝家裡有；其他是柔和的牆、木頭、檯面、不鏽鋼，外加一個陶土色點綴（App 目前只有淺色模式） */
.kp {
  --pick: #1c4526;
  --k-line: #a39886;
  --k-wall: #f6f1e9;
  --k-wood: #e8dcc8;
  --k-top: #d3c2a7;
  --k-steel: #dde0e3;
  --k-dark: #5f6368;
  --k-acc: #e7a488;
  --k-bread: #f2d9ab;
  --k-glass: #e4f0f5;
  --k-sky: #d8e9f2;
  --k-leaf: #cde1c2;
  --k-deck: #dcc6a6;
  position: relative;
  border: 1.5px solid var(--line);
  border-radius: var(--r);
  overflow: hidden;
  background: var(--k-wall);
}
.kp svg { display: block; width: 100%; height: auto; aspect-ratio: 393 / 300; stroke: var(--k-line); touch-action: manipulation; }
.f-wall { fill: var(--k-wall); }
.f-wood { fill: var(--k-wood); }
.f-top { fill: var(--k-top); }
.f-line { fill: var(--k-line); }
.f-white { fill: var(--card); }
.f-steel { fill: var(--k-steel); }
.f-dark { fill: var(--k-dark); }
.f-acc { fill: var(--k-acc); }
.f-bread { fill: var(--k-bread); }
.f-glass { fill: var(--k-glass); }
.f-sky { fill: var(--k-sky); }
.f-leaf { fill: var(--k-leaf); }
.f-deck { fill: var(--k-deck); }
.f-none { fill: none; }
.hit { fill: transparent; stroke: none; }
/* 廚具：沒選變淡；選了描邊變深綠、放大一點點（以自己的中心放大） */
.ap { cursor: pointer; outline: none; opacity: 0.45; transform-box: fill-box; transform-origin: center; transition: opacity 0.28s var(--ease), transform 0.28s var(--ease), stroke 0.28s var(--ease); }
.ap.on { opacity: 1; stroke: var(--pick); transform: scale(1.04); }
.ap:focus-visible .hit { stroke: var(--pick); stroke-dasharray: 4 3; }
@media (prefers-reduced-motion: reduce) {
  .ap.on { transform: none; }
}
/* 點到的那一樣：名字標籤 1.5 秒。選了是深綠底；取消了是白底灰字、劃線 */
.tip {
  position: absolute;
  z-index: 1;
  transform: translate(-50%, calc(-100% - 4px));
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--pick);
  color: var(--card);
  font-size: 12.5px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(17, 17, 17, 0.18);
}
.tip.end { transform: translate(-100%, calc(-100% - 4px)); }
.tip.below.end { transform: translate(-100%, 4px); }
.tip.mid { transform: translate(-50%, -50%); }
.tip.off { background: var(--card); color: var(--ink-3); text-decoration: line-through; box-shadow: 0 0 0 1.5px var(--line), 0 2px 8px rgba(17, 17, 17, 0.12); }
</style>
