# Multi-Map Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click menu to switch between all maps (both renderers), a recenter button in the footer, and a transient footer error when a clicked room is unreachable.

**Architecture:** Extract map-grouping logic into a standalone `ui/map-menu.js` module (importable and testable by vitest). `mapper.js` loads `ui/data/map-groups.json` at startup via top-level `await fetch(...)`, then uses `buildMapMenuItems` to populate the context menu. The footer gains two new elements: a `route-error` span (mutually exclusive with `route-dest`) and a `route-recenter` button. Lua posts a `route_error` panel message on pathfind failure; JS handles the 3-second fade.

**Tech Stack:** Vanilla ES modules, Vitest (test runner), Lua 5.1 (Mallard plugin host)

## Global Constraints

- No bundler — all `ui/` files are served as native ES modules from the `.mallardx` zip
- Top-level `await` is valid in ES modules in the target runtime (Mallard webview)
- Vitest tests live in `scripts/*.test.mjs` and import from `ui/*.js`
- Do not modify auto-generated `ui/data/rooms.js` — read-only
- Existing `panel.menu.show(e, items)` API: items are `{ header: true, label }` or `{ label, checked?, onClick }`
- `pack` script (`npm run pack`) includes all of `ui/` — `ui/data/map-groups.json` is automatically bundled

---

### Task 1: Create `ui/data/map-groups.json`

**Files:**
- Create: `ui/data/map-groups.json`

**Interfaces:**
- Produces: JSON file consumed by `mapper.js` and documented below. Schema: array of `{ label: string, regions: string[] | null }`. Exactly one entry must have `regions: null` (the catch-all); it must be last.

- [ ] **Step 1: Create the file**

```json
[
  { "label": "Ankh-Morpork",  "regions": ["AM", "UU"] },
  { "label": "Bes Pelargic",  "regions": ["BP"] },
  { "label": "Sto Plains",    "regions": ["Sto-Lat", "Sto-Plains", "Hedgies"] },
  { "label": "Ephebe",        "regions": ["Ephebe"] },
  { "label": "Genua",         "regions": ["Genua"] },
  { "label": "Djelibeybi",    "regions": ["DJB"] },
  { "label": "Klatch",        "regions": ["Klatch"] },
  { "label": "Ramtops",       "regions": ["Ramtops", "Skund", "Copper", "S-Hollow"] },
  { "label": "Other",         "regions": null }
]
```

- [ ] **Step 2: Commit**

```bash
git add ui/data/map-groups.json
git commit -m "feat(maps): add map-groups.json category definitions"
```

---

### Task 2: `ui/map-menu.js` — map grouping logic

**Files:**
- Create: `ui/map-menu.js`
- Create: `scripts/map-menu.test.mjs`

**Interfaces:**
- Consumes: `maps` object from `data.maps` (keys are numeric map IDs as strings; values are `{ name, region, topLevel, defaultX, defaultY }`), `mapGroups` array from `map-groups.json`, `displayedMapId` number or null
- Produces: `export function buildMapMenuItems(maps, mapGroups, displayedMapId)` → `Array<{ header: true, label: string } | { label: string, mapId: number, checked: boolean }>`

- [ ] **Step 1: Write failing tests**

