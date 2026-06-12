# SVG Map Annotation Guide

Maps are SVG files in `ui/maps/`. The build script regenerates rooms and exits; you hand-craft labels, area fills, and annotation boxes in Inkscape.

For configuring room types and compact rooms (JSON-based, no Inkscape), see [`docs/map-data-guide.md`](map-data-guide.md).

## Setup

After cloning or pulling, run once to inject the font styles into the SVGs:

    npm run sync:svg

Then open any `ui/maps/*.svg` in Inkscape. The font selector should show **Noto Sans** for annotation text elements with no warning icon.

## Workflow

1. Open the map SVG in Inkscape
2. Work in **`layer-artwork`** for background art, or **`layer-room-labels`** for in-room annotations (see Layers section)
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
| `map-label-accent` | Strong highlight (accent colour) | 10px |

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
| `exit-offmap` | Dashed line to a cross-map exit label |
| `exit-journey` | Inter-town journey path (muted colour, same weight as exit) |
| `exit-journey-offmap` | Journey path exiting off-map (muted, dashed) |
| `map-river` | River or stream line (water blue, same weight as exit) |

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

| Layer | Purpose | Preserved |
|---|---|---|
| `layer-artwork` | Background art, area fills, annotation boxes | ✓ |
| `layer-exits` | Exit lines — **do not edit** | generated |
| `layer-rooms` | Room shapes — **do not edit** | generated |
| `layer-room-labels` | In-room annotation text (see below) | ✓ |
| `layer-labels` | Map text labels, anno-boxes — **do not edit standard maps** | generated |

Work only in **`layer-artwork`** for background art and **`layer-room-labels`** for in-room annotations. Other layers are overwritten on every `build:svg` run.

## In-room annotations

You can place custom text (a letter, symbol, or short code) inside a room circle or square. These must go in **`layer-room-labels`** — this layer renders on top of room fills and is preserved across `build:svg` runs.

If `layer-room-labels` is not visible in Inkscape's layers panel, run `npm run build:svg` once to regenerate the SVG with the new layer.

### Finding the room center coordinates

Open the generated `.svg` in a text editor and search for the room's `id` attribute:

- **Outdoor circle:** `<circle id="room-XXXX" ... cx="100" cy="200" r="4"/>` → center is `(100, 200)`
- **Indoor rect:** `<rect id="room-XXXX" ... x="96" y="196" width="8" height="8"/>` → center is `x + 4, y + 4` = `(100, 200)`
- **Compact outdoor circle:** `r="2"` — center is still the `cx`/`cy` values
- **Compact indoor rect:** `width="4" height="4"` — center is `x + 2, y + 2`

The `data-label` attribute on room elements shows the room's short name, which can help you identify the right room.

### Text element attributes

Set these in the XML editor (Shift+Ctrl+X):

| Attribute | Value | Purpose |
|---|---|---|
| `class` | `room-type-label` | Noto Sans bold 4.5px, light fill |
| `text-anchor` | `middle` | Horizontal centering |
| `dominant-baseline` | `central` | Vertical centering |
| `x` | room center X | e.g. `100` |
| `y` | room center Y | e.g. `200` |

The `room-type-label` class sets `font-size: 4.5px; font-weight: bold; fill: #eaeaea` — use it for typed rooms (coloured fill). For plain rooms (grey fill), omit the class and set `fill="var(--fg)"` directly so the text matches the theme foreground colour.

Do not override `font-family` in Inkscape — the class controls it.

### Workflow

1. Run `npm run build:svg` to ensure `layer-room-labels` exists in the SVG
2. Open the SVG in Inkscape — switch to the `layer-room-labels` layer
3. Select the text tool (T), click at the room center to place a text element, type the letter or symbol, then open the XML editor (Shift+Ctrl+X) and set the attributes from the table above
4. Save in Inkscape
5. Run `npm run sync:svg` to update the `.js` module
6. Reload the plugin in Mallard
