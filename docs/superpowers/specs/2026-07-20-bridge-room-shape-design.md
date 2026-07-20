# Bridge Room Shape — Design Spec

## Overview

Rooms currently render as one of two shapes based on `room_type`: a circle for outdoor rooms, a square (rounded `<rect>`) for indoor rooms (`roomElement()` in `scripts/build-svg.mjs`). Bridges — e.g. King's Bridge on `am.svg` — are outdoor rooms today and render as plain circles like any other street tile, with no visual distinction from the road they connect to.

**Goal:** give rooms that are the physical span of a named bridge a third, distinct shape (a regular octagon), classified by room name rather than any DB flag, since Quow's data has no "this is a bridge" field.

## Approach

### Shape

A regular octagon, "stop sign" style — inscribed in the *same bounding square* used for indoor rooms (`hw*2 × hw*2`), so it inherits the existing `compact`/`large` size variants for free and reads as roughly the same visual size as a circle or square room, just an obviously different silhouette.

Vertices (center `x,y`, half-width `hw`, corner-cut `t = hw*(2-√2)`):

```
(x-hw+t, y-hw)  (x+hw-t, y-hw)
(x+hw,   y-hw+t)  (x+hw,   y+hw-t)
(x+hw-t, y+hw)  (x-hw+t, y+hw)
(x-hw,   y+hw-t)  (x-hw,   y-hw+t)
```

Rendered as `<polygon class="room bridge outdoor...">` — same modifier classes (`water`/`green`/`danger`/size/extra) as circle/rect today, no new CSS needed beyond the `.bridge` marker class (no distinct fill/stroke is being requested — shape alone is the signal). A room's bridge status wins outright over its indoor/outdoor DB flag: if it's a bridge, it's drawn as the octagon regardless of what `room_type` says.

### Classification: name-based, hand-maintained list

Bridge names in this data are too inconsistent for a live regex to safely run unattended at every build (e.g. "King's Bridge" is the span itself; "under the King's Bridge" is a different room underneath it; "Bridge Street" is a street; "Rubber bridge"/"Contract Bridge" are real Discworld bridges despite reading like card-game puns; "Pearl River between two bridges" is a river room that merely mentions bridges).