Create `scripts/map-menu.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { buildMapMenuItems } from '../ui/map-menu.js';

const MAPS = {
  1: { name: 'Ankh-Morpork', region: 'AM', topLevel: true,  defaultX: 100, defaultY: 100 },
  2: { name: 'AM Guilds',     region: 'AM', topLevel: false, defaultX: 50,  defaultY: 50  },
  3: { name: 'Bes Pelargic',  region: 'BP', topLevel: true,  defaultX: 200, defaultY: 200 },
  4: { name: 'Thursday',      region: 'Thursday', topLevel: false, defaultX: 10, defaultY: 10 },
};

const GROUPS = [
  { label: 'Ankh-Morpork', regions: ['AM'] },
  { label: 'Other',         regions: null },
];

describe('buildMapMenuItems', () => {
  it('emits a header for each non-empty group', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const headers = items.filter(i => i.header);
    expect(headers.map(h => h.label)).toEqual(['Ankh-Morpork', 'Other']);
  });

  it('puts topLevel maps before sub-maps within a group', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const amStart = items.findIndex(i => i.header && i.label === 'Ankh-Morpork');
    const mapItems = [];
    for (let i = amStart + 1; i < items.length && !items[i].header; i++) mapItems.push(items[i]);
    expect(mapItems[0].label).toBe('Ankh-Morpork');
    expect(mapItems[1].label).toBe('AM Guilds');
  });

  it('marks the displayed map as checked and no other', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, 1);
    const mapItems = items.filter(i => !i.header);
    const checked = mapItems.filter(i => i.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].mapId).toBe(1);
  });

  it('routes unassigned regions to the catch-all group', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const otherStart = items.findIndex(i => i.header && i.label === 'Other');
    const otherItems = [];
    for (let i = otherStart + 1; i < items.length && !items[i].header; i++) otherItems.push(items[i]);
    expect(otherItems.map(i => i.label)).toContain('Bes Pelargic');
    expect(otherItems.map(i => i.label)).toContain('Thursday');
  });

  it('skips groups that contain no matching maps', () => {
    const groups = [
      { label: 'Empty', regions: ['ZZZ'] },
      { label: 'AM',    regions: ['AM']  },
      { label: 'Other', regions: null    },
    ];
    const items = buildMapMenuItems(MAPS, groups, null);
    expect(items.filter(i => i.header).map(h => h.label)).not.toContain('Empty');
  });

  it('returns mapId as a number regardless of object key type', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const mapItems = items.filter(i => !i.header);
    for (const item of mapItems) expect(typeof item.mapId).toBe('number');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npx vitest run scripts/map-menu.test.mjs
```

Expected: FAIL — `Cannot find module '../ui/map-menu.js'`

- [ ] **Step 3: Implement `ui/map-menu.js`**

```js
export function buildMapMenuItems(maps, mapGroups, displayedMapId) {
  const assignedRegions = new Set(
    mapGroups.flatMap(g => g.regions ?? [])
  );

  const result = [];

  for (const group of mapGroups) {
    const groupEntries = Object.entries(maps)
      .filter(([, meta]) =>
        group.regions === null
          ? !assignedRegions.has(meta.region)
          : group.regions.includes(meta.region)
      )
      .sort(([, a], [, b]) => {
        if (a.topLevel !== b.topLevel) return a.topLevel ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    if (groupEntries.length === 0) continue;

    result.push({ header: true, label: group.label });
    for (const [id, meta] of groupEntries) {
      const mapId = Number(id);
      result.push({ label: meta.name, mapId, checked: mapId === displayedMapId });
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run scripts/map-menu.test.mjs
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/map-menu.js scripts/map-menu.test.mjs
git commit -m "feat(maps): add buildMapMenuItems helper with tests"
```

---

### Task 3: Footer HTML and CSS

**Files:**
- Modify: `ui/mapper.html`
- Modify: `ui/mapper.css`

**Interfaces:**
- Produces: `.route-error` (hidden by default, same flex row as `.route-dest`, mutually exclusive), `.route-recenter` button (always rendered, disabled when no current room)

- [ ] **Step 1: Update `ui/mapper.html` footer**

Replace the existing `<footer class="route-footer">` block (lines 32–36):

```html
  <footer class="route-footer">
    <span class="route-dest"></span>
    <span class="route-error" hidden></span>
    <button class="route-recenter" type="button" title="Go to current location">⌂</button>
    <button class="route-walk" type="button" hidden>walk</button>
    <button class="route-clear" type="button" title="Clear route" hidden>✕</button>
  </footer>
```

- [ ] **Step 2: Add CSS for new footer elements in `ui/mapper.css`**

Append after the existing `.route-clear:hover:not(:disabled)` rule (after line 306):

