# mallardx-discworld-dbsearch — Design Spec

**Date:** 2026-06-09
**Plugin id:** `net.mallard.discworld-dbsearch`
**Depends on:** mallardx-discworld-mapper (build-time data source; runtime GMCP room tracking)
**Credit:** Database and search concept based on [Quow's Cow Bar and Minimap plugin](https://quow.co.uk/minimap.php) for MUSHClient by Quow.

---

## Overview

A Mallard plugin for Discworld MUD that exposes two commands:

- `dbsearch <type> <query>` — searches Quow's map database for rooms, shop items, NPC items, or NPCs matching a case-insensitive string. Displays up to 30 numbered results in the MUD output pane.
- `dbroute <number>` — computes a BFS shortest path from the player's current room to the result's room and creates a `dbwalk` alias in Discworld's alias system ready to execute.

No UI panel. All output goes through `mud.note()`. No runtime dependency on the mapper plugin beyond GMCP `room.info` (which the mapper also uses); the search data is generated at build time.

---

## File Structure

```
mallardx-discworld-dbsearch/
├── plugin.toml
├── README.md
├── package.json
├── scripts/
│   └── build-db.mjs          # SQLite → Lua data tables
├── src/
│   ├── main.lua
│   └── data/                 # auto-generated, committed
│       ├── rooms.lua
│       ├── items.lua
│       ├── npcs.lua
│       ├── npc_items.lua
│       └── exits.lua
└── ui/                       # empty (no panels)
```

---

## plugin.toml

```toml
id                  = "net.mallard.discworld-dbsearch"
name                = "Discworld DB Search"
version             = "0.1.0"
description         = "Search Quow's Discworld map database for rooms, items, shops and NPCs, and speedwalk to any result. Requires mallardx-discworld-mapper."
language            = "lua"
entry               = "src/main.lua"
mallard_api_version = "1.0"
minimum_app_version = "0.6.0"
authors             = ["Wizard Quack"]
license             = "MIT"

[worlds]
match = ["discworld.starturtle.net:*"]

[permissions]
sends       = true
gmcp_access = ["room.info"]

[gmcp]
advertise = ["room.info"]
```

---

## Data Layer

### Build script: `scripts/build-db.mjs`

Node.js ESM script using `better-sqlite3`. Accepts an optional `--db <path>` flag; defaults to `../mallardx-discworld-mapper/maps/_quowmap_database.db`.

Run with: `npm run build:data`
Or with custom path: `npm run build:data -- --db /path/to/_quowmap_database.db`

Generates five files under `src/data/`, overwriting any existing content. Each file returns a plain Lua table.

### Generated tables

**`src/data/rooms.lua`** — keyed by room_id, value is room_short:
```lua
return {
  ["f1aaac4f414f1b99..."] = "dining room",
  ...
}
```
Source: `SELECT room_id, room_short FROM rooms`

**`src/data/items.lua`** — array of shop items with locations:
```lua
return {
  { name = "long sword", room_id = "abc123...", location = "weapon shop", price = "A$180" },
  ...
}
```
Source: `SELECT si.item_name, si.room_id, si.sale_price, r.room_short FROM shop_items si JOIN rooms r ON si.room_id = r.room_id`

**`src/data/npcs.lua`** — array of NPCs with locations:
```lua
return {
  { name = "Archchancellor Mustrum Ridcully", room_id = "def456...", location = "Archchancellor's office" },
  ...
}
```
Source: `SELECT ni.npc_name, ni.room_id, r.room_short FROM npc_info ni JOIN rooms r ON ni.room_id = r.room_id`

**`src/data/npc_items.lua`** — array of NPC-carried items with NPC name and location:
```lua
return {
  { name = "long sword", npc = "guard thief", room_id = "ghi789...", location = "Thieves' Guild kitchen", price = "" },
  ...
}
```
Source: `SELECT nit.item_name, ni.npc_name, ni.room_id, r.room_short, nit.sale_price FROM npc_items nit JOIN npc_info ni ON nit.npc_id = ni.npc_id JOIN rooms r ON ni.room_id = r.room_id`

**`src/data/exits.lua`** — keyed by room_id, value is a table of exit direction → neighbour room_id:
```lua
return {
  ["f1aaac4f..."] = { n = "b36f2c4a...", e = "4307b680..." },
  ...
}
```
Source: `SELECT room_id, connect_id, exit FROM room_exits`

---

## Lua Logic (`src/main.lua`)

### Module-level state

```lua
local rooms     = require("data.rooms")
local items     = require("data.items")
local npcs      = require("data.npcs")
local npc_items = require("data.npc_items")
local exits     = require("data.exits")

local last_results   = {}   -- array of { room_id, label }
local current_room   = nil  -- updated by GMCP room.info
```

### GMCP room tracking

```lua
gmcp.on("room.info", function(_, data)
  if type(data) == "table" and data.identifier then
    current_room = data.identifier
  end
end)
```

### `dbsearch` alias

Pattern: `^dbsearch (%a+)%s+(.+)$`

1. Normalise type to lowercase; reject unknown types with usage hint.
2. Run case-insensitive linear scan against the appropriate data table using `string.lower()`.
3. Collect up to 30 matches into `last_results`, each entry `{ room_id = ..., label = ... }`.
4. Print header, numbered result lines, footer with `dbroute` instruction.

Output format:
```
  DB Search: npc — "wizard"        (2 results)
  ──────────────────────────────────────────────
   1.  wizard                    [Broad Way]
   2.  court wizard              [Palace grounds, Ankh-Morpork]
  ──────────────────────────────────────────────
  Use  dbroute <number>  to navigate to a result.
```

If zero results: `No results found for "wizard" (type: npc).`
If type unknown: `Unknown type "foo". Valid types: room, item, npcitem, npc`

### `dbroute` alias

Pattern: `^dbroute (%d+)$`

1. Parse number; error if out of range or `last_results` is empty.
2. Error if `current_room` is nil (not yet in a tracked room).
3. BFS from `current_room` to `result.room_id` through `exits` table (Quow's algorithm, adapted from QuowMinimap.xml). Credit Quow in comment.
4. Assemble move string as `dir;dir;dir;...`
5. Send to MUD: `alias dbwalk <move_string>`
6. Print result:

```
  Route to "Palace grounds, Ankh-Morpork" — 22 moves.
  Alias 'dbwalk' created. Type 'dbwalk' to begin.
```

Edge cases:
- No path found: `Could not find a route. You may be in an untracked area, or the destination is unreachable.`
- Route > 140 moves: append Quow's idle-queue warning.
- `current_room == result.room_id`: `You are already there.`

### BFS pathfinding

Direct Lua port of `QuowRoutefind` from QuowMinimap.xml. Iterative BFS using arrays (not recursion) to avoid stack overflow on deep paths. Search depth capped at 500 iterations. Returns the semicolon-separated direction string, or empty string on failure.

---

## Colours

Uses `mud.note()` with `fg` option throughout. Palette:

| Element              | Colour  |
|----------------------|---------|
| Header / footer rule | `#555555` (dim) |
| Search type + query  | `#ffcc88` (orange) |
| Result number        | `#aaaaff` (lavender) |
| Result name          | `#ffffff` (white) |
| Location bracket     | `#88ccff` (cyan) |
| Price                | `#aaffaa` (green) |
| Error messages       | `#ff6666` (red) |
| Route success        | `#aaffaa` (green) |
| Instruction text     | `#888888` (muted) |

---

## Credits & Attribution

- Search database and pathfinding algorithm derived from **Quow's Cow Bar and Minimap** plugin for MUSHClient — © Quow, https://quow.co.uk/minimap.php
- Data sourced from `_quowmap_database.db` distributed with Quow's plugin package.
- This plugin's `src/data/*.lua` files are build artifacts derived from Quow's database. The source SQLite is bundled with mallardx-discworld-mapper; users need that plugin installed and must run `npm run build:data` to regenerate Lua tables after any DB update.

---

## Out of Scope

- No graphical minimap
- No bookmarks
- No shop-item appraisal lookup (the `items` general table has no location data)
- No formal mallard dependency enforcement (Mallard has no dependency resolver yet)
