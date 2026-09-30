// 隱私權政策、刪除資料說明的靜態版（2026-09-30）：Meta 審核的爬蟲不跑 JavaScript，#/privacy 看到的是空頁，
// 所以 build 前從 src/data/legal.json 產兩個純 HTML 到 public/，部署後就是 https://<host>/privacy.html、/delete-data.html。
// 產出的兩個檔不進 git（.gitignore），每次 build 重產；要改內文改 legal.json。格式跟 components/LegalText.vue 一樣：'# ' 小標、'- ' 列點、其他是段落。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const legal = JSON.parse(readFileSync(resolve(here, '../src/data/legal.json'), 'utf8'))

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESC[c])
const mail = `<a href="mailto:${esc(legal.contactEmail)}">${esc(legal.contactEmail)}</a>`
/** 一段文字：先跳脫，內文裡的 {email} 換成可以點的 mailto */
const text = (s) => esc(s).replaceAll('{email}', mail)

/** 一個語言的內文；連續的列點包成一個 <ul> */
function body(paras) {
  const out = []
  let inList = false
  for (const p of paras) {
    const li = p.startsWith('- ')
    if (li !== inList) out.push(li ? '<ul>' : '</ul>')
    inList = li
    if (li) out.push(`<li>${text(p.slice(2))}</li>`)
    else if (p.startsWith('# ')) out.push(`<h2>${text(p.slice(2))}</h2>`)
    else out.push(`<p>${text(p)}</p>`)
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

const UPDATED = { en: `Last updated: ${legal.updated}`, zh: `最後更新：${legal.updated}` }
const PAGES = [
  {
    file: 'privacy.html',
    title: 'KiteWise Privacy Policy',
    h1: { en: 'Privacy policy', zh: '隱私權政策' },
    paras: legal.privacy,
    // App 的隱私權政策頁最後也連到刪除資料說明
    more: { en: '<p><a href="delete-data.html">Deleting your data</a></p>', zh: '<p><a href="delete-data.html">刪除資料說明</a></p>' },
  },
  {
    file: 'delete-data.html',
    title: 'KiteWise Data Deletion',
    h1: { en: 'Deleting your data', zh: '刪除資料說明' },
    paras: legal.deleteData,
    more: { en: '', zh: '' },
  },
]

// 英文在前、中文在後，兩份都直接展開（爬蟲和手機都不用點）
const page = (p) => `<!doctype html>
<!-- 由 scripts/legal-static.mjs 從 src/data/legal.json 產生，每次 build 重產，不要手改 -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title}</title>
<style>
  body { margin: 0; background: #fff; color: #111; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "PingFang TC", "Noto Sans TC", sans-serif; overflow-wrap: break-word; }
  main { max-width: 680px; margin: 0 auto; padding: 20px 16px 48px; }
  .top { display: flex; justify-content: space-between; font-weight: 700; }
  h1 { font-size: 26px; line-height: 1.2; margin: 24px 0 4px; }
  h2 { font-size: 18px; line-height: 1.3; margin: 24px 0 0; }
  p, ul { margin: 10px 0 0; }
  ul { padding-left: 22px; }
  li { margin-top: 4px; }
  a { color: inherit; }
  .updated { margin: 0; color: #4a4a4a; font-size: 14px; }
  hr { border: 0; border-top: 1px solid #e6e6e6; margin: 40px 0 0; }
</style>
</head>
<body>
<main>
<div class="top"><span>KiteWise</span><a href="#zh" lang="zh-Hant">中文</a></div>
<section lang="en">
<h1>${p.h1.en}</h1>
<p class="updated">${UPDATED.en}</p>
${body(p.paras.en)}
${p.more.en}
</section>
<hr>
<section id="zh" lang="zh-Hant">
<h1>${p.h1.zh}</h1>
<p class="updated">${UPDATED.zh}</p>
${body(p.paras.zh)}
${p.more.zh}
</section>
</main>
</body>
</html>
`

for (const p of PAGES) writeFileSync(resolve(here, '../public', p.file), page(p))
