# Street Name Toggle — Design Spec

**Date:** 2026-06-20
**Status:** Approved

## Overview

Add a `layer-streets` SVG group to map files for manually-authored street name text elements, and a toggle button in the panel footer that shows or hides all street names across every map.

## SVG Structure

Maps that have street names get a new group inserted between `layer-rooms` and `layer-room-labels`:

```xml
<g id="layer-streets"><!-- streets --></g>
```

The author adds `<text>` elements inside this group manually, then regenerates the JS bundle with `node scripts/sync-svg-js.mjs`. Maps without the group are unaffected — the CSS rule has nothing to match and is silently a no-op.

**Paint order** (bottom to top within the SVG):
1. `layer-artwork`
2. `layer-exits`
3. `layer-rooms`
4. `layer-streets` ← new, street names render over rooms
5. `layer-room-labels`
6. `layer-labels`

## Toggle Mechanics

A CSS class `streets-hidden` on `document.documentElement` drives visibility:

```css
:root.streets-hidden #layer-streets { display: none; }
```

**Default state:** visible (no class present).

**Persistence:** `localStorage` key `"cowtography.streets"`. Value `"1"` = visible (default when key is absent), `"0"` = hidden.

**Initialisation:** on page load, JS reads the stored value and adds `streets-hidden` to `:root` if the stored value is `"0"`.

**On click:** toggle `streets-hidden` on `:root`, write updated value to `localStorage`.

Because the class lives on `:root` (not on the SVG element), it survives every map swap with zero per-load code.

## Footer Button

A `<button class="streets-toggle">` is inserted as the **first child** of `.route-footer`, left-aligned. The existing `route-dest` span has `flex:1` so it fills the remaining space and the route buttons (walk, clear) stay right-aligned.

```
[streets]  route destination text…          [walk] [✕]
```

**Label:** `streets` (plain text, no icon — clearer in a small footer context).

**Size:** matches the header zoom buttons (`height: 18px`, `font-size: 10px`, compact padding).

**Visual state:**
- Streets visible (on): `background: color-mix(in srgb, var(--fg) 20%, transparent)` — slightly elevated, looks active
- Streets hidden (off): `background: color-mix(in srgb, var(--fg) 10%, transparent)` — dim, matches default button resting state

## Files Changed

| File | Change |
|------|--------|
| `ui/mapper.html` | Add `<button class="streets-toggle" type="button">streets</button>` as first child of `.route-footer` |
| `ui/mapper.css` | Add `.streets-toggle` button styles and `:root.streets-hidden #layer-streets { display: none; }` |
| `ui/mapper.js` | Read localStorage on init, wire button click handler |
| `ui/maps/*.svg` | Author adds `<g id="layer-streets">` manually when adding street names to a map |
| `ui/maps/*.js` | Regenerated via `node scripts/sync-svg-js.mjs` after each SVG edit |
