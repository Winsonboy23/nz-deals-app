// 寶寶支線（1 歲以下）不能加鹽、糖、蜂蜜：後台食譜存檔前用這個看 6／9／12 個月那幾段有沒有提到（tests/baby.test.ts）

/** 前面有這些就當作是在說「不要加」 */
const NEG = /不加|不要|不放|\bno\b|\bwithout\b|\bskip/i

/**
 * 這段提到哪幾樣（照出現順序、不重複；英文回小寫）。每次出現都往前看：中文看 6 個字，英文一個詞算一個字、看 6 個詞，
 * 裡面有「不加／不要／不放／no／without／skip」就不算。同一樣出現好幾次，只要有一次前面沒有就算。
 */
export function babyRisks(text: string): string[] {
  const hits = new Set<string>()
  for (const m of text.matchAll(/鹽|糖|蜂蜜|salt|sugar|honey/gi)) {
    const w = m[0].toLowerCase()
    const head = text.slice(0, m.index)
    const near = /[a-z]/.test(w) ? head.trim().split(/\s+/).slice(-6).join(' ') : head.slice(-6)
    if (!NEG.test(near)) hits.add(w)
  }
  return [...hits]
}