So classification is **not** a live classifier wired into the build (unlike `isWaterRoom()`'s `WATER_NAME_PATTERNS`). Instead:

- **`ui/data/room-bridge.json`** — a flat JSON array of room IDs (same shape as `room-water.json`/`room-green.json`/`room-danger.json`). This is the single source of truth for "is this room a bridge span," read by `build-svg.mjs` and nothing else. **Nothing in the build pipeline ever writes to this file** — it is exclusively hand-maintained, exactly like the water/green/danger override files today. Editing it (adding a missed bridge, deleting a false positive) is a plain, permanent JSON edit; no script will ever regenerate or clobber it.
- **`scripts/find-bridge-candidates.mjs`** (+ `npm run find:bridges`) — a read-only discovery helper, not a generator. It scans `rooms` from `ui/data/rooms.js`, applies the name heuristic below, diffs the matches against what's already in `room-bridge.json`, and prints newly-found candidates to stdout for manual review/copy-in. It never writes the file. Re-running it after a future `npm run build:data` refresh (new areas, new rooms) is how new bridges get discovered; it has no memory of previously-rejected suggestions, so a name pattern that was manually excluded once may be suggested again on a later run — an acceptable minor rough edge given refreshes are infrequent.

### Name heuristic (used only inside `find-bridge-candidates.mjs`, one-time/on-demand — never at `build-svg` time)

Include a room name if it reads as "you are standing on the bridge span itself":
- Ends with "bridge" (case-insensitive): `King's Bridge`, `Rubber bridge`, `New Bridge`.
- `middle|centre|center of (the) ... bridge`: `middle of New Bridge`.
- `north|south|east|west(...) end of (the) ... bridge`: `east end of New Bridge`.
- `section of ... bridge ...`: `section of Rainbow Bridge connecting Hong Fa and Shoo-Li`.
- `bridge over|spanning|between ...`: `bridge over Lancre Gorge`, `bridge between two towers`.

Exclude a name that would otherwise match if it also contains:
- `under` / `underneath` anywhere (`under the King's Bridge`, `ledge underneath the Tora Bridge`) — a different room below the span.
- Starts with `junction` (`junction of Phedre Road with King's Way and King's Bridge`) — a junction room, not the span.

Everything else (river/bay rooms that merely mention a bridge in passing, street names like "Bridge Street") simply doesn't match any include pattern and is left alone.

## Code changes

**`scripts/build-svg.mjs`:**
- New helper `octagonPoints(x, y, hw)` returning the points-string above.
- `roomElement()` gains a `bridge = false` parameter, appended after the existing `large` parameter (consistent with the file's append-only extension history for `water`/`green`/`danger`/`large`). When `bridge` is true, emit the `<polygon>` shape instead of the circle/rect branch; `isIndoor` is ignored for shape purposes in that case (still available for any future non-shape use).
- `buildNewSvg()` / `updateExistingSvg()`: load `ui/data/room-bridge.json` into a `Set` (new `BRIDGE_CONFIG` path constant, loaded the same way as `WATER_CONFIG`/`GREEN_CONFIG`/`DANGER_CONFIG` — read-only, no override merge logic needed since there's no live classifier to merge against). Pass `bridgeRooms.has(r.id)` into `roomElement()` at both call sites.

**`ui/svg-renderer.js`:**
- `computeRoomUnit()` currently branches on `el.tagName.toLowerCase() === 'circle'` to decide whether to read `cx`/`cy` or fall back to `x`/`y`/`width`. A `<polygon>` has neither attribute pair, which would silently push `NaN` into the room-spacing calculation used for zoom-fit heuristics. Fix: give the octagon polygon harmless `cx`/`cy` attributes (ignored for rendering, valid for `getAttribute`) in `roomElement()`, and change the `computeRoomUnit()` check from a tag-name test to `el.hasAttribute('cx')` — the same duck-typed check `findRoomByLabel()` a few hundred lines down already uses successfully for any shape.

**New files:**
- `ui/data/room-bridge.json` — seeded via one manual pass using the heuristic above, reviewed by hand before committing.
- `scripts/find-bridge-candidates.mjs` — the reusable discovery script described above.
- `package.json`: new `"find:bridges": "node scripts/find-bridge-candidates.mjs"` script entry.

## Tests

**`scripts/build-svg.test.mjs`:**
- New `describe('roomElement (bridge)', ...)` block mirroring the existing water/green/danger tests: asserts a `bridge=true` call emits a `<polygon class="room bridge...">` with the expected octagon points (standard, compact, and large sizes), and that `bridge=true` takes precedence over `isIndoor` in the shape branch.
- New `describe('octagonPoints', ...)` verifying the vertex math at a couple of `hw` values.

**New `scripts/find-bridge-candidates.test.mjs`:**
- Tests the include/exclude heuristic directly against representative names: includes `"King's Bridge"`, `"Rubber bridge"`, `"middle of New Bridge"`, `"bridge over Lancre Gorge"`; excludes `"under the King's Bridge"`, `"Bridge Street"`, `"junction of Phedre Road with King's Way and King's Bridge"`, `"Pearl River between two bridges"`.

**`ui/svg-renderer.js`:** no existing test file for this module (unlike `png-renderer.test.mjs`); the `computeRoomUnit` fix is verified manually via the `verify` skill against `am.svg` (King's Bridge) rather than a new unit-test harness.

## Rollout

1. Run `find-bridge-candidates.mjs` once, review its output, hand-write the initial `ui/data/room-bridge.json`.
2. `npm run build:svg` — regenerates affected map SVGs in place (`updateExistingSvg()` preserves hand-edited layers like `layer-artwork`).
3. `npm run sync:svg` — recompiles the `ui/maps/*.js` bundles from the updated SVGs.
4. Manually verify via the `verify` skill: octagon renders correctly on `am.svg` at King's Bridge, and click/zoom/room-lookup still behave correctly for the new shape.

## Scope boundaries

**Not in scope:**
- Any change to `TYPE_LETTERS`/shop-type letter overlays — a bridge room can still carry a type letter on top of the octagon exactly like circle/rect rooms do today; no change needed there.
- The ASCII Map panel (`ui/ascii_map.js`, `src/ansi_map.lua`) — no room-shape concept at all; renders the MUD server's raw GMCP grid as-is.
- Retroactively re-deriving bridge classification via a live regex at build time — deliberately rejected in favor of the hand-maintained list, per the messiness of the source names (see Classification above).
- Any visual distinction beyond shape (no new fill/stroke color) — shape alone is the requested signal.
