// scripts/sync-svg-js.mjs
// Syncs ui/maps/*.js modules from their corresponding *.svg files.
// Run after hand-editing SVGs in Inkscape (or similar).
// Usage: node scripts/sync-svg-js.mjs

export const FONT_STYLE_BLOCK = `<style id="inkscape-font-fix">
text, .map-label, .map-label-muted, .map-label-accent,
.lib-table, .lib-gap-label, .lib-book-label,
.lib-row-num, .lib-book-list, .room-type-label {
  font-family: "Noto Sans", sans-serif;
}
</style>`

export function injectFontStyle(svg) {
  // Strip ALL existing inkscape-font-fix blocks including their leading whitespace.
  // Handles our single-line <style id="inkscape-font-fix"> and Inkscape's multi-line
  // re-encoding (<style\n   id="inkscape-font-fix">, with &quot; entities in content).
  const stripped = svg.replace(/\n[ \t]*<style\s+id="inkscape-font-fix">[\s\S]*?<\/style>/g, '')
  // (Re-)inject after self-closing <defs ... />; no-op if no <defs> present
  return stripped.replace(/(<defs[^>]*\/>)/, `$1\n  ${FONT_STYLE_BLOCK}`)
}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'maps')

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const svgs = (await fs.readdir(OUT_DIR)).filter(f => f.endsWith('.svg'))

  for (const file of svgs) {
    const svgPath    = path.join(OUT_DIR, file)
    const jsPath     = svgPath.replace(/\.svg$/, '.js')
    const svg        = await fs.readFile(svgPath, 'utf8')
    const updatedSvg = injectFontStyle(svg)
    if (updatedSvg !== svg) await fs.writeFile(svgPath, updatedSvg, 'utf8')
    await fs.writeFile(jsPath, `export default ${JSON.stringify(updatedSvg)};\n`, 'utf8')
    console.log(`  synced  ${file}`)
  }

  console.log(`done — ${svgs.length} files synced.`)
}
