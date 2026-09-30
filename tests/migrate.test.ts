// 換網域搬家：只搬白名單、新網址已有的不覆蓋、清單按 id 合併、中文來回一樣、壞字串回 null、搬完回原本那頁只收站內路徑（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodePayload, encodePayload, exportGuestData, importGuestData, safeReturnPath } from '../src/lib/migrate.ts'

const j = JSON.stringify
/** 假的 localStorage（只有 getItem / setItem），值跟 writeCache 一樣是 JSON 字串 */
function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    all: () => Object.fromEntries(m),
  }
}

const LIST = [
  { id: 'a1', key: 'anchor_milk_2l', name: 'Anchor Milk 2L', qty: 1, checked: false },
  { id: 'b2', key: null, name: '衛生紙', qty: 2, checked: true, checkedAt: '2026-09-30T01:00:00.000Z' },
]

test('export 只帶白名單：店、清單、語言、座標、偏好；下載的快取、裝置 id、登入 token 不帶', () => {
  const s = mem({
    'nzd:selected': j(['woolworths:9433', 'newworld:be37802e-1355-466e-9a1b-1ede5a099705']),
    'nzd:list': j(LIST),
    'nzd:lang': j('en'),
    'nzd:coords': j({ lat: -39.64, lng: 176.84 }),
    'nzd:foodOnly': j(false),
    'nzd:ai:prefs': j({ serves: 2, maxMinutes: 30, spice: 'none', difficulty: 'easy', notes: '不吃牛' }),
    'nzd:recentCats': j(['pantry/baking']),
    'nzd:announceSeen': j('週一更新晚一點'),
    'nzd:stores': j([{ id: 'woolworths:9433' }]),
    'nzd:categories': j({ pantry: { name: 'Pantry' } }),
    'nzd:sp:woolworths:9433:2026-09-28': j({ w: '2026-09-28' }),
    'nzd:ai:used': j({ day: '2026-09-30', n: 3 }),
    'nzd:device': 'c0ffee-device',
    'sb-mzuckacocbeuekdzikzu-auth-token': j({ access_token: 'x' }),
  })
  const out = exportGuestData(s)
  assert.deepEqual(Object.keys(out).sort(), ['nzd:ai:prefs', 'nzd:announceSeen', 'nzd:coords', 'nzd:foodOnly', 'nzd:lang', 'nzd:list', 'nzd:recentCats', 'nzd:selected'])
  assert.deepEqual(out['nzd:list'], LIST)
  assert.equal(out['nzd:foodOnly'], false)
})

test('export 超過 200 KB 從最大的開始丟', () => {
  const big = Array.from({ length: 3000 }, (_, i) => ({ id: `id-${i}`, key: null, name: 'x'.repeat(80), qty: 1, checked: false }))
  const out = exportGuestData(mem({ 'nzd:list': j(big), 'nzd:lang': j('zh'), 'nzd:selected': j(['woolworths:9433']) }))
  assert.deepEqual(Object.keys(out).sort(), ['nzd:lang', 'nzd:selected'])
})

test('import：新網址已經有的 key 不覆蓋，沒有的才寫；回搬了幾個', () => {
  const s = mem({ 'nzd:lang': j('en'), 'nzd:selected': j(['paknsave:b39562a4-2b72-43fe-b9ba-eda1d651ad0b']) })
  const n = importGuestData(s, { 'nzd:lang': 'zh', 'nzd:selected': ['woolworths:9433'], 'nzd:foodOnly': false, 'nzd:coords': { lat: -39.64, lng: 176.84 } })
  assert.equal(n, 2)
  assert.equal(s.getItem('nzd:lang'), j('en'))
  assert.equal(s.getItem('nzd:selected'), j(['paknsave:b39562a4-2b72-43fe-b9ba-eda1d651ad0b']))
  assert.equal(s.getItem('nzd:foodOnly'), 'false')
  assert.equal(s.getItem('nzd:coords'), j({ lat: -39.64, lng: 176.84 }))
})

