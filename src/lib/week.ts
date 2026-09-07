const NZ = 'Pacific/Auckland'
const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: NZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's calendar date in Pacific/Auckland as YYYY-MM-DD. */
export function nzToday(): string {
  return ymd.format(new Date())
}

function parse(iso: string): Date {
  return new Date(iso + 'T00:00:00Z')
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Monday (YYYY-MM-DD) of the week that contains `iso` (default: today in NZ). */
export function nzMonday(iso = nzToday()): string {
  const d = parse(iso)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return toIso(d)
}

/** The n Mondays up to and including `from`, newest first. */
export function weeksBack(n: number, from = nzMonday()): string[] {
  const out: string[] = []
  const d = parse(from)
  for (let i = 0; i < n; i++) {
    out.push(toIso(d))
    d.setUTCDate(d.getUTCDate() - 7)
  }
  return out
}

/** Days remaining in the special week, counting today (Mon = 7, Sun = 1). */
export function daysLeft(iso = nzToday()): number {
  return 7 - ((parse(iso).getUTCDay() + 6) % 7)
}

/** "31 Aug" — short date for the "not updated" note. */
export function shortDate(iso: string, lang: 'en' | 'zh'): string {
  const d = parse(iso)
  if (lang === 'zh') return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(d)
}
