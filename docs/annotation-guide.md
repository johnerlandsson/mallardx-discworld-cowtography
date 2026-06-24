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
| `map-label-warning` | Danger / caution label (red) | 10px |

### Geometry

| Class | Use |
|---|---|
| `anno-box` | Annotation box (bg-elevated fill, fg stroke 0.75) |
| `anno-rule` | Horizontal divider inside an anno-box (40% opacity) |
| `city-sign` | City name plate rectangle (bg-elevated fill, fg stroke 1) |
| `city-sign-label` | City name text (fg, bold, Noto Sans) |
| `map-area-fill` | Area background fill |
| `map-area-stroke` | Area outline (no fill) |
| `map-water` | Water / river fill |
| `map-accent` | Accent-coloured element |
| `room-phantom` | Room present on Quow's map but absent from the DB (muted outline) |
| `exit` | Room connection line |
| `exit-offmap` | Dashed line to a cross-map exit label |
| `exit-journey` | Inter-town journey path (muted colour, same weight as exit) |
| `exit-journey-offmap` | Journey path exiting off-map (muted, dashed) |
| `exit-ferry` | Ferry route (water blue, dotted) |
| `exit-climb` | Climbing or crawling exit (dash-dot, same grey as `exit`) — also driven by `exit-climb.json` |
| `exit-nopass` | Impassable exit — connection exists in the DB but cannot be traversed (sparse short dashes) |
| `map-river` | River or stream line (water blue, same weight as exit) |
| `map-river-offmap` | River exiting off-map (water blue, dashed) |

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

## Phantom Rooms

Some rooms appear on Quow's original maps but are absent from the database. Draw these manually in `layer-artwork` using `class="room-phantom"` so they render in the muted theme colour rather than the normal foreground, making them visually distinct from DB-backed rooms.

### Shapes and sizes

Match the same dimensions as auto-generated rooms:

| Type | Element | Attributes |
|---|---|---|
| Outdoor | `<circle>` | `r="4"` |
| Indoor | `<rect>` | `width="8" height="8" x="cx-4" y="cy-4"` |
| Compact outdoor | `<circle>` | `r="1.5"` |
| Compact indoor | `<rect>` | `width="3" height="3" x="cx-1.5" y="cy-1.5"` |

### Inkscape visibility

Add these presentation attributes so the shape is visible while drawing:

| Attribute | Value |
|---|---|
| `fill` | `#1a1a1a` |
| `stroke` | `#888888` |
| `stroke-width` | `0.5` |

### Connecting phantom rooms

Use `class="exit-journey"` lines in `layer-artwork` to connect phantom rooms to each other or to real rooms — they share the same muted colour and visual weight.

## City Signs

City signs label towns on regional maps (ramtops, sto_plains, etc.). Each sign is a bold name plate: a tight rectangle behind the city name.

### Structure

```svg
<rect class="city-sign" x="95" y="117" width="46" height="10"/>
<text class="city-sign-label" text-anchor="middle" font-size="8" x="118" y="125">Lancre Town</text>
```

### Sizing rules

- **Font size:** 8 SVG units (set as `font-size` attribute)
- **Padding:** 3 units left/right around the text
- **Rect width:** measure the rendered text width in Inkscape (W field), then add 6 (3 each side)
- **Rect height:** 10 for 8px text — adjust visually in Inkscape until the text sits centred
- **Text anchor:** `middle` — place the text `x` at the horizontal centre of the rect
- Do **not** use `dominant-baseline` — it renders differently in Inkscape vs the browser

### Workflow

1. Place a `<text>` element in `layer-artwork`, set `class="city-sign-label"`, `font-size="8"`, `text-anchor="middle"`, and type the city name
2. In Inkscape's toolbar, note the rendered text width (W field)
3. Calculate rect width: `textW + 6`. Set rect height to 10
4. Calculate rect x: `textX - width/2`. Set rect y so the text sits visually centred — adjust in Inkscape
5. Place a `<rect>` with `class="city-sign"` using those values — it must sit **before** the `<text>` in the SVG so the text renders on top
6. Add presentation attributes `fill="#0f0f0f"` and `stroke="#eaeaea"` to the rect so both are visible in Inkscape

### Inkscape visibility

Add these presentation attributes so elements are visible in Inkscape (CSS overrides them at runtime):

| Element | Attribute | Value |
|---|---|---|
| `<rect class="city-sign">` | `fill` | `#0f0f0f` |
| `<rect class="city-sign">` | `stroke` | `#eaeaea` |
| `<text class="city-sign-label">` | `fill` | `#eaeaea` |

