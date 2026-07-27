# Known Issues

Bugs found while testing the `refactor-integration` branch. Confirmed present on
`main` too, so they predate the refactor and aren't caused by it. Deferred
until the refactoring work is done.

## PNG renderer: map doesn't recenter on current position when moving

Expected: as the player moves, the PNG map view recenters on the new current
position (mirrors `SvgRenderer#centerOn` being called on move). Actual: the
view stays put.

## PNG renderer: current-position indicator missing after switching maps

After exiting the library (and possibly on any map switch), the current-position
dot doesn't render. `look` does not bring it back — only moving does.

Likely two compounding issues:
- `PngRenderer#drawState` (`ui/png-renderer.js`) suppresses the dot on the
  first draw after load via `#mapJustLoaded`, when `target` is null — which
  it typically is right after a map switch.
- `mapper.js`'s `room_info` handler only calls `applyState` when
  `roomChanged || wasInDark`. A `look` in the same room doesn't change
  `current.roomId`, so it never re-triggers a draw — only an actual move
  (which changes the room) does, and by then `#mapJustLoaded` has already
  flipped to `false` so the redraw succeeds.

## SVG renderer: target position indicator invisible on green/water rooms

The target-room highlight doesn't show up on "green" rooms, and possibly
"water" rooms too (see `ui/data/room-green.json` / `ui/data/room-water.json`).
Likely a CSS specificity/z-order issue — the `.target` class styling may be
overridden by the green/water room styling.

## AMShades: map briefly shows, then flashes to "Unknown location"

Found while testing `refactor/main-lua-split`. Confirmed present on `main` too.

Entering the Shades from outside: the map correctly shows "ShadesEntrance"
briefly, then flips to the "Unknown location" special screen. Moving back out
works fine.
