<script setup lang="ts">
// 加一張會員卡：選哪種卡（Club+／Everyday Rewards／其他）→ 掃截圖／照片（或手動打號碼）→ 存。長相照 MatchSheet（.dim + .bsheet + 把手），根元素是一層 div，外面的 <Transition name="sheet"> 要講明時間。
// 讀條碼：先試瀏覽器內建的 BarcodeDetector（Chrome Android 有），沒有或讀不到再動態載入 ZXing。iPhone Safari 沒有 BarcodeDetector，一律走 ZXing。
import { computed, ref } from 'vue'
import { cardCls, cardTitle, useCards, type CardChain } from '../composables/useCards'
import { t } from '../composables/useI18n'
import { cleanCode, ean13Valid, toJsBarcodeFormat } from '../lib/barcode'

const emit = defineEmits<{ done: []; dismiss: [] }>()
const { add } = useCards()

/** 三種卡（2026-10-01）：紅超黃超共用一張 Club+、綠超的 Everyday Rewards、其他（要填名稱）。左邊一張小卡面、名字、副標 */
const CHAINS: { id: CardChain; sub: () => string }[] = [
  { id: 'clubplus', sub: () => t('cards.clubplusSub') },
  { id: 'woolworths', sub: () => 'Woolworths' },
  { id: 'other', sub: () => t('cards.otherSub') },
]
const chainLabel = (c: CardChain) => cardTitle({ chain: c, label: null })

const chain = ref<CardChain | null>(null)
const label = ref('')
const code = ref('')
/** 掃到的格式（JsBarcode 名）；手動輸入就是 CODE128 */
const format = ref('CODE128')
const scan = ref<'idle' | 'reading' | 'ok' | 'fail'>('idle')
const saving = ref(false)
const failed = ref(false)

const clean = computed(() => cleanCode(code.value))
/** CODE128 只能畫英數和一般符號；中文、全形字畫不出來 */
const badChars = computed(() => !!clean.value && !/^[\x21-\x7e]+$/.test(clean.value))
const canSave = computed(() => !!chain.value && !!clean.value && !badChars.value && (chain.value !== 'other' || !!label.value.trim()) && !saving.value)

/** 會員卡幾乎都是一維條碼，同一張圖同時有 QR 的話挑一維的；QR 也收（畫的時候變 CODE128，內容一樣） */
const ONE_D = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar']
interface Detected { rawValue: string; format: string }
type Detector = new () => { detect(src: CanvasImageSource): Promise<Detected[]> }

/** 圖先縮到最長邊 2048：手機照片動輒兩千多萬畫素，iPhone Safari 的 canvas 放不下，ZXing 也會很慢 */
async function toCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const s = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * s)
    canvas.height = Math.round(img.naturalHeight * s)
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function readBarcode(file: File): Promise<{ code: string; format: string } | null> {
  const canvas = await toCanvas(file)
  const BD = (window as unknown as { BarcodeDetector?: Detector }).BarcodeDetector
  if (BD) {
    try {
      const found = (await new BD().detect(canvas)).filter((b) => b.rawValue)
      const hit = found.find((b) => ONE_D.includes(b.format)) ?? found[0]
      if (hit) return { code: hit.rawValue, format: hit.format }
    } catch {
      // 這台不支援（例如沒有可用的格式）→ 換 ZXing
    }
  }
  // 第一次用才下載（ZXing 兩個 chunk 約 490 KB、gzip 約 125 KB），不進主程式
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
  const hints = new Map()
  hints.set(DecodeHintType.TRY_HARDER, true)   // 從上掃到下（不加只掃中間約八成高，截圖裡偏上偏下的條碼會漏），找不到還會轉 90 度再掃
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE,
  ])
  try {
    const r = new BrowserMultiFormatReader(hints).decodeFromCanvas(canvas)
    return { code: r.getText(), format: BarcodeFormat[r.getBarcodeFormat()] }
  } catch {
    return null   // NotFoundException：圖裡沒有讀得到的條碼
  }
}

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''   // 同一張圖再選一次也要觸發
  if (!file) return
  scan.value = 'reading'
  const hit = await readBarcode(file).catch(() => null)
  if (hit && cleanCode(hit.code)) {
    code.value = cleanCode(hit.code)
    format.value = toJsBarcodeFormat(hit.format)
    scan.value = 'ok'
  } else {
    scan.value = 'fail'
  }
}

async function save(): Promise<void> {
  if (!canSave.value || !chain.value) return
  saving.value = true
  failed.value = false
  const c = clean.value
  const ok = await add({
    chain: chain.value,
    label: chain.value === 'other' ? label.value.trim() : null,
    code: c,
    // 掃到 EAN13 之後又改了號碼，檢查碼可能對不上 → 存 CODE128（畫得出來、一樣掃得到）
    format: format.value === 'EAN13' && !ean13Valid(c) ? 'CODE128' : format.value,
  })
  saving.value = false
  if (ok) emit('done')
  else failed.value = true
}
</script>

