// Copies data/taxonomy-zh.json from the repo root into src/data when it exists.
// The file is generated outside this app; until it appears we ship an empty map.
import { copyFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../data/taxonomy-zh.json')
const dest = resolve(here, '../src/data/taxonomy-zh.json')
mkdirSync(dirname(dest), { recursive: true })
if (existsSync(src)) copyFileSync(src, dest)
else if (!existsSync(dest)) writeFileSync(dest, '{}\n')
