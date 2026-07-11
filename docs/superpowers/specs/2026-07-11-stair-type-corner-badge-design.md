# Stair Symbol on Typed Rooms — Design Spec

## Overview

Rooms can have two independent pieces of derived info rendered in the SVG map: a **stair symbol** (`▲`/`▼`/`◆` for up/down/both vertical exits, see [[2026-06-09-svg-maps-design]]) and a **room type letter** (`S`, `$`, `!`, etc., see [[2026-06-11-room-type-indicators-design]]). Both are currently drawn dead-center on the room shape, so `buildStairLayer()` just drops the stair symbol entirely whenever a room also has a type — the type label "wins" and the fact that the room also has stairs is lost.

Across the whole database, 273 rooms hit this overlap (253 indoor, 20 outdoor; none compact, none large). This is common enough to be worth a real treatment rather than permanent suppression.

**Goal:** keep the type letter fully legible and dominant, but add a small secondary badge indicating the room also has stairs.

## Approach

Rooms without a type keep today's behavior unchanged: a full-size stair symbol centered on the room.

Rooms **with** a type get a new, smaller stair badge tucked into the bottom-right corner of the room's bounding box, instead of having the symbol suppressed. The badge keeps the same three shapes as today (wedge for up-only, wedge for down-only, small diamond for both), scaled down and repositioned so it doesn't compete with the centered letter.

Validated at true scale in `.superpowers/brainstorm/58613-1783805257/content/stair-type-options.html` (dark theme, shop-green room, letter `S`) — that mockup is the source of truth for the exact shape/positioning numbers below.

### Geometry

Room center is `(x, y)`; the standard room bounding box spans `x±4, y±4` (8×8 units — the only size this overlap occurs at in practice, see Scope below). The corner badge occupies the offset range **+1.2 to +2.8** from center on both axes (i.e. the bottom-right 1.6×1.6-unit region of the box, leaving a ~1.2-unit margin from the room's edge/stroke):

- **Up only:** wedge with vertices at offset `(2.6, 1.4)`, `(2.6, 2.6)`, `(1.4, 2.6)` from center.
- **Down only:** wedge with vertices at offset `(2.6, 2.6)`, `(1.4, 2.6)`, `(1.4, 1.4)` from center.
- **Both:** small diamond centered at offset `(2, 2)` from center, with vertices at `(2, 1.2)`, `(2.8, 2)`, `(2, 2.8)`, `(1.2, 2)`.

Same fill as today (`var(--fg)`, existing `.stair-symbol` CSS class) — no new CSS class or color needed, only new polygon coordinates.

## Code changes

**`scripts/build-svg.mjs`:**

- New function `stairCornerSymbol(x, y, hasUp, hasDown, id = null)` — mirrors the signature and direction logic of the existing `stairSymbol()`, but emits the small corner-offset polygon described above instead of the centered one. Reuses `class="stair-symbol"`.
- `buildStairLayer(rooms, stairRooms, shopTypes)` no longer filters out rooms with a type. Instead, per stair room: call `stairSymbol()` if the room has no entry in `shopTypes`, otherwise call `stairCornerSymbol()`. The emitted element still uses `id="stair-<roomId>"` in both cases — no change needed in `svg-renderer.js`, whose route/position-highlight lookups (`#stair-${id}`) key off that same id regardless of which shape variant was drawn.
- `roomElement()` and the type-letter rendering are unchanged — the letter continues to render at full size, centered, unaffected by whether a corner badge is also present.

**Layer/toggle behavior:** the corner badge stays inside `<g id="layer-stairs">` alongside every other stair symbol, so the existing "Stairs" show/hide toggle (`ui/mapper.js`, right-click menu → `applyStairsState`) continues to control it exactly like any other stair indicator. No new toggle, no special-casing.

**Regeneration:** existing map SVGs pick this up automatically the next time `npm run build:svg` is run — `updateExistingSvg()` already regenerates the `layer-stairs` group in place from the DB, preserving hand-edited layers (`layer-artwork`, `layer-room-labels`, etc.).

## Tests

**`scripts/build-svg.test.mjs`:**

- Update the three existing `buildStairLayer` tests that currently assert suppression for a room with a shop type (`'suppresses stair symbol for rooms with a shop type'` and the adjacent one that checks `r1` is skipped while `r2` isn't) — they should instead assert that `r1`'s emitted `<polygon id="stair-r1" ...>` points match `stairCornerSymbol(r1.x, r1.y, ...)`'s output exactly (imported and called directly in the test for comparison), confirming it's the corner variant and not the centered one.
- New `describe('stairCornerSymbol', ...)` block mirroring the existing `stairSymbol` tests: up-only, down-only, both-directions shapes; `id` attribute plumbing; asserting the polygon's points are the small corner-offset ones (not the full-size centered ones).

## Scope boundaries

**Not in scope:**
- Compact (3×3, half-width 1.5) and large (16×16, half-width 8) room variants — the DB currently has zero rooms where a stair and a type coincide on a compact or large room, so no special-cased geometry is designed for them. If this ever occurs, the corner badge would render using the standard-size offsets above, which may look slightly off-scale on a large room or crowd a compact room — acceptable as a non-goal until it's an actual case.
- The ASCII Map panel (`ui/ascii_map.js`, `src/ansi_map.lua`) — it has no room-type or stair concept at all; it renders the MUD server's raw `room.map` GMCP grid as-is.
- Any change to the up/down/both direction semantics or detection logic (`VERTICAL_EXITS`, `UP_DIRS`, `DOWN_DIRS`, `BOTH_DIRS` in `build-svg.mjs`) — unchanged.
- Light-theme legibility — inherits whatever `var(--fg)` resolves to today, same as the existing centered stair symbol and type letter.
