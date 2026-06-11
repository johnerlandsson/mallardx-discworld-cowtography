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
