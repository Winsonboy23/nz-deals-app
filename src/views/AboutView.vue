<script setup lang="ts">
// 我的 → 關於 KiteWise：名字的由來（2026-09-30 品牌定案）。英文是定稿；中文介面先中文再英文，英文介面只放英文。
// 兩種語言要同時出現，所以不放 useI18n 的 DICT（t() 只給目前的語言）。
import { lang, t } from '../composables/useI18n'

const SLOGAN = 'Spot the specials. Cook smart. Live lighter.'
const EN = `Kite means "to see, to discover" in te reo Māori. It's also a bird that spots everything from above, and the thing you fly on a windy day at the beach. KiteWise sees every special across Woolworths, PAK'nSAVE and New World, turns them into easy dinners, and takes the weight off your week, so you've got more time for the things that matter. And yes, look closely: there's a Kiwi in our name.`
const ZH = `Kite 在毛利語裡是「看見、發現」的意思。它也是一種鳥（鳶），從高空把一切看在眼裡；也是起風的日子，你在海邊放的風箏。KiteWise 幫你看遍 Woolworths、PAK'nSAVE 和 New World 的每一樣特價，變成輕鬆上桌的晚餐，讓你這一週少點負擔，多點時間留給真正重要的事。沒錯，仔細看：我們的名字裡藏了一隻 Kiwi。`
</script>

<template>
  <div class="screen">
    <div class="pad" style="margin-top: 6px"><RouterLink class="back" to="/me">‹ {{ t('me.title') }}</RouterLink></div>
    <div class="pad" style="margin-top: 8px">
      <div class="h1">KiteWise</div>
      <div class="sub" style="margin-top: 6px">{{ SLOGAN }}</div>
    </div>
    <div class="pad" style="margin-top: 18px; font-size: 15px; line-height: 1.6">
      <div v-if="lang === 'zh'" style="margin-bottom: 14px">{{ ZH }}</div>
      <div lang="en">{{ EN }}</div>
    </div>
  </div>
</template>
