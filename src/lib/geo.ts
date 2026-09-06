/** Woolworths region codes that sit in the North Island. Foodstuffs stores use 'NI' / 'SI' directly. */
const NI_REGIONS = new Set(['NI', 'AUK', 'NTL', 'WKO', 'BOP', 'GIS', 'HKB', 'TKI', 'MWT', 'WGN'])

export function islandOf(region: string | null): 'NI' | 'SI' | null {
  if (!region) return null
  return NI_REGIONS.has(region.toUpperCase()) ? 'NI' : 'SI'
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