<template>
  <div>
    <div class="dim" @click="emit('dismiss')" />
    <div class="bsheet" role="dialog" :aria-label="t('cards.addTitle')">
      <button class="grab-btn" type="button" :aria-label="t('cards.cancel')" @click="emit('dismiss')"><div class="grab" /></button>
      <div class="h2" style="font-size: 22px">{{ t('cards.addTitle') }}</div>

      <div class="sec" style="margin-top: 16px">{{ t('cards.which') }}</div>
      <div class="opts" role="radiogroup" :aria-label="t('cards.which')" style="margin-top: 8px">
        <button v-for="c in CHAINS" :key="c.id" type="button" class="opt" :class="{ on: chain === c.id }" role="radio" :aria-checked="chain === c.id" @click="chain = c.id">
          <span class="face" :class="cardCls({ chain: c.id })" aria-hidden="true"><template v-if="c.id === 'clubplus'"><i class="nw" /><i class="pns" /></template></span>
          <span class="opt-text">
            <span class="opt-name">{{ chainLabel(c.id) }}</span>
            <span class="opt-sub">{{ c.sub() }}</span>
          </span>
          <span class="opt-tick" aria-hidden="true">✓</span>
        </button>
      </div>
      <div v-if="chain === 'other'" class="field" style="margin-top: 10px">
        <input v-model="label" maxlength="40" :placeholder="t('cards.labelPh')" style="flex: 1" />
      </div>

      <label class="btn ghost scan" :class="{ busy: scan === 'reading' }" style="margin-top: 18px">
        <input class="file" type="file" accept="image/*" :disabled="scan === 'reading'" @change="onFile" />
        {{ scan === 'reading' ? t('cards.reading') : t('cards.scan') }}
      </label>
      <div class="s scan-note" :class="{ bad: scan === 'fail' }">
        <template v-if="scan === 'ok'">{{ t('cards.readOk', { f: format }) }}</template>
        <template v-else-if="scan === 'fail'">{{ t('cards.readFail') }}</template>
        <template v-else>{{ t('cards.scanHint') }}</template>
      </div>

      <div class="sec" style="margin-top: 16px">{{ t('cards.number') }}</div>
      <div class="field solid" style="margin-top: 8px">
        <input
          v-model="code"
          :inputmode="chain === 'other' ? 'text' : 'numeric'"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          maxlength="64"
          :placeholder="t('cards.numberPh')"
          style="flex: 1; font-size: 18px; letter-spacing: 0.5px"
        />
      </div>
      <div v-if="badChars" class="s scan-note bad">{{ t('cards.badChars') }}</div>

      <button class="btn" type="button" style="margin-top: 18px" :disabled="!canSave" :style="{ opacity: canSave ? 1 : 0.35 }" @click="save">
        {{ saving ? '…' : t('cards.save') }}
      </button>
      <div v-if="failed" class="s scan-note bad" style="text-align: center">{{ t('cards.saveFailed') }}</div>
    </div>
  </div>
</template>

<style scoped>
/* 選卡：一列一種，選中＝綠框淺綠底（跟 .chip.on 一樣） */
.opts { display: flex; flex-direction: column; gap: 8px; }
.opt { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 14px; background: var(--card); }
.opt.on { background: var(--brand-tint); border-color: var(--brand); }
/* 小卡面：顏色跟會員卡頁一樣（Club+ 深色、右上紅黃兩點；綠超色；其他深灰） */
.face { position: relative; flex: none; width: 46px; height: 30px; border-radius: 6px; }
.face.cp { background: linear-gradient(145deg, #2b3b31 0%, #18221b 55%, #101712 100%); }
.face.ww { background: var(--ww); }
.face.other { background: #3a3a3a; }
.face i { position: absolute; top: 5px; width: 7px; height: 7px; border-radius: 50%; }
.face i.nw { right: 14px; background: var(--nw); }
.face i.pns { right: 5px; background: var(--pns); }
.opt-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.opt-name { font-size: 15px; font-weight: 700; line-height: 1.25; }
/* keep-all：中文只在空白處換行，「共用」不會被拆成兩行 */
.opt-sub { font-size: 12.5px; color: var(--ink-2); line-height: 1.3; word-break: keep-all; }
.opt-tick { flex: none; font-weight: 900; color: var(--brand-deep); opacity: 0; }
.opt.on .opt-tick { opacity: 1; }
.scan { position: relative; height: 52px; font-size: 16px; cursor: pointer; }
.scan.busy { opacity: 0.55; }
/* 檔案欄藏起來但不用 display:none，點外面的 label 就會開選圖 */
.file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.scan-note { margin-top: 6px; font-size: 12.5px; color: var(--ink-2); line-height: 1.4; }
.scan-note.bad { color: var(--nw); font-weight: 600; }
</style>
