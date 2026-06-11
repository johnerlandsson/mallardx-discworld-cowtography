# Annotation Font Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Inkscape renders annotation text with identical font metrics to the plugin browser view, on all platforms, by bundling Noto Sans and injecting an embedded `<style>` block into each SVG.

**Architecture:** Bundle a Latin-subsetted Noto Sans WOFF2 in `ui/fonts/`. Add `@font-face` + explicit font-family to `mapper.css`. Update `sync-svg-js.mjs` to inject a `<style id="inkscape-font-fix">` block into each SVG (writing back to disk) so Inkscape picks up the font by name without needing to load external CSS.

**Tech Stack:** Python fonttools (one-time font subsetting), Node.js ESM, vitest.

---

## File Map

| File | Action |
|---|---|
| `ui/fonts/NotoSans.woff2` | **Create** — subsetted Latin WOFF2, one-time pyftsubset step |
| `ui/fonts/OFL.txt` | **Create** — Noto Sans license (SIL OFL 1.1) |
| `ui/mapper.css` | **Modify** — add `@font-face`; change `font-family: sans-serif` → `"Noto Sans", sans-serif` in 7 classes |
| `scripts/sync-svg-js.test.mjs` | **Create** — vitest tests for `injectFontStyle` |
| `scripts/sync-svg-js.mjs` | **Modify** — export `injectFontStyle`; write updated SVG back to `.svg` file before writing `.js` module |
| `docs/annotation-guide.md` | **Create** — human guide for annotating maps in Inkscape |

---

### Task 1: Bundle Noto Sans WOFF2

**Files:**
- Create: `ui/fonts/NotoSans.woff2`
- Create: `ui/fonts/OFL.txt`

- [ ] **Step 1: Install fonttools**

```bash
pip3 install fonttools brotli
```

Expected: installs without error. `brotli` is required for WOFF2 output.

- [ ] **Step 2: Create the fonts directory**

```bash
mkdir ui/fonts
```

- [ ] **Step 3: Subset the font**

```bash
pyftsubset /usr/share/fonts/google-noto-vf/NotoSans[wght].ttf \
  --output-file=ui/fonts/NotoSans.woff2 \
  --flavor=woff2 \
  --unicodes="U+0020-00FF" \
  --layout-features="*"
```

Expected: `ui/fonts/NotoSans.woff2` created. Verify it is under 120 KB:

```bash
ls -lh ui/fonts/NotoSans.woff2
```

- [ ] **Step 4: Copy the OFL license**

```bash
cp /usr/share/licenses/google-noto-color-emoji-fonts/OFL.txt ui/fonts/OFL.txt
```

Verify it begins with "Copyright" and mentions "SIL Open Font License":

```bash
head -4 ui/fonts/OFL.txt
```

- [ ] **Step 5: Commit**

```bash
git add ui/fonts/NotoSans.woff2 ui/fonts/OFL.txt
git commit -m "feat(annotation-font): bundle Noto Sans Latin WOFF2 subset"
```

---

### Task 2: Update mapper.css

**Files:**
- Modify: `ui/mapper.css`

- [ ] **Step 1: Add `@font-face` at the top of mapper.css**

Insert as the very first rule, before the `:root` block:

```css
@font-face {
  font-family: "Noto Sans";
  src: url("fonts/NotoSans.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
}
```

- [ ] **Step 2: Update the seven annotation text classes**

Find and replace `font-family: sans-serif` → `font-family: "Noto Sans", sans-serif` in these seven lines (all currently in the `/* UU Library overlay */` and `/* Semantic classes */` sections):

- `.lib-table`
- `.lib-gap-label`
- `.lib-book-label`
- `.lib-row-num`
- `.lib-book-list`
- `.map-label`
- `.map-label-muted`

After the edit, verify no bare `font-family: sans-serif` remains in annotation classes:

```bash
grep "font-family: sans-serif" ui/mapper.css
```

Expected: no output (the body font on line 14 uses a different stack and is not affected).

- [ ] **Step 3: Commit**

