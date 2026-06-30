# World Map SVG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the canvas-based Whole Disc viewer (map 99) with a hand-built SVG that supports pan/zoom, saves zoom, shows only the GMCP-confirmed player position, and explicitly disables click-to-route.

**Architecture:** The world SVG is loaded via the existing `loadSvgMap` pipeline exactly like any other map. Map 99's metadata `file` field is changed from `discwhole.png` to `discwhole.svg`. The canvas drawing machinery (`loadWorldDisc`, `drawWorldDisc`, and the three canvas state variables) is removed. A small map-99-specific branch is added to `applyState()` to position a pre-placed `<circle id="world-player">` element rather than doing room lookups.

**Tech Stack:** SVG, vanilla JS (`ui/mapper.js`), existing `npm run sync:svg` build step.

## Global Constraints

- SVG viewBox must be `0 0 5809 5000` — matching map 99's `maxX`/`maxY` exactly so GMCP coords are used directly with no transformation.
- `layer-player` must remain the topmost group in the SVG at all times.
- `#world-player` is the only element `applyState()` manipulates on map 99.
- Click-to-route must be explicitly guarded in `pointerdown`, not just relied upon from absence of `.room` elements.
- Pan and zoom must work on map 99 exactly as on other maps.
- Target position must never be shown on map 99 — only `current`.
- Zoom is saved and restored via the existing `savedZoom` / `save_zoom` mechanism.
- No new dependencies. No new build steps beyond `npm run sync:svg`.

---

### Task 1: Create the world SVG and sync it

**Files:**
- Create: `ui/maps/discwhole.svg`
- Modify: `ui/data/rooms.js` (map 99 `file` field)
- Generated: `ui/maps/discwhole.js` (via `npm run sync:svg`)

**Interfaces:**
- Produces: `ui/maps/discwhole.js` — JS module exporting SVG text string, consumed by `loadSvgMap` in Task 2
- Produces: `#world-player` — SVG circle element at an arbitrary position, with `style="display:none"`, consumed by `applyState()` in Task 3

- [ ] **Step 1: Create `ui/maps/discwhole.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     viewBox="0 0 5809 5000" width="5809" height="5000">
  <g id="layer-water" inkscape:label="Water">
    <rect width="5809" height="5000" fill="#1a3a5c"/>
  </g>
  <g id="layer-terrain" inkscape:label="Terrain">
  </g>
  <g id="layer-labels" inkscape:label="Labels">
  </g>
  <g id="layer-player" inkscape:label="Player">
    <circle id="world-player" r="30" fill="#ff3b30" stroke="#fff" stroke-width="4" style="display:none"/>
  </g>
</svg>
```

- [ ] **Step 2: Update map 99 file reference in `ui/data/rooms.js`**

Find line:
```js
99: {"file":"discwhole.png","name":"Whole Disc","defaultX":1175,"defaultY":3726,"region":"Terrains","maxX":5809,"maxY":5000,"topLevel":true},
```
Change to:
```js
99: {"file":"discwhole.svg","name":"Whole Disc","defaultX":1175,"defaultY":3726,"region":"Terrains","maxX":5809,"maxY":5000,"topLevel":true},
```

- [ ] **Step 3: Sync the SVG to a JS module**

Run:
```bash
npm run sync:svg
```
Expected: `ui/maps/discwhole.js` appears (or updates) in the output. Verify the file exists:
```bash
ls ui/maps/discwhole.js
```

- [ ] **Step 4: Commit**

```bash
git add ui/maps/discwhole.svg ui/maps/discwhole.js ui/data/rooms.js
git commit -m "feat(world-map): add empty world SVG with layer structure"
```

---

### Task 2: Wire map 99 into loadSvgMap; remove canvas machinery

**Files:**
- Modify: `ui/mapper.js` (multiple sections — read it fully before editing)

**Interfaces:**
- Consumes: `ui/maps/discwhole.js` from Task 1
- Produces: map 99 loading through `loadSvgMap`, with zoom save/restore; `currentSvg` set on world map load

**Context:** `loadSvgMap` (line ~349) currently resolves the JS module with `meta.file.replace(".png", ".js")`. Since `discwhole.svg` contains `.svg` not `.png`, this replace does nothing and the import would fail. Fix: replace the extension generically. Additionally, `loadSvgMap` line ~369 skips persisting zoom when leaving map 99 — that guard must be removed so map 99 zoom is saved like any other map.

The `room_info` handler (line ~805) and `target_move` handler (line ~873) both call `loadWorldDisc` for map 99. Replace with `loadSvgMap`. The canvas state variables (`worldImg`, `worldCanvas`, `worldCtx`), `clearContainer`'s reset of them, the ResizeObserver canvas call, and the `loadWorldDisc`/`drawWorldDisc` functions are all removed.

- [ ] **Step 1: Fix the file-extension replace in `loadSvgMap`**

In `loadSvgMap` (around line 353), change:
```js
const { default: svgText } = await import(`./maps/${meta.file.replace(".png", ".js")}`);
```
to:
```js
const { default: svgText } = await import(`./maps/${meta.file.replace(/\.\w+$/, ".js")}`);
```

- [ ] **Step 2: Remove the `!== 99` zoom-persist exclusion in `loadSvgMap`**

Around line 369, change:
```js
if (displayedMapId !== null && displayedMapId !== 99 && viewBox.w > 0) {
    persistZoom(displayedMapId, viewBox.w);
}
```
to:
```js
if (displayedMapId !== null && viewBox.w > 0) {
    persistZoom(displayedMapId, viewBox.w);
}
```

- [ ] **Step 3: Add a sensible default zoom for map 99 in `defaultZoomW`**

