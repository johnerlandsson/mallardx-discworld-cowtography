# World Map (SVG) Design

## Goal

Replace the current canvas-based Whole Disc viewer (map 99) with a hand-built SVG world map that supports pan/zoom, shows only the GMCP-confirmed player position, and disables click-to-route.

---

## Section 1: SVG file and layer structure

**File:** `ui/maps/discwhole.svg`

**ViewBox:** `0 0 5809 5000` — identical to the game coordinate space for map 99 (`maxX: 5809, maxY: 5000`), so GMCP positions drop in with no transformation.

Map 99 metadata in `ui/data/rooms.js` is updated to `"file": "discwhole.svg"`.

### Initial layer stack (bottom to top)

| Layer id | Purpose | Initial content |
|----------|---------|-----------------|
| `layer-water` | Ocean base | `<rect width="5809" height="5000" fill="#1a3a5c"/>` |
| `layer-terrain` | Land biomes | Empty — filled in Inkscape over time |
| `layer-labels` | Text annotations | Empty — filled in Inkscape over time |
| `layer-player` | Player position dot | `<circle id="world-player" r="30" fill="#ff3b30" stroke="#fff" stroke-width="4"/>` |

More layers may be added between `layer-terrain` and `layer-labels` as the map evolves. `layer-player` must always remain topmost.

The circle radius of 30 coordinate units gives a pin-head sized dot at world scale. Adjust after first in-game look.

---

## Section 2: mapper.js integration

Map 99 is loaded via the existing `loadSvgMap` pipeline. The canvas-based machinery (`loadWorldDisc`, `drawWorldDisc`, `worldImg`, `worldCanvas`, `worldCtx`) is removed entirely.

### Default zoom

`roomUnits` is never populated for map 99 (no rooms). `defaultZoomW` returns the full map width (`5809`) as a fallback, giving a zoomed-out starting view. Zoom is saved and restored via the existing `savedZoom` map, exactly like other maps.

### Player dot in applyState()

`applyState()` gains a map 99 branch that skips room-lookup logic entirely and instead:

1. Reads `current` (never `target`)
2. Sets `cx`/`cy` on `#world-player` to `current.x` / `current.y`
3. Hides the dot (`display: none`) when `current` is null

### UI toggles

The streets toggle, stairs toggle, and route footer are hidden when `displayedMapId === 99` — they are irrelevant on the world map. They are restored when navigating to any other map.

### No sync:svg step

The world SVG is hand-built, not generated. It is fetched and inlined by the existing `loadSvgMap` fetch path with no changes required to the build pipeline.

---

## Section 3: Click-to-route and target position

### Click-to-route — explicitly disabled

The `pointerdown` handler gains an early return when `displayedMapId === 99`:

```js
if (displayedMapId === 99) return;
```

This is intentional, not incidental. It ensures click-to-route stays disabled regardless of what SVG elements are present in the file.

### Target position — suppressed

The existing `target_move` handler already nulls `target` for map 99. This behaviour is preserved. The `applyState()` map 99 branch only ever reads `current`, so the predicted position dot can never appear ahead of the confirmed position.

---

## Files changed

| File | Change |
|------|--------|
| `ui/maps/discwhole.svg` | New file — hand-built world SVG |
| `ui/data/rooms.js` | Map 99 `file` field: `discwhole.png` → `discwhole.svg` |
| `ui/mapper.js` | Remove canvas world-disc code; add map 99 branch in `applyState()`; add click guard in `pointerdown`; hide/show toggles for map 99 |

No build script changes. No CSS changes (player dot styled inline on the SVG element).

---

## Out of scope

- Animated transitions between maps
- Room dots or click-to-route on the world map
- Automatic biome generation from game data
- Any changes to how other maps (non-99) work
