# PNG / SVG Map Style Toggle — Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a plugin setting that lets the user choose between the existing SVG vector maps and the classic PNG pixel-art maps from Quow's Cow Bar, with a clean architectural separation between the two rendering strategies.

**Architecture:** Extract SVG rendering into `ui/svg-renderer.js`, write PNG rendering in `ui/png-renderer.js`, and reduce `mapper.js` to a thin coordinator that holds state, handles panel events, and delegates to whichever renderer is active. Both renderers implement an identical interface so the coordinator is renderer-agnostic.

**Tech Stack:** Vanilla JS (ES modules), Mallard panel SDK (`panel.on`, `panel.post`, `settings`), HTML5 Canvas (PNG overlay), Mallard plugin settings (`plugin.toml` enum).

---

## Global Constraints

- All JS is ES modules (`import`/`export`), no build step.
- No new dependencies.
- Existing tests must continue passing.
- The SVG renderer must behave identically to the current `mapper.js` SVG logic — no behaviour regressions.
- PNG files live at `ui/maps/<name>.png`; the `discwhole.png` world map is already there.
- The pack script (`npm run pack`) requires no changes — it already includes `ui/maps/*.png`.
- Implementation goes on a feature branch, not `main`.
- `plugin.toml` `minimum_app_version` stays at `0.11.0`.

---

## Renderer Interface

Both renderers are ES classes that implement the following contract. The coordinator depends only on this interface, never on renderer internals.

```js
class SvgRenderer /* or PngRenderer */ {
  // container: the <div class="map-container"> DOM element
  // data:      { maps, rooms, terrain } from rooms.js
  // callbacks: { onRoomClick(roomId, name), onMapLoaded(mapId) }
  constructor(container, data, callbacks)

  // Load and display a map. Resolves when the map is mounted and ready.
  async load(mapId, centerX, centerY)

  // Re-render player position, route, and dark-mode indicator.
  // Called by the coordinator whenever any of these change.
  applyState({ current, target, routeRoomIds, darkMode })

  // Called when the container is resized (e.g. panel drag-resize).
  handleResize()

  // Remove all DOM elements and event listeners created by this renderer.
  destroy()

  // Static capability flags — coordinator uses these to gate UI features.
  supportsZoom:    boolean   // true for SVG, false for PNG
  supportsFilters: boolean   // true for SVG, false for PNG
}
```

Callbacks:
- `onRoomClick(roomId, name)` — user clicked a room; coordinator posts to Lua.
- `onMapLoaded(mapId)` — renderer finished loading a map; coordinator updates the header and posts `map_changed` to Lua.

---

## Setting

### `plugin.toml`

```toml
[settings.map_style]
type        = "enum"
default     = "svg"
label       = "Map style"
description = "SVG vector maps or classic pixel art PNG maps from Quow's Cow Bar."
choices = [
  { value = "svg", label = "SVG (vector)"            },
  { value = "png", label = "PNG (classic pixel art)"  },
]
```

### Lua → JS communication (`src/main.lua`)

On `ready`, send the current value alongside zoom and filters:

```lua
panel:post("map_style", { style = settings.get('map_style') or 'svg' })
```

On live change, fill in the existing `settings.on` stub:

```lua
settings.on("change", function(key, new_val, _old)
  if key == 'map_style' then
    panel:post("map_style", { style = new_val })
  end
end)
```

The coordinator handles `panel.on("map_style", ...)` by calling `switchRenderer(style)`, which destroys the current renderer, constructs the new one, and reloads the current map at the same position. Switching takes effect immediately with no panel reload.

---

## SVG Renderer (`ui/svg-renderer.js`)

An extraction of existing `mapper.js` logic. Nothing new is invented here — the goal is isolation, not rewriting.

**Owns:**
- SVG loading and DOM injection (`loadSvgMap` logic → `load()`)
- ViewBox / zoom state (`viewBox`, `applyViewBox`, `persistZoom`, `resetZoom`, `centerOnRoom`)
- Scroll-wheel zoom and keyboard pan/zoom event listeners
- Room element hit-testing on click → `callbacks.onRoomClick`
- `applyState()`: CSS class toggling (`.current`, `.target`, `.route`), overlay lifting, world-map dot positioning via `#world-player`
- Hover tooltip wiring (`wireTooltip`)
- Stack visibility (`updateStackVisibility`, `setStackRoomVisible`)
- Special screens: lspace animation, tshop animation, `showSpecialScreen` / `hideSpecialScreen`
- Library overlay (`applyLibraryOverlay`)
- Warp SVG defs (`ensureWarpDefs`)

**Capabilities:** `supportsZoom: true`, `supportsFilters: true`

**What does NOT move to the SVG renderer:**
- `panel.on(...)` event handlers — these stay in the coordinator
- Footer and header DOM — stays in the coordinator
- Zoom button click handlers — coordinator wires these to `renderer` methods when SVG is active
- `applyStreetsState` / `applyStairsState` — coordinator owns these; SVG renderer just renders in whatever state the document classes reflect

---

## PNG Renderer (`ui/png-renderer.js`)

Entirely new. Shares the same interface.

### DOM structure

```html
<div class="png-map-wrap" style="position:relative; display:inline-block;">
  <img class="png-map-img" src="ui/maps/<file>.png" style="display:block; max-width:100%;">
  <canvas class="png-map-canvas" style="position:absolute; inset:0; pointer-events:none;">
</div>
```

The wrap is appended into `$container`. Canvas dimensions are set to match the img's rendered size and updated on `handleResize()`.

### `load(mapId, centerX, centerY)`

