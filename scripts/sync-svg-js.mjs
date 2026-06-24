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

// Maps inkscape:label base name (without trailing digits) → CSS class.
// Paths may be labeled Name01, Name02, etc. to allow multiple paths of the same type.
// Add new entries here as you paint new terrain types in Inkscape.
const WORLD_TERRAIN_LABELS = {
  'Mountain':     'terrain-mountain',
  'Gorge':        'terrain-gorge',
  'Desert':       'terrain-desert',
  'Water':        'terrain-water',
  'Tundra':       'terrain-tundra',
  'Grass':        'terrain-grass',
  'DenseForrest': 'terrain-dense-forrest',
  'DarkForrest':  'terrain-dark-forrest',
  'Forrest':      'terrain-forrest',
  'Plains':       'terrain-plains',
  'Field':        'terrain-field',
  'Lowlands':     'terrain-lowlands',
  'Ice':          'terrain-ice',
  'Snow':         'terrain-snow',
  'Road':         'terrain-road',
  'River':        'terrain-river',
  'Beach':        'terrain-beach',
  'Location':     'terrain-location',
}

export function processWorldMapSvg(svg) {
  // Add class="map-svg" to the SVG root so CSS sizing rules apply.
  svg = svg.replace(/(<svg\b(?![^>]*\bclass="))/, '$1 class="map-svg"')

  for (const [label, cls] of Object.entries(WORLD_TERRAIN_LABELS)) {
    // Match inkscape:label="Name01", "Name02", etc. (trailing digits optional).
    // Capture the full label so we can preserve it in the replacement.
    svg = svg.replace(
      new RegExp(`\\binkscape:label="(${label}\\d*)"`, 'g'),
      `class="${cls}" inkscape:label="$1"`
    )
    // Dedup: Inkscape may already have a class attribute on the path (added via
    // the XML editor). The replace above produces a second class="..." — collapse it.
    svg = svg.replace(
      new RegExp(`class="${cls}"([^>]*?)class="${cls}"`, 'g'),
      `class="${cls}"$1`
    )
    // Strip the Inkscape inline style from the same path element.
    // SVG path data contains no > characters, so [^>]*? cannot cross the /> boundary.
    svg = svg.replace(
      new RegExp(`(\\s+style="[^"]*")([^>]*?)(\\s+class="${cls}")`, 'g'),
      '$2$3'
    )
  }
  // Remove any stale second terrain class that wasn't caught by dedup (different class name,
  // e.g. a path with inkscape:label="Tundra01" that was previously tagged terrain-plains).
  svg = svg.replace(/(class="terrain-[^"]*"[^>]*?)\s+class="terrain-[^"]*"/g, '$1')
  // Add class="map-label" to <text> elements in the visible layers only
  // (after </defs>) to avoid overriding fills on watermark pattern texts.
  const defsClose = svg.indexOf('</defs>')
  if (defsClose !== -1) {
    const head = svg.slice(0, defsClose + 7)
    const body = svg.slice(defsClose + 7)
    svg = head + body.replace(/<text\b(?![^>]*\bclass=")/g, '<text class="map-label"')
  }
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
