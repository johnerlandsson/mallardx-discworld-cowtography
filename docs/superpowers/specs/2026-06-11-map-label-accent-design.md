# map-label-accent Design

**Goal:** Add a `map-label-accent` CSS class for annotation text that needs strong visual emphasis, using the theme accent colour.

---

## Changes

### `ui/mapper.css`

Add alongside `.map-label` and `.map-label-muted`:

```css
.map-label-accent { fill: var(--accent); font-size: 10px; font-family: "Noto Sans", sans-serif; }
```

### `scripts/sync-svg-js.mjs`

Add `.map-label-accent` to the selector list in `FONT_STYLE_BLOCK` so Inkscape picks up the Noto Sans font for this class:

```css
.map-label, .map-label-muted, .map-label-accent,
.lib-table, .lib-gap-label, .lib-book-label,
.lib-row-num, .lib-book-list {
  font-family: "Noto Sans", sans-serif;
}
```

Run `npm run sync:svg` after the change to push the updated embedded style into all SVG files and their `.js` modules.

### `docs/annotation-guide.md`

Add a row to the Text table:

| Class | Use | Size |
|---|---|---|
| `map-label-accent` | Strong highlight (accent colour) | 10px |

---

## Out of Scope

- Changing font size or weight (accent colour alone is the highlight signal)
- Any new classes beyond `map-label-accent`