In `defaultZoomW` (around line 197), add a map-99 case after the map-47 case:
```js
function defaultZoomW(mapId) {
  const meta = data.maps[mapId];
  if (!meta) return 1;
  if (mapId === 47) return 280;   // UU Library — fixed
  if (mapId === 99) return meta.maxX / 2;  // World map — start half-zoomed
  const unit = roomUnits.get(mapId);
  if (unit) return $container.clientWidth * unit / TARGET_PX;
  return meta.maxX / 4;
}
```

- [ ] **Step 4: Replace `loadWorldDisc` call in `room_info` handler**

Around line 805–806, change:
```js
} else if (next?.mapId === 99) {
    loadWorldDisc(next.x, next.y);
}
```
to:
```js
} else if (next?.mapId === 99) {
    await loadSvgMap(99, next.x, next.y);
}
```

- [ ] **Step 5: Replace `loadWorldDisc` call in `target_move` handler**

Around line 873–875, change:
```js
if (next.mapId === 99) {
    loadWorldDisc(next.x, next.y);
    target = null;  // world disc has no SVG room indicator
}
```
to:
```js
if (next.mapId === 99) {
    await loadSvgMap(99, next.x, next.y);
    target = null;
}
```

- [ ] **Step 6: Remove canvas state variables**

Around lines 133–136, delete:
```js
// World-disc canvas state (map 99 only)
let worldImg    = null;
let worldCanvas = null;
let worldCtx    = null;
```

- [ ] **Step 7: Remove canvas reset from `clearContainer`**

In `clearContainer` (around line 346), delete:
```js
worldImg = null; worldCanvas = null; worldCtx = null;
```

- [ ] **Step 8: Remove the ResizeObserver canvas call**

Around lines 752–755, change:
```js
new ResizeObserver(() => {
  if (worldCtx && current) drawWorldDisc(current.x, current.y);
}).observe($container);
```
to:
```js
new ResizeObserver(() => {}).observe($container);
```
(Keep the observer so the element reference is retained, but remove the canvas-specific body. If the ResizeObserver has no other purpose it can be removed entirely, but keeping an empty one avoids any hidden reliance on the observe call.)

Actually, remove it entirely — the SVG viewBox approach handles resize automatically:
```js
// (delete the ResizeObserver block entirely)
```

- [ ] **Step 9: Remove `loadWorldDisc` and `drawWorldDisc` functions**

Delete the entire `loadWorldDisc` function (lines ~388–405) and the entire `drawWorldDisc` function (lines ~407–427).

- [ ] **Step 10: Manual smoke test**

Open the plugin in Mallard. Walk to a room on map 99 (the Whole Disc). Verify:
- The world SVG loads (blue background visible)
- Pan and zoom work
- The map name header shows "Whole Disc"

- [ ] **Step 11: Commit**

```bash
git add ui/mapper.js
git commit -m "feat(world-map): load map 99 via loadSvgMap; remove canvas world-disc code"
```

---

### Task 3: Player dot, click-to-route guard, UI toggles

**Files:**
- Modify: `ui/mapper.js` (applyState, pointerdown, loadSvgMap)

**Interfaces:**
- Consumes: `#world-player` circle from Task 1's SVG; `displayedMapId`, `current` from mapper state
- Produces: visible player dot on world map; no click-to-route on map 99; streets/stairs toggles and route footer hidden on map 99

**Context:** `applyState()` (line ~472) starts with `if (!currentSvg) return;` and then runs route + position indicator logic that assumes `.room` elements exist. For map 99 we need to exit that logic early and instead set `cx`/`cy` on `#world-player`. The `pointerdown` handler (line ~710) must explicitly prevent click-to-route on map 99. The streets toggle (`$streetsToggle`), stairs toggle (`$stairsToggle`), and route footer (`$footer`) must be hidden when displaying map 99.

- [ ] **Step 1: Add map 99 branch in `applyState()`**

In `applyState()`, after the `if (!currentSvg) return;` line (line ~473), insert:

```js
if (displayedMapId === 99) {
    const dot = currentSvg.querySelector('#world-player');
    if (dot) {
      if (current) {
        dot.setAttribute('cx', current.x);
        dot.setAttribute('cy', current.y);
        dot.style.display = '';
      } else {
        dot.style.display = 'none';
      }
    }
    return;
  }
```

- [ ] **Step 2: Add explicit click-to-route guard in `pointerdown`**

In the `pointerdown` handler (around line 720), change:
```js
} else if (e.button === 0 && roomEl) {
    pendingRoomClick = { el: roomEl, startX: e.clientX, startY: e.clientY };
    $container.setPointerCapture(e.pointerId);
}
```
to:
```js
} else if (e.button === 0 && roomEl && displayedMapId !== 99) {
    pendingRoomClick = { el: roomEl, startX: e.clientX, startY: e.clientY };
    $container.setPointerCapture(e.pointerId);
}
```

- [ ] **Step 3: Hide UI controls when loading map 99, restore otherwise**

In `loadSvgMap`, after `displayedMapId = mapId;` (around line 378), insert:

```js
const isWorld = mapId === 99;
$streetsToggle.hidden = isWorld;
$stairsToggle.hidden  = isWorld;
$footer.hidden        = isWorld;
```

- [ ] **Step 4: Manual smoke test**

Walk to a room on map 99. Verify:
- Player dot appears at the correct position (red circle)
- Dot moves when walking on the world map
- Dot does NOT jump ahead of confirmed position
- Clicking anywhere on the world map does NOT trigger click-to-route
- Streets toggle, stairs toggle, and route footer are hidden
- All three reappear when navigating to any other map

- [ ] **Step 5: Commit**

```bash
git add ui/mapper.js
git commit -m "feat(world-map): player dot, click-to-route guard, hide map controls on world map"
```