## World Map (discwhole.svg)

The world map is entirely hand-crafted — `build:svg` never touches it. The coordinate space matches GMCP exactly (5809 × 5000) so game positions place the player dot with no transformation.

### Layers

| Layer | Purpose | Notes |
|---|---|---|
| `layer-base` | Dark "here be dragons" background | Do not edit — contains the watermark pattern |
| `layer-terrain` | Biome fills | Add paths here |
| `layer-labels` | Ocean and region names | Add text here |
| `layer-player` | Player position dot | Do not edit |

Work only in **`layer-terrain`** and **`layer-labels`**. Always keep `layer-player` as the topmost layer.

### Terrain paths

Paint terrain regions as closed `<path>` elements in `layer-terrain`. After drawing, give each path an **`inkscape:label`** in the XML editor — this is how `sync:svg` assigns the CSS class.

Labels follow the `NameNN` convention (e.g. `Forrest01`, `Forrest02`) so multiple separate paths can share the same terrain type. The trailing number is stripped when assigning the CSS class.

| inkscape:label | CSS class | Dark | Light |
|---|---|---|---|
| `Mountain01`, `Mountain02`, … | `terrain-mountain` | `#595959` | `#b0b0b0` |
| `Gorge01`, … | `terrain-gorge` | `#383838` | `#787878` |
| `Desert01`, … | `terrain-desert` | `#7a5a1a` | `#c8a050` |
| `Water01`, … | `terrain-water` | `#1a3a5c` | `#5090c0` |
| `Tundra01`, … | `terrain-tundra` | `#4a5020` | `#888a50` |
| `Grass01`, … | `terrain-grass` | `#2a6a2a` | `#50a050` |
| `DenseForrest01`, … | `terrain-dense-forrest` | `#0d2a0e` | `#1a6a18` |
| `DarkForrest01`, … | `terrain-dark-forrest` | `#133a17` | `#27722c` |
| `Forrest01`, … | `terrain-forrest` | `#1a4a20` | `#357a40` |
| `Plains01`, … | `terrain-plains` | `#4a6a20` | `#90b840` |
| `Field01`, … | `terrain-field` | `#5e7a28` | `#a0c038` |
| `Lowlands01`, … | `terrain-lowlands` | `#546e24` | `#96b03c` |
| `Ice01`, … | `terrain-ice` | `#4888a8` | `#88c0d8` |
| `Snow01`, … | `terrain-snow` | `#d8d8d4` | `#f4f4f0` |
| `Beach01`, … | `terrain-beach` | `#c8b870` | `#e8d888` |

**Inkscape visibility:** CSS classes don't resolve inside Inkscape. Add a `fill` attribute (or Inkscape's `style="display:inline;fill:#..."`) on the path so you can see what you're painting. At runtime, `sync:svg` strips this inline fill and the CSS class takes over.

### Stroked terrain types

Roads and rivers are open paths (`fill: none`) with a stroke, not closed fills. Use the same `inkscape:label` convention.

| inkscape:label | CSS class | Stroke (dark) | Stroke (light) |
|---|---|---|---|
| `Road01`, … | `terrain-road` | `#d4904a` | `#7a4818` |
| `River01`, … | `terrain-river` | `#1a3a5c` | `#5090c0` |

Both use `stroke-width: 1`, `stroke-linecap: round`, `stroke-linejoin: round`.

### Location markers

`Location01`, … → `terrain-location`: small filled circles marking named locations (`fill: #e84040; stroke: #a02020; stroke-width: 0.5`). Use for city dots and major landmarks.

### Adding new terrain types

1. In Inkscape, label the path with a new `inkscape:label` using the `NameNN` convention (e.g. `Tundra01`)
2. Add the base name → CSS class entry to `WORLD_TERRAIN_LABELS` in `scripts/sync-svg-js.mjs`
3. Add dark and light CSS rules in `ui/mapper.css` following the existing pattern

### Text labels

Place `<text>` elements in `layer-labels` for ocean names, region labels, etc. `sync:svg` automatically adds `class="map-label"` to all text elements in the world map, so Noto Sans is applied at runtime. Set `font-size` as an SVG attribute for positioning. Use `fill="#c8a060"` (or similar) as a presentation attribute so labels are visible in Inkscape.

### Workflow

1. Edit `ui/maps/discwhole.svg` in Inkscape, working in `layer-terrain` or `layer-labels`
2. Save in Inkscape
3. Run `npm run sync:svg` — this strips inline styles, injects terrain classes, and bundles the SVG
4. Reload the plugin in Mallard

`build:svg` is never needed for the world map.

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
