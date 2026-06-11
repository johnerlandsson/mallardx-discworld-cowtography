// scripts/sync-svg-js.mjs
// Syncs ui/maps/*.js modules from their corresponding *.svg files.
// Run after hand-editing SVGs in Inkscape (or similar).
// Usage: node scripts/sync-svg-js.mjs

export const FONT_STYLE_BLOCK = `<style id="inkscape-font-fix">
.map-label, .map-label-muted,
.lib-table, .lib-gap-label, .lib-book-label,
.lib-row-num, .lib-book-list {
  font-family: "Noto Sans", sans-serif;
}
</style>`

export function injectFontStyle(svg) {
  // Replace existing block if present
  if (svg.includes('<style id="inkscape-font-fix">')) {
    return svg.replace(/<style id="inkscape-font-fix">[\s\S]*?<\/style>/, FONT_STYLE_BLOCK)
  }
  // Inject as sibling after self-closing <defs ... />
  // [^>]* matches across newlines (Inkscape writes defs as a two-line self-closing tag)
  return svg.replace(/(<defs[^>]*\/>)/, `$1\n  ${FONT_STYLE_BLOCK}`)
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