1. Resolves the filename from `data.maps[mapId].file`.
2. Creates the `<img>` + `<canvas>` structure above.
3. Waits for `img.onload`.
4. Calls `applyState()` to draw the initial player/route overlay.
5. Calls `callbacks.onMapLoaded(mapId)`.

No zoom is applied. The image fills the container width at natural aspect ratio.

### Click → room lookup

On `pointerup` (with drag-distance guard, same as SVG renderer):

1. Convert click client coords to image-pixel coords:
   ```js
   const rect = img.getBoundingClientRect();
   const px = (e.clientX - rect.left) * (img.naturalWidth  / rect.width);
   const py = (e.clientY - rect.top)  * (img.naturalHeight / rect.height);
   ```
2. Collect all rooms on this map from `data.rooms`.
3. Find the room with the minimum Euclidean distance to `(px, py)`.
4. If distance ≤ `cellSize * 2`, call `callbacks.onRoomClick(roomId, name)`.
5. If no room is within threshold, do nothing (click was on empty terrain).

Room data format in `rooms.js`: `[cellSize, xpos, ypos, type]`. The `cellSize` and `xpos`/`ypos` fields are indices 0, 1, 2.

### `applyState({ current, target, routeRoomIds, darkMode })`

Clears the canvas, then draws in this order (back to front):

1. **Route rooms** — for each room ID in `routeRoomIds`, look up `(xpos, ypos)` and draw a filled circle, radius 5px, colour `#4a9fd4` (route blue), alpha 0.8.
2. **Ghost position** (when `target` exists and `current.roomId !== target.roomId`) — filled circle at `current.roomId` coords, radius 7px, colour `#888`, alpha 0.6.
3. **Player position** (`target ?? current`) — filled circle radius 8px colour `#e0e040` (bright yellow), plus a 2px white ring stroke.

If a room ID has no entry in `data.rooms` (untracked room), skip it silently.

For the world map (mapId 99), room coords are direct pixel coordinates (cellSize = 1), so the same draw logic applies without modification.

### Capabilities

`supportsZoom: false`, `supportsFilters: false`

No hover tooltips (PNGs carry no per-room label information accessible from the canvas surface). No context menu in PNG mode (coordinator skips attaching it).

---

## Coordinator (`mapper.js` after refactor)

### What stays

- All state variables: `current`, `target`, `routeRoomIds`, `darkMode`, `walkActive`, `displayedMapId`
- All `panel.on(...)` handlers — logic unchanged, rendering delegated to `activeRenderer.applyState()`
- `clearRoute()`, route auto-clear logic, `walkActive` flag
- Footer: `$routeDest`, `$routeWalk`, `$routeClear`, footer tooltip
- Header: `$mapName`, `updateHeader()`
- `applyStreetsState()` / `applyStairsState()` — called from context menu; DOM-class based, harmless when PNG is active
- `savedZoom` map — only used by SVG renderer but lives in coordinator for persistence via `panel.post("save_zoom", ...)`
- `panel.on("zoom_data", ...)` and `panel.on("filters_data", ...)` — coordinator receives and applies these; SVG renderer reacts to the DOM class changes automatically

### Renderer lifecycle

```js
let activeRenderer = null;

function switchRenderer(style) {
  activeRenderer?.destroy();
  clearContainer();                      // empties $container
  const Cls = style === 'png' ? PngRenderer : SvgRenderer;
  activeRenderer = new Cls($container, data, {
    onRoomClick:  (id, name) => panel.post("room_click", { id, name }),
    onMapLoaded:  (mapId) => {
      updateHeader();
      const meta = data.maps[mapId];
      panel.post("map_changed", { name: meta.file.replace(/\.\w+$/, '') });
    },
    onPersistZoom: (mapId, w) => panel.post("save_zoom", { mapId, w }),
  });
  rewireZoom();
  rewireContextMenu();
}
```

### Conditional UI

**Zoom** (`rewireZoom()`): attaches scroll-wheel, keyboard, and button handlers to the SVG renderer's zoom methods when `activeRenderer.supportsZoom`, detaches them otherwise. Zoom buttons are hidden (`$zoomIn.hidden`, `$zoomOut.hidden`) in PNG mode.

**Context menu** (`rewireContextMenu()`): in SVG mode, attaches the existing `contextmenu` listener with streets/stairs items. In PNG mode, no listener is attached (browser default — which Mallard suppresses anyway).

### `loadCurrentMap()`

```js
async function loadCurrentMap() {
  if (!displayedMapId || !activeRenderer) return;
  const x = current?.x ?? data.maps[displayedMapId]?.defaultX;
  const y = current?.y ?? data.maps[displayedMapId]?.defaultY;
  await activeRenderer.load(displayedMapId, x, y);
  activeRenderer.applyState({ current, target, routeRoomIds, darkMode });
}
```

Called after `switchRenderer()` and from `panel.on("room_info", ...)` when the map ID changes.

---

## Build / Asset setup

**One-time asset copy:** All PNG files from `claude_resources/quow_cowbar/maps/*.png` (excluding `layout_turtle.png` which has no matching map entry, and `discwhole.png` which is already present) are copied to `ui/maps/`. These are static assets — no build script needed.

**Pack size impact:** ~2.6MB of additional PNGs, bringing the `.mallardx` file from ~8.4MB to ~11MB. Acceptable for a mapping plugin.

**Pack script:** Unchanged. It already includes `ui/maps/*.png`.

---

## What is NOT in scope

- Any changes to the search, routing, bookmarks, or walk logic in `src/main.lua`
- Any changes to the SVG map files or `sync-svg-js.mjs`
- Hover tooltips for PNG maps
- Integer-zoom / pixel-doubling for PNG maps
- A "mixed" mode where SVG is used for some maps and PNG for others