```css
.route-error {
  flex: 1;
  color: var(--ansi-9, #ff6b6b);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.route-recenter {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
.route-recenter:hover:not(:disabled) {
  color: var(--fg);
}
.route-recenter:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Verify visually**

Open the plugin in Mallard. Confirm:
- Footer shows `⌂` button to the right of the destination area
- `⌂` is dim (disabled) when no room is known yet
- No layout breakage

- [ ] **Step 4: Commit**

```bash
git add ui/mapper.html ui/mapper.css
git commit -m "feat(maps): add route-error span and recenter button to footer"
```

---

### Task 4: Route error — Lua post + JS handler

**Files:**
- Modify: `src/main.lua` (around line 920)
- Modify: `ui/mapper.js`

**Interfaces:**
- Consumes: `panel.on("route_error", frame)` where `frame = { name: string }`
- Produces: Transient error message in `.route-error`, hidden after 3 seconds. Cleared immediately on `route_set` or `route_clear`.

- [ ] **Step 1: Add `route_error` post to `src/main.lua`**

In `route_to_room` (around line 920), find the block:
```lua
  local path, steps, route_rooms = pathfind.find_path(exits, current_room, room_id)
  if path == nil then
    note('  Could not find a route. You may be in an untracked area, or the destination is unreachable.', C.err)
    return
  end
```

Change it to:
```lua
  local path, steps, route_rooms = pathfind.find_path(exits, current_room, room_id)
  if path == nil then
    note('  Could not find a route. You may be in an untracked area, or the destination is unreachable.', C.err)
    panel:post("route_error", { name = display_name })
    return
  end
```

- [ ] **Step 2: Add DOM ref and route error handler to `ui/mapper.js`**

In the `// ─── DOM refs ─────────────────────────────────────────────────────────────` section (around line 10), add after `$routeClear`:

```js
const $routeError    = document.querySelector(".route-error");
const $routeRecenter = document.querySelector(".route-recenter");
```

Add a `clearRouteError` helper and the `route_error` handler. Place them in the `// ─── Route ────────────────────────────────────────────────────────────────` section, after `clearRoute`:

```js
let routeErrorTimer = null;

function clearRouteError() {
  clearTimeout(routeErrorTimer);
  routeErrorTimer = null;
  $routeError.hidden = true;
  $routeDest.hidden  = false;
}

panel.on("route_error", (frame) => {
  clearTimeout(routeErrorTimer);
  $routeError.textContent = `No route to ${frame.name}`;
  $routeError.hidden = false;
  $routeDest.hidden  = true;
  routeErrorTimer = setTimeout(clearRouteError, 3000);
});
```

- [ ] **Step 3: Clear error on successful route or clear**

In the existing `panel.on("route_set", ...)` handler, add `clearRouteError();` as the first line inside the callback.

In the existing `panel.on("route_clear", clearRoute)` line, change it so `clearRoute` also calls `clearRouteError`. Update `clearRoute`:

```js
function clearRoute() {
  clearRouteError();
  walkActive    = false;
  routeRoomIds  = [];
  activeRenderer?.applyState(getState());
  $routeDest.textContent = '';
  $routeWalk.hidden  = true;
  $routeClear.hidden = true;
  $routeWalk.disabled  = false;
  $routeClear.disabled = false;
}
```

- [ ] **Step 4: Manual test**

