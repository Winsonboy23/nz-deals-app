// 隱私權政策、刪除資料說明（2026-09-30；開 Facebook 登入時 Meta 開發者後台要填這兩頁的網址：/privacy.html、/delete-data.html）。
// 內文在 legal.json（2026-09-30 從這裡搬過去）：App 的 #/privacy、#/delete-data 從這裡讀；scripts/legal-static.mjs 在 build 時用同一份產
// public/privacy.html、public/delete-data.html 兩個純 HTML，給不跑 JavaScript 的 Meta 爬蟲看。
// 一段一個字串：'# ' 開頭＝小標題、'- ' 開頭＝列點，其他＝一般段落（components/LegalText.vue 照這個畫）。中英兩份一段對一段。內文裡的 {email} 會換成 contactEmail。
// 照實際情況寫：資料怎麼存變了（新表、新服務、保留多久），legal.json 要跟著改，updated 也要改。
import legal from './legal.json'

/** 聯絡信箱。2026-09-30 還沒開通，寄了收不到：開通或換地址時改 legal.json 的 contactEmail（兩頁和靜態版都從那裡讀）。 */
export const CONTACT_EMAIL: string = legal.contactEmail
export const LEGAL_UPDATED: string = legal.updated

const fill = (paras: string[]): string[] => paras.map((p) => p.replaceAll('{email}', CONTACT_EMAIL))

export const PRIVACY: { en: string[]; zh: string[] } = { en: fill(legal.privacy.en), zh: fill(legal.privacy.zh) }

export const DELETE_DATA: { en: string[]; zh: string[] } = { en: fill(legal.deleteData.en), zh: fill(legal.deleteData.zh) }
