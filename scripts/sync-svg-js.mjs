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
  // (Re-)inject after <defs> — handles both self-closing (<defs ... />) and open-tag
  // (<defs ...>) forms; Inkscape always writes the latter.
  return stripped.replace(/(<defs[^>]*\/?>)/, `$1\n  ${FONT_STYLE_BLOCK}`)
}

// Terrain types defined by inkscape:label on <path> elements in discwhole.svg.
// Add new terrain names here as you paint them in Inkscape.
const WORLD_TERRAIN_TYPES = ['Mountains', 'Desert', 'Plains', 'Water', 'Grass', 'Forrest']

export function processWorldMapSvg(svg) {
  for (const terrain of WORLD_TERRAIN_TYPES) {
    const cls = 'terrain-' + terrain.toLowerCase()
    // Add class attribute alongside the inkscape:label
    svg = svg.replace(
      new RegExp(`\\binkscape:label="${terrain}"`, 'g'),
      `class="${cls}" inkscape:label="${terrain}"`
    )
    // Strip the Inkscape inline style from the same path element.
    // SVG path data contains no > characters, so [^>]*? cannot cross the /> boundary.
    svg = svg.replace(
      new RegExp(`(\\s+style="[^"]*")([^>]*?)(\\s+class="${cls}")`, 'g'),
      '$2$3'
    )
  }
  // Add class="map-label" to all <text> elements that don't already have a class
  svg = svg.replace(/<text\b(?![^>]*\bclass=")/g, '<text class="map-label"')
  return svg
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
    // For the world map, apply terrain class injection only to the JS bundle —
    // not written back to the SVG so Inkscape keeps working with its own attributes.
    const jsSvg = file === 'discwhole.svg' ? processWorldMapSvg(updatedSvg) : updatedSvg
    await fs.writeFile(jsPath, `export default ${JSON.stringify(jsSvg)};\n`, 'utf8')
    console.log(`  synced  ${file}`)
  }

  console.log(`done — ${svgs.length} files synced.`)
}