In Mallard with the plugin loaded:
1. Stand in a known room.
2. Click a room on a different, disconnected map (e.g. Death's Domain while in AM).
3. Expected: footer shows `No route to <name>` in red for 3 seconds, then clears.
4. Click a reachable room. Expected: error clears immediately, route appears.

- [ ] **Step 5: Commit**

```bash
git add src/main.lua ui/mapper.js
git commit -m "feat(maps): show transient footer error when no route found"
```

---

### Task 5: Recenter button wiring

**Files:**
- Modify: `ui/mapper.js`

**Interfaces:**
- Consumes: `current` (module-level var), `loadMap(mapId, x, y)`, `activeRenderer?.centerOn(x, y)`
- Produces: `⌂` button loads the character's current map and centers on current room. Button disabled when `current === null`.

- [ ] **Step 1: Add `updateRecenter` and wire it into `updateHeader`**

Add `updateRecenter` as a small function just above `updateHeader` in `mapper.js`:

```js
function updateRecenter() {
  $routeRecenter.disabled = current === null;
}
```

At the end of the existing `updateHeader()` function body, add:
```js
  updateRecenter();
```

- [ ] **Step 2: Add click handler**

In the `// ─── Footer ───────────────────────────────────────────────────────────────` section, after the existing `$routeClear` click listener, add:

```js
$routeRecenter.addEventListener("click", async () => {
  if (!current) return;
  await loadMap(current.mapId, current.x, current.y);
  activeRenderer?.centerOn?.(current.x, current.y);
});
```

- [ ] **Step 3: Manual test**

1. Move through several rooms in AM so `current` is set.
2. Move in-game to a different region (e.g. travel to BP) — the map will auto-switch. Then close and reopen the panel; it will reload on the current map.
   Alternatively, complete Task 6 first and use the right-click menu to browse to a different map.
3. Press `⌂`. Expected: map loads your actual current region and centers on your room.
4. Open the panel fresh before moving anywhere: `⌂` should be disabled (greyed out).

- [ ] **Step 4: Commit**

```bash
git add ui/mapper.js
git commit -m "feat(maps): add recenter button to return to current location"
```

---

### Task 6: Context menu map switching

**Files:**
- Modify: `ui/mapper.js`

**Interfaces:**
- Consumes: `buildMapMenuItems` from `./map-menu.js`, `mapGroups` loaded from `./data/map-groups.json`, `data.maps`, `displayedMapId`, `loadMap(mapId, defaultX, defaultY)`
- Produces: Right-click menu shows map groups on both SVG and PNG renderers. Clicking a map item calls `loadMap`.

- [ ] **Step 1: Load `map-groups.json` at module top level**

In `ui/mapper.js`, after the existing six `import` lines at the top of the file (after `import { PngRenderer } from "./png-renderer.js";`), add:

```js
import { buildMapMenuItems } from './map-menu.js';

const mapGroups = await fetch(new URL('./data/map-groups.json', import.meta.url))
  .then(r => r.json())
  .catch(() => {
    console.warn('[mapper] Could not load map-groups.json; map switching unavailable');
    return [];
  });
```

- [ ] **Step 2: Extend `rewireContextMenu` in `ui/mapper.js`**

Find the existing `rewireContextMenu` function (around line 163). Replace the entire function body:

```js
function rewireContextMenu() {
  contextMenuController?.abort();
  contextMenuController = null;
  if (!(panel.menu && typeof panel.menu.show === "function")) return;
  contextMenuController = new AbortController();
  document.addEventListener("contextmenu", (e) => {
    const isWorld   = displayedMapId === 99;
    const streetsOn = !document.documentElement.classList.contains('streets-hidden');
    const stairsOn  = !document.documentElement.classList.contains('stairs-hidden');
    const items = [{ header: true, label: "Map" }];
    if (activeRenderer?.supportsFilters && !isWorld) {
      items.push(
        { label: "Street names", checked: streetsOn, onClick: () => {
            applyStreetsState(!streetsOn);
            panel.post("save_filters", { streets: !streetsOn, stairs: stairsOn });
        }},
        { label: "Stairs", checked: stairsOn, onClick: () => {
            applyStairsState(!stairsOn);
            panel.post("save_filters", { streets: streetsOn, stairs: !stairsOn });
        }},
      );
    }
    for (const item of buildMapMenuItems(data.maps, mapGroups, displayedMapId)) {
      if (item.header) {
        items.push(item);
      } else {
        const { mapId } = item;
        const meta = data.maps[mapId];
        items.push({ ...item, onClick: () => loadMap(mapId, meta.defaultX, meta.defaultY) });
      }
    }
    panel.menu.show(e, items);
  }, { signal: contextMenuController.signal });
}
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass (no regressions in build-db, build-svg, sync-svg-js, png-renderer, map-menu tests).

- [ ] **Step 4: Manual test — SVG renderer**

1. Open plugin in SVG mode.
2. Right-click. Expected: "Map" header, Street names + Stairs items, then map group headers (Ankh-Morpork, Bes Pelargic, …, Other).
3. Currently displayed map has a checkmark.
4. Click "Bes Pelargic". Expected: map switches to BP. Check `⌂` is enabled if you have a current room.
5. Click a room on BP. Expected: route attempt; if unreachable, footer error for 3s.

- [ ] **Step 5: Manual test — PNG renderer**

1. Switch to PNG mode via plugin settings.
2. Right-click. Expected: same map group menu appears (no Street names / Stairs items).
3. Click a map to switch. Expected: works identically.

- [ ] **Step 6: Commit**

```bash
git add ui/mapper.js
git commit -m "feat(maps): add map-switching to right-click menu on both renderers"
```
