// scripts/sync-svg-js.mjs
// Syncs ui/maps/*.js modules from their corresponding *.svg files.
// Run after hand-editing SVGs in Inkscape (or similar).
// Usage: node scripts/sync-svg-js.mjs

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'maps')

const svgs = (await fs.readdir(OUT_DIR)).filter(f => f.endsWith('.svg'))

for (const file of svgs) {
  const svgPath = path.join(OUT_DIR, file)
  const jsPath  = svgPath.replace('.svg', '.js')
  const svg     = await fs.readFile(svgPath, 'utf8')
  await fs.writeFile(jsPath, `export default ${JSON.stringify(svg)};\n`, 'utf8')
  console.log(`  synced  ${file}`)
}

console.log(`done — ${svgs.length} files synced.`)
