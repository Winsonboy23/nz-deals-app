const PREFIX = 'nzd:'

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** Best-effort write. Drops other entries with the same prefix and retries once on quota errors. */
export function writeCache(key: string, value: unknown, evictPrefix?: string): void {
  const payload = JSON.stringify(value)
  try {
    localStorage.setItem(PREFIX + key, payload)
  } catch {
    if (evictPrefix) dropPrefix(evictPrefix, PREFIX + key)
    try {
      localStorage.setItem(PREFIX + key, payload)
    } catch {
      /* cache is a nice-to-have; the in-memory copy still works */
    }
  }
}

export function dropPrefix(prefix: string, except?: string): void {
  try {
    const full = PREFIX + prefix
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(full) && k !== except) localStorage.removeItem(k)
    }
  } catch {
    /* ignore */
  }
}
