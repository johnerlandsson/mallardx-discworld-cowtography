# Annotation Font Consistency Design

**Goal:** Make Inkscape render annotation text with the same font metrics as the browser, so text positions set in Inkscape are accurate in the running plugin — on all platforms.

**Problem:** SVG text elements use CSS classes (e.g. `class="map-label"`) whose `font-family: sans-serif` is defined only in the external `mapper.css`. Inkscape doesn't load external CSS, so it falls back to its own default and shows a "font not found" warning. The resulting layout diverges from what the browser renders, making it hard to position text accurately. Additionally, `sans-serif` resolves to different concrete fonts on different OSes (Noto Sans on Linux, Arial on Windows, Helvetica on macOS), so even if Inkscape is fixed, distributed users would see different text widths.

---

## Changes

### 1. Bundle Noto Sans WOFF2

**Files:** `ui/fonts/NotoSans.woff2`, `ui/fonts/OFL.txt`

Subset `NotoSans[wght].ttf` (system font at `/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf`) to Basic Latin + Latin-1 Supplement (U+0020–U+00FF) using `pyftsubset` from Python `fonttools`. Expected output size: ~50–80 KB.

```bash
pyftsubset /usr/share/fonts/google-noto-vf/NotoSans[wght].ttf \
  --output-file=ui/fonts/NotoSans.woff2 \
  --flavor=woff2 \
  --unicodes="U+0020-00FF" \
  --layout-features="*"
```

Include the OFL 1.1 license text at `ui/fonts/OFL.txt`. Noto Sans is licensed under SIL OFL 1.1, which permits bundling and redistribution in software without user-visible attribution.

The WOFF2 file is committed to the repo — this is a one-time step with no ongoing build requirement.

### 2. `mapper.css` — font-face + class updates

Add a `@font-face` declaration at the top of `mapper.css`:

```css
@font-face {
  font-family: "Noto Sans";
  src: url("fonts/NotoSans.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
}
```

Replace `font-family: sans-serif` with `font-family: "Noto Sans", sans-serif` in the seven annotation text classes:
`.map-label`, `.map-label-muted`, `.lib-table`, `.lib-gap-label`, `.lib-book-label`, `.lib-row-num`, `.lib-book-list`.

Browser rendering: uses the bundled WOFF2 → identical Noto Sans metrics on all platforms.

### 3. `sync-svg-js.mjs` — inject embedded `<style>` into SVGs

After reading each SVG and before writing the `.js` module, the script injects (or replaces) a `<style id="inkscape-font-fix">` block inside the SVG's `<defs>` element.

Block content:

```css
.map-label, .map-label-muted,
.lib-table, .lib-gap-label, .lib-book-label,
.lib-row-num, .lib-book-list {
  font-family: "Noto Sans", sans-serif;
}
```

**Injection logic:**
- If `<style id="inkscape-font-fix">` already exists in the SVG string, replace it (string replace on the full block).
- If not found, insert it immediately after the `<defs ... />` line (the defs element is self-closing in all current SVGs; inject as a sibling, not a child).

The script writes the updated SVG string back to the `.svg` file (new behavior) AND writes the `.js` module from the same string (existing behavior). Both outputs include the embedded style block.

Inkscape reads embedded `<style>` blocks natively and finds "Noto Sans" by name from the system font (already installed at `/usr/share/fonts/google-noto-vf/`). No `@font-face` is needed inside the SVG — Inkscape uses the system font directly.

The embedded style is also present in the inlined SVG at runtime. The browser sees two rules saying the same thing (embedded style + external mapper.css) — no conflict.

**Inkscape workflow:** unchanged. Edit in Inkscape → `npm run sync:svg` → done. Inkscape preserves `<style>` blocks it doesn't own across save cycles.

---

## File Map

| File | Change |
|---|---|
| `ui/fonts/NotoSans.woff2` | **Create** (one-time pyftsubset step) |
| `ui/fonts/OFL.txt` | **Create** (Noto Sans license) |
| `mapper.css` | **Modify** — add `@font-face`; update font-family in 7 classes |
| `scripts/sync-svg-js.mjs` | **Modify** — inject `<style id="inkscape-font-fix">` into each SVG, write updated SVG back to disk |
| `ui/maps/*.svg` | **Updated by sync script** — gains embedded `<style>` block on first sync run |
| `ui/maps/*.js` | **Updated by sync script** — same as today, now also includes the embedded style |

---

## Out of Scope

- Subsetting to only the characters actually used in map labels (the Basic Latin range is sufficient and simple).
- Changes to how `font-size` is set (currently as SVG presentation attributes on individual elements; that stays as-is).
- Any other Inkscape WYSIWYG improvements (colours, stroke widths, etc.).
