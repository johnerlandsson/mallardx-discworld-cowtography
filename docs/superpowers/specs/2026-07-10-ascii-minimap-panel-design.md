# ASCII Minimap Panel — Design

## Summary

Add a new, optional Mallard panel that renders Discworld's live GMCP
`room.map` frame — the ANSI-coloured ASCII minimap the MUD normally prints
above `look`/`glance` — as its own panel, independent of the existing
SVG/PNG city-map panel this plugin already ships.

## Motivation

The existing "Map" panel renders Quow's pre-authored city maps (SVG/PNG)
with position tracking derived from `room.info` GMCP. That data is accurate
but static — hand-annotated per room. Discworld also generates a live
per-room ASCII minimap server-side and can deliver it over GMCP as
`room.map`, giving a second, complementary view that needs no per-room
map-data authoring and reflects transient game state (e.g. anything the
static maps don't capture).

## Data source

GMCP `room.map`. Confirmed (via `/home/john/src/discworld-tintin/src/gmcp.tin:99-110`
and Quow's reference implementation, `QuowMinimap.xml:14255-14294`) to carry:

- Standard ANSI SGR escapes (`\x1b[NNm`) for colour.
- Discworld's MXP colour-wrapper format around labelled text:
  `\x1b[4zmxp<colour>mxp>NAME\x1b[3z` — the same wrapper shape the sibling
  plugin `mallardx-discworld-mdt` already unwraps in `src/mxp.lua` for
  `room.writtenmap` entity names.

Delivered to Lua as a plain string via `gmcp.on`, matching the existing
pattern used for `room.info`/`char.info` in `src/main.lua` and for
`room.writtenmap` in the sibling `mdt` plugin's `src/main.lua`.

This plugin does **not** touch `room.writtenmap` (map-door-text /
entity-in-nearby-rooms data) — that's the `mallardx-discworld-mdt` plugin's
job.

## Manifest changes

`plugin.toml`:

```toml
[permissions]
gmcp_access = ["room.info", "char.info", "char.info.*", "char.info.capname", "room.map"]

[gmcp]
advertise = ["room.info", "char.info", "room.map"]

[panels.ascii_map]
title        = "ASCII Map"
entry        = "ui/ascii_map.html"
default_dock = "bottom"
default_size = { width = 480, height = 220 }
```

Mallard auto-builds the `Core.Supports.Set` handshake from every loaded
plugin's `[gmcp].advertise` list (confirmed in
`~/src/mallard/src-tauri/src/engine/handshake.rs`), so no manual
`core.hello`/`core.supports` negotiation code is needed in Lua.

## Lua wiring (`src/main.lua`)

- New panel handle: `local ascii_panel = mud.panel("ascii_map")`.
- `gmcp.on("room.map", function(_, payload) ... end)`: forwards the raw
  string to the panel via `ascii_panel:post("map_text", { raw = payload })`.
  Empty-string payload (no map available at this location — e.g. indoor
  rooms, special zones) is forwarded as-is; the panel shows an
  appropriate "no map here" state rather than stale content.
- On `ascii_panel:on_message("ready", ...)`: re-post the last known payload
  (if any), mirroring the existing map panel's rehydrate-on-open pattern.
- Track `last_ascii_room_id` (room the last non-empty `room.map` payload
  arrived for) against `current_room`. See "No-data notice" below.

## Panel rendering (`ui/ascii_map.html` / `ui/ascii_map.js` / `ui/ascii_map.css`)

- Monospace `<pre>`-style block.
- Small hand-rolled parser converts the raw string into HTML:
  1. Unwrap MXP colour wrappers (`\x1b[4zmxp<colour>mxp>...\x1b[3z`) to
     `<span style="color:...">inner text</span>`, porting the wrapper
     shape already handled by the sibling mdt plugin's `mxp.lua`
     (no click-to-route — see Scope cuts).
  2. Convert remaining ANSI SGR sequences (`\x1b[NNm`) to nested
     `<span>` colour/style state, closing spans on reset (`\x1b[0m`).
  3. Escape any literal HTML-significant characters in the remaining text
     before inserting.
- No interactivity in v1 (no click targets, no zoom/pan) — it's a
  read-only live snapshot.

## No-data notice (replaces the originally-proposed auto-fix button)

Earlier drafts of this design considered detecting a misconfigured
`options output map` setting and offering a one-click fix. That was
dropped: whether `options output map ...= off` actually suppresses the
`room.map` **GMCP** payload (as opposed to just the plain-text echo in a
terminal client) is unverified and evidence pointed both ways:

- The sibling `mdt` plugin works with **zero** config for its GMCP frame
  (`room.writtenmap`), suggesting GMCP delivery is independent of display
  settings.
- Quow's own reference implementation (`QuowMinimap.xml:14556-14574`)
  surfaces a warning recommending `options output map = top` specifically
  when *its* `room.map` handling comes up empty — but that implementation
  cross-checks against text lines Discworld also echoes to the terminal,
  so it may be validating its legacy trigger-based path rather than the
  GMCP payload itself.

Since we don't know the exact fix command with confidence, this plugin
does not send any config commands automatically. Instead:

- If the player has entered several (proposed: 3) normal, trackable rooms
  (same "not a special zone" gate already used for library/Shades/dark-room
  handling in `main.lua`) with no non-empty `room.map` payload ever
  received, the panel shows a static notice:

  > No map data received yet. If this persists, check your `options
  > output map` settings in-game.

- Any non-empty `room.map` payload clears the notice immediately and is
  never shown again for that session once data has been seen at least
  once.

**Open item, pending live testing:** the user is going to test with
`options output map` set to different values (`off`/`top`/etc.) against a
live Discworld connection and report which combination is actually
required for `room.map` GMCP data to arrive. Depending on the outcome,
this section (and possibly the no-data notice's wording, or reintroduction
of a fix affordance) may need revision before or shortly after
implementation. **Do not finalize the exact wording/threshold of the
no-data notice in the implementation plan until this is confirmed.**

## Scope cuts (explicit)

- No new plugin settings (panel visibility is controlled the normal
  Mallard way — show/hide — matching the existing Map panel).
- No auto-fix button / automatic config commands.
- No click-to-route or other interactivity from the ASCII panel.
- No parsing of `room.writtenmap` (sibling `mdt` plugin's job).

## Testing

- Lua-side: unit tests (matching existing `tests/*.lua` conventions) for
  the MXP/ANSI-to-HTML conversion, covering: plain text, single SGR
  colour, SGR reset, nested MXP wrapper (colour + link), empty payload.
- Manual: verified live against the MUD per the open item above.