```bash
git add ui/mapper.css
git commit -m "feat(annotation-font): add @font-face and explicit Noto Sans in annotation classes"
```

---

### Task 3: injectFontStyle in sync-svg-js.mjs

**Files:**
- Create: `scripts/sync-svg-js.test.mjs`
- Modify: `scripts/sync-svg-js.mjs`

- [ ] **Step 1: Write failing tests**

Create `scripts/sync-svg-js.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest'
import { injectFontStyle, FONT_STYLE_BLOCK } from './sync-svg-js.mjs'

const SELF_CLOSING_SVG = `<svg>
  <defs
     id="defs8" />
  <g id="layer-artwork" />
</svg>`

describe('injectFontStyle', () => {
  it('injects style block after self-closing defs when none present', () => {
    const result = injectFontStyle(SELF_CLOSING_SVG)
    const defsEnd  = result.indexOf('/>') + 2
    const stylePos = result.indexOf('<style id="inkscape-font-fix">')
    const layerPos = result.indexOf('<g id="layer-artwork"')
    expect(stylePos).toBeGreaterThan(defsEnd)
    expect(stylePos).toBeLessThan(layerPos)
  })

  it('replaces an existing inkscape-font-fix block without duplication', () => {
    const stale = `<style id="inkscape-font-fix">\n.map-label { font-family: "Old Font"; }\n</style>`
    const svg = `<svg>\n  <defs id="defs8" />\n  ${stale}\n</svg>`
    const result = injectFontStyle(svg)
    const count = (result.match(/inkscape-font-fix/g) || []).length
    expect(count).toBe(1)
    expect(result).not.toContain('Old Font')
  })

  it('injected block contains Noto Sans for all annotation classes', () => {
    const result = injectFontStyle(SELF_CLOSING_SVG)
    expect(result).toContain('"Noto Sans", sans-serif')
    expect(result).toContain('.map-label')
    expect(result).toContain('.map-label-muted')
    expect(result).toContain('.lib-table')
    expect(result).toContain('.lib-gap-label')
    expect(result).toContain('.lib-book-label')
    expect(result).toContain('.lib-row-num')
    expect(result).toContain('.lib-book-list')
  })

  it('FONT_STYLE_BLOCK export contains the id marker', () => {
    expect(FONT_STYLE_BLOCK).toContain('id="inkscape-font-fix"')
    expect(FONT_STYLE_BLOCK).toContain('"Noto Sans", sans-serif')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run scripts/sync-svg-js.test.mjs
```

Expected: FAIL — `injectFontStyle is not a function` (or similar import error).

- [ ] **Step 3: Export FONT_STYLE_BLOCK and injectFontStyle from sync-svg-js.mjs**

Add these exports at the top of `scripts/sync-svg-js.mjs`, before the existing imports section:

