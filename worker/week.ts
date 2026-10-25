/** 紐西蘭時間的「這週週一」YYYY-MM-DD（跟 App 的 lib/week.ts nzMonday、爬蟲的 weekStart 同一個算法）。 */
export function nzMonday(now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const d = new Date(today + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** 往回 n 週的週一清單（含這週） */
export function weeksBack(n: number, monday = nzMonday()): string[] {
  const out: string[] = []
  const d = new Date(monday + 'T00:00:00Z')
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 7) }
  return out
}
