// 一站 v2 的規格與品名清洗小測試（app 沒有 vitest）。跑法：npx --prefix .. tsx scripts/test-size.ts（用上層 nz-deals 的 tsx）
import { countGuess, estimate, kgOf, needed, packBigger, parseSize } from '../src/lib/size'
import { cleanWords, coverage, nameClean, searchWords } from '../src/lib/nameClean'
import { costFor } from '../src/lib/compare'

let fail = 0
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

// parseSize
eq('1.6kg', parseSize('Woolworths NZ Free Farmed Pork Shoulder Roast Boneless Min Order 1.6kg'), { qty: 1600, unit: 'g' })
eq('500 g', parseSize('500 g'), { qty: 500, unit: 'g' })
eq('6 x 330ml', parseSize('6 x 330ml'), { qty: 1980, unit: 'ml' })
eq('12x250ml', parseSize('Coke 12x250ml'), { qty: 3000, unit: 'ml' })
eq('10x14.4g', parseSize('10x14.4g'), { qty: 144, unit: 'g' })
eq('6pk', parseSize('6pk'), { qty: 6, unit: 'ea' })
eq('6 Pack', parseSize('Hellers Sausages 6 Pack'), { qty: 6, unit: 'ea' })
eq('1.5L', parseSize('L&P 1.5L'), { qty: 1500, unit: 'ml' })
eq('ea', parseSize('ea'), { qty: 1, unit: 'ea' })
eq('EA', parseSize('EA'), { qty: 1, unit: 'ea' })
eq('each', parseSize('Avocado each'), { qty: 1, unit: 'ea' })
eq('kg (loose)', parseSize('kg'), { unit: 'kg' })
eq('per kg (loose)', parseSize('Chicken Nibbles per kg'), { unit: 'kg' })
eq('Minimum 5 Per Pack 1kg', parseSize('The Odd Bunch Fresh Avocado (Minimum 5 Per Pack) 1kg'), { qty: 1000, unit: 'g' })
eq('no size', parseSize('Woolworths Essentials Chicken Breast Pieces'), null)
eq('Size 7 Eggs 12pk', parseSize('Size 7 Eggs 12pk'), { qty: 12, unit: 'ea' })
eq('12 Large', parseSize('Eggs 12 Large'), null)

// countGuess
eq('Minimum 5 Per Pack', countGuess('The Odd Bunch Fresh Avocado (Minimum 5 Per Pack) 1kg'), 5)
eq('6pk', countGuess('Hellers Sausages 6pk'), 6)
eq('6 pack', countGuess('Hellers Sausages 6 pack'), 6)
eq('min order 2', countGuess('Lemons min order 2'), 2)
eq('Min Order 1.6kg is weight', countGuess('Pork Shoulder Roast Min Order 1.6kg'), null)
eq('Min Order 1kg is weight', countGuess('Chicken Nibbles NZ Min Order 1kg'), null)
eq('nothing', countGuess('Chicken Breast Pieces'), null)

// needed / kgOf / costFor
const pork = { name: 'Woolworths NZ Free Farmed Pork Shoulder Roast Boneless Min Order 1.6kg', size: null, price: 17.99, price_unit: 'kg', multi_buy: null }
const chicken = { name: 'Woolworths Essentials Chicken Breast Pieces', size: null, price: 12.79, price_unit: 'kg', multi_buy: null }
const avo = { name: 'The Odd Bunch Fresh Avocado (Minimum 5 Per Pack) 1kg', size: null, price: 6, price_unit: 'each', unit_price: 6, unit_price_unit: 'kg', multi_buy: null }
eq('kgOf pork', kgOf(pork), 1.6)
eq('needed pork ×1', needed({ qty: 1, name: pork.name }, pork), { qty: 1600, unit: 'g' })
eq('needed chicken (kg, no size) ×2', needed({ qty: 2, name: chicken.name }, chicken), { qty: 2000, unit: 'g' })
eq('needed avocado 1kg', needed({ qty: 1, name: avo.name }, avo), { qty: 1000, unit: 'g' })
eq('needed no size → pack', needed({ qty: 3, name: 'Bananas' }), { qty: 3, unit: 'pack' })
eq('costFor pork 1.6kg × $17.99', Math.round(costFor(pork, 1) * 100) / 100, 28.78)
eq('costFor chicken 1kg × $12.79', costFor(chicken, 1), 12.79)
eq('costFor each ×2', costFor(avo, 2), 12)
eq('costFor multibuy 2 for $5, qty 3', costFor({ price: 3, multi_buy: { qty: 2, total: 5 } }, 3), 8)