```javascript
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run scripts/sync-svg-js.test.mjs
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Update the main sync loop to write SVG back to disk**

Replace the existing loop body in `scripts/sync-svg-js.mjs`:

```javascript
for (const file of svgs) {
  const svgPath = path.join(OUT_DIR, file)
  const jsPath  = svgPath.replace('.svg', '.js')
  const svg     = await fs.readFile(svgPath, 'utf8')
  await fs.writeFile(jsPath, `export default ${JSON.stringify(svg)};\n`, 'utf8')
  console.log(`  synced  ${file}`)
}
```

With:

```javascript
for (const file of svgs) {
  const svgPath    = path.join(OUT_DIR, file)
  const jsPath     = svgPath.replace('.svg', '.js')
  const svg        = await fs.readFile(svgPath, 'utf8')
  const updatedSvg = injectFontStyle(svg)
  await fs.writeFile(svgPath, updatedSvg, 'utf8')
  await fs.writeFile(jsPath, `export default ${JSON.stringify(updatedSvg)};\n`, 'utf8')
  console.log(`  synced  ${file}`)
}
```

- [ ] **Step 6: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: all tests pass (vitest + lua tests).

- [ ] **Step 7: Run sync and verify SVGs are updated**

```bash
node scripts/sync-svg-js.mjs
```

Expected: output lists all `.svg` files. Then verify the style block was injected:

```bash
grep -l "inkscape-font-fix" ui/maps/*.svg | wc -l
```

Expected: same count as total SVGs:

```bash
ls ui/maps/*.svg | wc -l
```

Both numbers should match.

- [ ] **Step 8: Commit**

```bash
git add scripts/sync-svg-js.test.mjs scripts/sync-svg-js.mjs ui/maps/*.svg ui/maps/*.js
git commit -m "feat(annotation-font): inject Noto Sans style block into SVGs via sync script"
```

---

### Task 4: Write annotation guide

**Files:**
- Create: `docs/annotation-guide.md`

- [ ] **Step 1: Create the guide**

Create `docs/annotation-guide.md` with the following content:

```markdown
# SVG Map Annotation Guide

Maps are SVG files in `ui/maps/`. The build script regenerates rooms and exits; you hand-craft labels, area fills, and annotation boxes in Inkscape.

## Setup

After cloning or pulling, run once to inject the font styles into the SVGs:

    npm run sync:svg

Then open any `ui/maps/*.svg` in Inkscape. The font selector should show **Noto Sans** for annotation text elements with no warning icon.

## Workflow

1. Open the map SVG in Inkscape
2. Work only in the **`layer-artwork`** layer (see Layers section)
3. Save in Inkscape (Ctrl+S)
4. Run `npm run sync:svg` to update the `.js` modules used by the plugin
5. Reload the plugin in Mallard to see your changes

## Text

Set `font-size` directly as an SVG attribute on each text element — use the XML editor (Shift+Ctrl+X) or the font size field in the toolbar. The CSS class controls `font-family` only.

Use `text-anchor` and `dominant-baseline` attributes to control alignment (e.g. `text-anchor="middle"` for centred labels).

Do not override `font-family` in Inkscape after assigning a class — the class controls it.

## CSS Classes

Use the XML editor (Shift+Ctrl+X) to set the `class` attribute on elements.

### Text

| Class | Use | Size |
|---|---|---|
| `map-label` | Standard label (place name, note) | 10px |
| `map-label-muted` | Secondary / de-emphasised label | 10px |

### Geometry

| Class | Use |
|---|---|
| `anno-box` | Annotation box (bg-elevated fill, fg stroke 0.75) |
| `anno-rule` | Horizontal divider inside an anno-box (40% opacity) |
| `map-area-fill` | Area background fill |
| `map-area-stroke` | Area outline (no fill) |
| `map-water` | Water / river fill |
| `map-accent` | Accent-coloured element |
| `exit` | Room connection line |

### UU Library

| Class | Use | Size |
|---|---|---|
| `lib-table` | Table label | 12px bold |
| `lib-gap` | Gap tile fill | — |
| `lib-gap-label` | Gap tile label | 12px bold |
| `lib-book` | Book tile fill | — |
| `lib-book-label` | Book tile label | 12px bold |
| `lib-row-num` | Row number (muted) | 9px |
| `lib-book-list` | Book list text | 9px |

## Colours in Inkscape

Inkscape cannot resolve CSS variables (`var(--fg)` etc.), so fills and strokes will appear as black or missing. This is expected — font metrics and size are what matter for positioning. The theme colours are applied at runtime by the plugin.

## The anno-box Pattern

An annotation box is:
1. A `<rect>` with `class="anno-box"`
2. Optionally a `<line>` or `<path>` with `class="anno-rule"` as a divider
3. `<text>` elements with `class="map-label"` for content

## Layers

Work only in **`layer-artwork`**. Other layers (rooms, exits, labels) are managed by the build script and will be overwritten on the next `build:svg` run. Use Inkscape's Layers panel (Layer → Layers…) to confirm you are on the correct layer before drawing.
```

- [ ] **Step 2: Commit**

```bash
git add docs/annotation-guide.md
git commit -m "docs: add SVG map annotation guide for Inkscape workflow"
```
