# Multi-Map Browser

**Date:** 2026-06-29

## Overview

Add a right-click menu option to switch between all maps, available on both SVG and PNG renderers. Add a recenter button to the footer that jumps back to the current character location. Show a transient footer error when a clicked room has no reachable route.

## Files Changed

| File | Change |
|---|---|
| `ui/data/map-groups.json` | **New** — ordered group definitions for the right-click menu |
| `ui/mapper.html` | Add `route-error` span and `route-recenter` button to footer |
| `ui/mapper.css` | Styles for new footer elements |
| `ui/mapper.js` | Load map-groups.json, extend context menu, wire footer buttons, handle `route_error` panel message |
| `src/main.lua` | Post `route_error` panel message when pathfind returns nil |

## map-groups.json

Located at `ui/data/map-groups.json`. Hand-maintained; not generated. Editable at any time without touching code.

Format: ordered array of group objects. `regions` is an array of region codes matching the `region` field in `ui/data/rooms.js`. A group with `"regions": null` is the catch-all for any region not listed elsewhere. Only one catch-all is allowed; it should be last.

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

## Context Menu

### Renderer change

`rewireContextMenu` in `mapper.js` currently returns early if `!activeRenderer?.supportsFilters`. This guard is removed. The menu is now wired for both SVG and PNG renderers. The `supportsFilters` flag is used only to conditionally include the Street names and Stairs items.

### Menu structure

```
[header] Map
[item]   Street names ✓    (SVG only, hidden on world map)
[item]   Stairs ✓           (SVG only, hidden on world map)
[header] Ankh-Morpork
[item]     Ankh-Morpork     (topLevel maps first, then sub-maps alphabetically)
[item]     Shades Maze
[item]     AM Guilds
[item]     …
[header] Bes Pelargic
[item]     …
…
[header] Other
[item]     …
```

Within each group, `topLevel: true` maps are listed first, then remaining maps sorted alphabetically by name. The currently displayed map is marked `checked: true`.

### Map loading on item click

Clicking a map item calls `loadMap(mapId, meta.defaultX, meta.defaultY)` directly in JS. No Lua round-trip. The existing `onMapLoaded` callback posts `map_changed` to Lua as usual, so Lua state stays consistent.

### JSON loading

`map-groups.json` is loaded at module init using `fetch` + top-level `await`:

```js
const mapGroups = await fetch(new URL('./data/map-groups.json', import.meta.url))
  .then(r => r.json());
```

The grouped menu items are computed once from `mapGroups` + `data.maps` and reused on every right-click (just flipping `checked` state dynamically).

## Footer Changes

### HTML additions

```html
<footer class="route-footer">
  <span class="route-dest"></span>
  <span class="route-error" hidden></span>
  <button class="route-recenter" type="button" title="Go to current location">⌂</button>
  <button class="route-walk" type="button" hidden>walk</button>
  <button class="route-clear" type="button" title="Clear route" hidden>✕</button>
</footer>
```

`route-dest` and `route-error` share the same flex slot and are never both visible.

### Recenter button

- Always rendered; disabled when `current === null`.
- On click: `await loadMap(current.mapId, current.x, current.y)` then `activeRenderer?.centerOn(current.x, current.y)`.
- Pure JS — no Lua message required.
- `updateRecenter()` called wherever `current` changes (same call sites as `updateHeader()`).

### Route error message

**Trigger:** Lua posts `panel:post("route_error", { name = display_name })` in `route_to_room` when `pathfind.find_path` returns nil. The existing `note(...)` call to the MUD console is kept.

**JS handler:**

```js
let routeErrorTimer = null;

panel.on("route_error", (frame) => {
  clearTimeout(routeErrorTimer);
  $routeError.textContent = `No route to ${frame.name}`;
  $routeError.hidden = false;
  $routeDest.hidden  = true;
  routeErrorTimer = setTimeout(() => {
    $routeError.hidden = true;
    $routeDest.hidden  = false;
  }, 3000);
});
```

The timer is cancelled and the error dismissed immediately whenever `route_set` or `route_clear` fires, so a successful route never shows stale error text.

## Lua Change

In `route_to_room` (around line 920 of `src/main.lua`), add one line after the existing `note(...)` on pathfind failure:

```lua
if path == nil then
  note('  Could not find a route. You may be in an untracked area, or the destination is unreachable.', C.err)
  panel:post("route_error", { name = display_name })
  return
end
```

## Error Handling

- `fetch` failure for `map-groups.json`: fall back to showing all maps under a single "Maps" header (no grouping). Log a warning to console.
- `loadMap` failure on menu item click: existing error path in `mapper.js` already sets `$mapName.textContent = "Map load failed"`.
- Recenter clicked with `current === null`: button is disabled, no action.

## Out of Scope

- Keyboard shortcut to open the map browser (separate feature).
- Persisting "last manually browsed map" across sessions.
- Nested submenus (not supported by `panel.menu` API).