// estimate
const pnsPork = { name: 'NZ Pork Shoulder Roast', size: 'kg', price: 11.49, price_unit: 'kg', unit_price: 11.49, unit_price_unit: 'kg' }
const pnsAvo = { name: 'Avocado', size: 'ea', price: 0.99, price_unit: 'each', unit_price: null, unit_price_unit: null }
const nwAvo = { name: 'Prepacked Avocados', size: '1kg', price: 4.99, price_unit: 'each', unit_price: 4.99, unit_price_unit: 'kg' }
const cost = (e: ReturnType<typeof estimate>) => ('cost' in e ? e.cost : e)
eq('estimate pork 1.6kg @ $11.49/kg', cost(estimate({ qty: 1600, unit: 'g' }, pnsPork, { name: pork.name, qty: 1 })), 18.38)
eq('estimate avocado 1kg vs each → count 5', estimate({ qty: 1000, unit: 'g' }, pnsAvo, { name: avo.name, qty: 1 }), { needsCount: true, guess: 5 })
eq('estimate avocado 1kg vs each, qty 2 → count 10', estimate({ qty: 2000, unit: 'g' }, pnsAvo, { name: avo.name, qty: 2 }), { needsCount: true, guess: 10 })
eq('estimate avocado 1kg vs 1kg bag', cost(estimate({ qty: 1000, unit: 'g' }, nwAvo, { name: avo.name, qty: 1 })), 4.99)
eq('estimate 500g sausages vs 6pk → no guess', estimate({ qty: 6, unit: 'ea' }, { name: 'Sausages', size: '500g', price: 9, price_unit: 'each' }, { name: 'Sausages 6pk', qty: 1 }), { needsCount: true, guess: null })
eq('packBigger 400g need vs 600g', packBigger({ qty: 400, unit: 'g' }, { name: 'Mince 600g', price: 9 }), true)
eq('packBigger 1kg need vs 1kg', packBigger({ qty: 1000, unit: 'g' }, nwAvo), false)
eq('packBigger kg-sold never', packBigger({ qty: 400, unit: 'g' }, pnsPork), false)

// nameClean / cleanWords / searchWords / coverage
eq('nameClean Essentials', nameClean('Woolworths Essentials Chicken Breast Pieces'), 'chicken breast pieces')
eq('nameClean Odd Bunch', nameClean('The Odd Bunch Fresh Avocado (Minimum 5 Per Pack) 1kg'), 'avocado')
eq('nameClean pork', nameClean('Woolworths NZ Free Farmed Pork Shoulder Roast Boneless Min Order 1.6kg'), 'pork shoulder roast boneless')
eq('nameClean Pams Finest', nameClean('Pams Finest Smoked Salmon 100g'), 'smoked salmon')
eq('nameClean 6 x 330ml', nameClean('Coca-Cola Classic 6 x 330ml'), 'coca cola classic')
eq('nameClean brand arg', nameClean('Tegel Skinless Chicken Breast', 'Tegel'), 'skinless chicken breast')
eq('searchWords chicken', searchWords('Woolworths Essentials Chicken Breast Pieces'), ['chicken', 'breast'])
eq('searchWords berries', searchWords('Frozen Mixed Berries 1kg'), ['frozen', 'mixed'])
eq('searchWords avocado', searchWords('Woolworths Fresh Avocados Hass'), ['avocado', 'hass'])
const item = cleanWords('Woolworths NZ Free Farmed Pork Shoulder Roast Boneless Min Order 1.6kg')
eq('coverage pork vs PNS Pork Shoulder Roast', coverage(item, cleanWords('NZ Pork Shoulder Roast')), 0.75)
eq('coverage pork vs NW Pork Boneless Roast (no cut named)', coverage(item, cleanWords('NZ Pork Boneless Roast')), 0.75)
eq('coverage pork vs Pork Leg Roast (other cut)', coverage(item, cleanWords('NZ Pork Leg Roast')), 0)
const ch = cleanWords('Woolworths Essentials Chicken Breast Pieces')
eq('coverage chicken vs Skinless Chicken Breast', Math.round(coverage(ch, cleanWords('Skinless Chicken Breast')) * 100) / 100, 0.67)
eq('coverage chicken vs Chicken Thigh Pieces', coverage(ch, cleanWords('Chicken Thigh Pieces')), 0)
eq('coverage chicken vs Smoked Chicken Breast', coverage(ch, cleanWords('Smoked Chicken Breast')), 0)
eq('coverage chicken vs Chicken Breast Satay Kebabs', coverage(ch, cleanWords('Free Range Chicken Breast Satay Kebabs')), 0)

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
