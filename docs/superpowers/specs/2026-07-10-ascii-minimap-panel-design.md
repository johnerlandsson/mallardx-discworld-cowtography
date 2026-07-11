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

> **Superseded by the implementation plan:** the "Lua wiring" and "Panel
> rendering" sections below describe the original plan — forward the raw
> string and parse ANSI/MXP in JS. The implementation plan
> (`docs/superpowers/plans/2026-07-10-ascii-minimap-panel.md`) refined this:
> parsing happens in Lua (`src/ansi_map.lua`, porting the sibling
> `mallardx-discworld-mdt` plugin's proven `parse_terrain` approach) into
> `{char, fg, bold}` cell rows, and the panel posts/consumes `"map_rows"`
> rather than raw text. Same intent, better implementation — read the plan
> for what actually shipped.

## Lua wiring (`src/main.lua`)

- New panel handle: `local ascii_panel = mud.panel("ascii_map")`.
- `gmcp.on("room.map", function(_, payload) ... end)`: forwards the raw
  string to the panel via `ascii_panel:post("map_text", { raw = payload })`.
  Empty-string payload (no map available at this location — e.g. indoor
  rooms, special zones) is forwarded as-is; the panel shows an
  appropriate "no map here" state rather than stale content.
- On `ascii_panel:on_message("ready", ...)`: re-post the last known payload
  (if any), mirroring the existing map panel's rehydrate-on-open pattern.
  No other state tracking needed: `room.map` arrives on every
  `look`/`glance` (confirmed live, see "Options investigation" below), so
  the panel is a direct passive mirror of the latest payload per room.

## Panel rendering (`ui/ascii_map.html` / `ui/ascii_map.js` / `ui/ascii_map.css`)

- Monospace `<pre>`-style block.
- Small hand-rolled parser converts the raw string into HTML:
  1. Convert ANSI SGR sequences — `\x1b[` followed by one or more
     `;`-separated numeric parameters and a trailing `m` (e.g. `\x1b[39;49m`,
     `\x1b[1;33m`, `\x1b[0m`) — to nested `<span>` colour/style state,
     closing spans on reset. Confirmed via a live capture
     (2026-07-10) that real payloads use this full compound form, not
     bare 2-digit codes — Quow's own stripping regex
     (`QuowMinimap.xml:14283`, `\\u001b%[%w%w`) only handles the latter and
     would mis-parse the former, so it is not a reference implementation
     to port here.
  2. Defensively unwrap MXP colour wrappers (`\x1b[4zmxp<colour>mxp>...\x1b[3z`)
     to `<span style="color:...">inner text</span>`, porting the wrapper
     shape already handled by the sibling mdt plugin's `mxp.lua`, in case
     they appear in some map contexts (none were observed in the
     2026-07-10 test capture, which was plain SGR only — no click-to-route
     regardless, see Scope cuts).
  3. Escape any literal HTML-significant characters in the remaining text
     before inserting.
- No interactivity in v1 (no click targets, no zoom/pan) — it's a
  read-only live snapshot.

## Options investigation — resolved

Earlier drafts of this design considered detecting a misconfigured
`options output map` setting and offering a one-click fix, then backed
that off to an uncertain "light fallback" pending live testing, since
evidence pointed both ways: the sibling `mdt` plugin needs zero config
for its GMCP frame (`room.writtenmap`), while Quow's reference client
(`QuowMinimap.xml:14556-14574`) warns players to check `options output
map` when its *own* map handling comes up empty.

**Live-tested and confirmed (2026-07-10):** a captured GMCP log cycling
`options output map glance/look` through every valid value (`off`, `top`,
`left`, `bottom`) shows the `room.map` and `room.writtenmap` GMCP frames
firing identically, byte-for-byte, on every `look`/`glance` regardless of
the setting. **`options output map` only controls a terminal client's
inline text rendering — it has no effect on the GMCP feed.** Quow's
warning was validating its own legacy trigger-based text path, not GMCP
delivery. There is nothing to detect or fix here; the feature is dropped
entirely.

## No-data notice

Some locations genuinely have no map to show (indoors, special zones,
etc.) — Discworld sends an empty `room.map` payload in that case (see
`QuowMinimap.xml:14267-14275`, the `sThisGMCP == ""` branch). The panel
shows a simple "No map for this location" state when the current
payload is empty, with no implication anything is misconfigured.

## Scope cuts (explicit)

- No new plugin settings (panel visibility is controlled the normal
  Mallard way — show/hide — matching the existing Map panel).
- No auto-fix button / automatic config commands.
- No click-to-route or other interactivity from the ASCII panel.
- No parsing of `room.writtenmap` (sibling `mdt` plugin's job).

## Testing

- Lua-side or JS-side (whichever layer ends up owning the conversion):
  unit tests covering plain text, single SGR colour, compound SGR
  (`1;33`), SGR reset, nested MXP wrapper (colour + link, defensive
  path), and empty payload.
- Manual: confirmed live (2026-07-10) that `room.map` arrives
  identically regardless of `options output map`; remaining manual
  verification is just visual — does the rendered panel match what the
  MUD intends the colours/glyphs to look like.