test('import：清單按 id 合併，原本的在前、已有的不重複', () => {
  const mine = [
    { id: 'b2', key: null, name: '衛生紙（新網址這邊改過）', qty: 3, checked: false },
    { id: 'c3', key: 'eggs_dozen', name: 'Eggs 12pk', qty: 1, checked: false },
  ]
  const s = mem({ 'nzd:list': j(mine) })
  assert.equal(importGuestData(s, { 'nzd:list': LIST }), 1)
  assert.deepEqual(JSON.parse(s.getItem('nzd:list')!), [...mine, LIST[0]])
  // 同樣的再搬一次：沒有新項目，不動
  assert.equal(importGuestData(s, { 'nzd:list': LIST }), 0)
  assert.equal(JSON.parse(s.getItem('nzd:list')!).length, 3)
})

test('import：白名單外的 key、型別不對的值都不寫（網址誰都拼得出來）', () => {
  const s = mem()
  const n = importGuestData(s, {
    'sb-mzuckacocbeuekdzikzu-auth-token': { access_token: 'evil' },
    'nzd:stores': [{ id: 'x' }],
    'nzd:selected': { not: 'an array' },
    'nzd:lang': 'fr',
    'nzd:list': [{ name: '沒有 id' }],
  })
  assert.equal(n, 0)
  assert.deepEqual(s.all(), {})
})

test('encode / decode：中文、emoji 來回一樣，而且只用網址安全的字', () => {
  const data = { 'nzd:list': LIST, 'nzd:ai:prefs': { notes: '不吃香菜 🌿，少辣' }, 'nzd:lang': 'zh' }
  const p = encodePayload(data)
  assert.match(p, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(decodePayload(p), data)
})

test('decode 壞字串回 null', () => {
  for (const bad of ['', 'not base64!!', 'a', btoa('hello'), btoa('%E4'), btoa(encodeURIComponent('[1,2]')), btoa(encodeURIComponent('null'))]) {
    assert.equal(decodePayload(bad), null, bad)
  }
})

test('整趟：舊網址 export → 網址 → 新網址 import，存進去的字串跟舊網址一模一樣', () => {
  const old = mem({ 'nzd:selected': j(['woolworths:9433']), 'nzd:list': j(LIST), 'nzd:lang': j('zh'), 'nzd:stores': j([{ id: 'x' }]) })
  const fresh = mem()
  assert.equal(importGuestData(fresh, decodePayload(encodePayload(exportGuestData(old)))!), 3)
  assert.deepEqual(fresh.all(), { 'nzd:selected': j(['woolworths:9433']), 'nzd:list': j(LIST), 'nzd:lang': j('zh') })
})

test('safeReturnPath：站內路徑原樣回（分享清單、食譜、帶查詢字串的）', () => {
  for (const ok of ['/s/abc123', '/recipes/2026-09-28-kiwi-mince-pie', '/search?q=%E7%89%9B%E5%A5%B6']) assert.equal(safeReturnPath(ok), ok)
})

test('safeReturnPath：外部網址、// 開頭、中間有 //、不是 / 開頭的都回首頁', () => {
  for (const bad of ['//evil', '//evil.com/s/abc', 'https://evil.com', '/s//evil.com', 'evil.com', '']) assert.equal(safeReturnPath(bad), '/', bad)
})

test('safeReturnPath：/migrate 不回（不然搬完又回搬家頁）', () => {
  for (const bad of ['/migrate', '/migrate?d=abc', '/Migrate/']) assert.equal(safeReturnPath(bad), '/', bad)
})

test('safeReturnPath：不是字串（沒帶、帶兩次變陣列）回首頁', () => {
  for (const bad of [undefined, null, 123, ['/s/abc123'], { to: '/s/abc123' }]) assert.equal(safeReturnPath(bad), '/')
})
