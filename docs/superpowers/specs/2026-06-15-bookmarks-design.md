# Bookmarks Feature Design

**Date:** 2026-06-15
**Status:** Approved

## Overview

Add named, persistent bookmarks to the `db` tool. A bookmark saves the current room under a user-chosen name and lets you route back to it by name at any time. Bookmarks are stored per character so different characters on the same world have independent lists.

## Commands

```
db bm                  list all bookmarks for the current character (alphabetical)
db bm add <name>       save current room as <name>; overwrites silently if name exists
db bm rm <name>        delete bookmark <name>; warns if not found
db bm <name>           highlight route to <name>; use db walk to start walking
```

`db bm <name>` sets the route without auto-walking (same behaviour as `db <number>` after selecting a result manually). The player then types `db walk` to begin, matching the flow recommended by the MUD developer.

## Storage Layout

Key pattern: `"bm_" .. mud.world.character`

Value: a table keyed by bookmark name, each entry holding the room id and a display name captured at save time.

```lua
-- storage key: "bm_Quow"
{
  market = { room_id = "abc123", location = "Hubward Gate Market" },
  bank   = { room_id = "def456", location = "Ankh-Morpork Deposit Bank" },
}
```

`location` is taken from the rooms database entry for the room at save time, with the last GMCP `data.name` as fallback. If `mud.world.character` is nil (pre-login), all bookmark commands print an error and do nothing.

Storage is per-plugin, per-world in Mallard, so characters on different worlds are already isolated. The `"bm_" .. character` key pattern additionally isolates characters within the same world (e.g. multiple characters on Discworld MUD).

## Code Changes

### 1. Route helper (`src/main.lua`)

Extract the pathfinding and walk-state setup out of `do_route` into:

```lua
local function route_to_room(room_id, display_name, walk_immediately)
```

This function:
- Guards: current room unknown, same room as destination, no path found
- Populates `walk_steps`, `walk_target_name`
- Calls `post_route(route_rooms)`
- If `walk_immediately`: sets `walk_pos = 1`, sends first step
- Else: sets `walk_pos = 0`, prints "Route to X — N moves. Type db walk to begin."

`do_route` becomes a thin wrapper that resolves `last_results[n]` and delegates to `route_to_room`.

### 2. Bookmark aliases (`src/main.lua`)

Four new `mud.alias` calls, added before the existing `^db (.+)$` catch-all:

| Pattern | Behaviour |
|---|---|
| `^db bm add (.+)$` | Load bookmark table, write entry, save. Error if `current_room` is nil. |
| `^db bm rm (.+)$` | Load bookmark table, delete entry, save. Warn if name not found. |
| `^db bm (.+)$` | Load bookmark table, look up name, call `route_to_room(..., false)`. Error if not found. |
| `^db bm$` | Load bookmark table, print sorted list. Print "No bookmarks." if empty. |

Helper used by all four:

```lua
local function bm_key()
  local ch = mud.world and mud.world.character
  if not ch or ch == '' then return nil end
  return 'bm_' .. ch
end
```

### 3. Help output (`src/main.lua`)

Add to the `^db$` alias help block:

```
db bm                    list bookmarks
db bm add <name>         bookmark current room
db bm rm <name>          remove bookmark
db bm <name>             route to bookmark
```

### 4. README

Add a **Bookmarks** section under the db commands documentation describing the four commands and the route-then-walk flow.

## Error Cases

| Situation | Message |
|---|---|
| `mud.world.character` nil | "Character name not available." |
| `db bm <name>` — name not found | "No bookmark named '<name>'." |
| `db bm rm <name>` — name not found | "No bookmark named '<name>'." |
| `db bm add` — no current room | "Current room unknown. Move through a mapped room first." |
| `db bm <name>` — no path | Reuses existing route_to_room "Could not find a route." message |

## Out of Scope

- Editing a bookmark's name (delete + re-add)
- Sharing bookmarks across characters
- Bookmark groups or tags
- Panel UI for bookmarks
