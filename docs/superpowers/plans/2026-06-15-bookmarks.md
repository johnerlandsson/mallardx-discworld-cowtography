# Bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named, per-character persistent bookmarks to the `db` tool so players can save rooms by name and route back to them with `db bm <name>`.

**Architecture:** Extract a `route_to_room(room_id, display_name, walk_immediately)` helper from `do_route` so both search-result routing and bookmark routing share the same pathfinding logic. Bookmark data is stored in Mallard's persistent storage under a per-character key (`"bm_" .. mud.world.character`). Four new aliases handle list / add / rm / go, inserted before the `^db (.+)$` catch-all. The catch-all gets one extra guard clause so it does not double-fire on `db bm` input.

**Tech Stack:** Lua 5.4, Mallard plugin API (`mud.alias`, `storage.get/set`, `mud.world.character`), `m:raw(n)` for alias captures.

---

### Task 1: Extract `route_to_room` helper

**Files:**
- Modify: `src/main.lua` (around line 577 — the `do_route` function)

This refactor has no behaviour change. `do_route` becomes a thin wrapper; all pathfinding logic moves into `route_to_room` so bookmarks can call it too.

- [ ] **Step 1: Replace `do_route` with the helper + thin wrapper**

Find the entire `do_route` function (lines ~577-622) and replace it with:

```lua
local function route_to_room(room_id, display_name, walk_immediately)
  if current_room == nil then
    note('  Current room unknown. Move through a mapped room first.', C.err)
    return
  end
  if current_room == room_id then
    note('  You are already there.', C.ok)
    return
  end

  local path, steps, route_rooms = pathfind.find_path(exits, current_room, room_id)
  if path == nil then
    note('  Could not find a route. You may be in an untracked area, or the destination is unreachable.', C.err)
    return
  end

  walk_steps = {}
  for dir in path:gmatch('[^;]+') do
    walk_steps[#walk_steps + 1] = dir
  end
  walk_target_name = display_name
  post_route(route_rooms)

  if steps > 140 then
    note('  Warning: long route. Discworld clears movement queues after 5 minutes of idle time.', C.header)
  end

  if walk_immediately then
    walk_pos = 1
    note(string.format('  Walking to "%s" — %d move%s.', display_name, steps, steps == 1 and '' or 's'), C.ok)
    mud.send(walk_steps[1])
  else
    walk_pos = 0
    note(string.format('  Route to "%s" — %d move%s. Type "db walk" to begin.', display_name, steps, steps == 1 and '' or 's'), C.ok)
  end
end

local function do_route(n, walk_immediately)
  if #last_results == 0 then
    note('  No search results. Run a db search first.', C.err)
    return
  end
  if n < 1 or n > #last_results then
    note(string.format('  Result %d out of range (1–%d).', n, #last_results), C.err)
    return
  end
  local target = last_results[n]
  route_to_room(target.room_id, target.location, walk_immediately)
end
```

- [ ] **Step 2: Verify existing tests still pass**

```bash
cd /home/john/dev/mallardx-discworld-cowtography
npm test
```

Expected: all tests pass (search and pathfind suites). This change is pure refactor — no behaviour should change.

- [ ] **Step 3: Commit**

```bash
git add src/main.lua
git commit -m "refactor(walk): extract route_to_room helper from do_route"
```

---

### Task 2: Add bookmark aliases

**Files:**
- Modify: `src/main.lua`
  - Add `bm_key()` helper just before the alias section (around line 624, after `do_route`)
  - Add 4 bookmark aliases just before `^db (.+)$` catch-all (around line 678)
  - Add one guard clause inside the existing `^db (.+)$` catch-all

**Background:** Mallard fires ALL matching aliases, not just the first. The `^db (.+)$` catch-all matches "db bm market" as well as the specific `^db bm (.+)$` alias. Without a guard, the catch-all would also trigger a room search for "bm market". Existing guards for `walk`, `clear`, `item`, etc. already follow this pattern.

- [ ] **Step 1: Add `bm_key()` helper after `do_route`**

Insert after the closing `end` of `do_route` (just before the `-- Specific patterns first, catch-all last.` comment):

```lua
local function bm_key()
  local ch = mud.world and mud.world.character
  if not ch or ch == '' then return nil end
  return 'bm_' .. ch
end
```

- [ ] **Step 2: Add 4 bookmark aliases before the catch-all**

Insert the following block just before `mud.alias([[^db (.+)$]], ...)`. The order matters: `^db bm add (.+)$` and `^db bm rm (.+)$` must appear before `^db bm (.+)$` so they take precedence.

```lua
mud.alias([[^db bm$]], function()
  local key = bm_key()
  if not key then
    note('  Character name not available.', C.err)
    return
  end
  local bmarks = storage.get(key) or {}
  local names = {}
  for name in pairs(bmarks) do names[#names + 1] = name end
  if #names == 0 then
    note('  No bookmarks.', C.muted)
    return
  end
  table.sort(names)
  note('  Bookmarks:', C.header)
  for _, name in ipairs(names) do
    note(string.format('  %-20s %s', name, bmarks[name].location), C.alt)
  end
end)

mud.alias([[^db bm add (.+)$]], function(m)
  local key = bm_key()
  if not key then
    note('  Character name not available.', C.err)
    return
  end
  if current_room == nil then
    note('  Current room unknown. Move through a mapped room first.', C.err)
    return
  end
  local name     = m:raw(1)
  local location = (last_payload and last_payload.name) or current_room
  local bmarks   = storage.get(key) or {}
  bmarks[name]   = { room_id = current_room, location = location }
  storage.set(key, bmarks)
  note(string.format('  Bookmarked "%s" as "%s".', location, name), C.ok)
end)

mud.alias([[^db bm rm (.+)$]], function(m)
  local key = bm_key()
  if not key then
    note('  Character name not available.', C.err)
    return
  end
  local name   = m:raw(1)
  local bmarks = storage.get(key) or {}
  if bmarks[name] == nil then
    note(string.format('  No bookmark named "%s".', name), C.err)
    return
  end
  bmarks[name] = nil
  storage.set(key, bmarks)
  note(string.format('  Removed bookmark "%s".', name), C.ok)
end)

mud.alias([[^db bm (.+)$]], function(m)
  local key = bm_key()
  if not key then
    note('  Character name not available.', C.err)
    return
  end
  local name   = m:raw(1)
  local bmarks = storage.get(key) or {}
  local entry  = bmarks[name]
  if entry == nil then
    note(string.format('  No bookmark named "%s".', name), C.err)
    return
  end
  route_to_room(entry.room_id, entry.location, false)
end)
```

- [ ] **Step 3: Add guard clause to the existing catch-all**

Find the existing `^db (.+)$` alias. It starts like this:

```lua
mud.alias([[^db (.+)$]], function(m)
  local arg = m:raw(1)
  if arg:match('^%d+$')      then return end
  if arg:match('^item%s')    then return end
  if arg:match('^shop%s')    then return end
  if arg:match('^npc%s')     then return end
  if arg:match('^npcitem%s') then return end
  if arg == 'walk' or arg == 'clear' then return end
  do_search('room', arg, nil)
end)
```

Add one guard line for `bm` so the catch-all skips all bookmark input:

```lua
mud.alias([[^db (.+)$]], function(m)
  local arg = m:raw(1)
  if arg:match('^%d+$')      then return end
  if arg:match('^item%s')    then return end
  if arg:match('^shop%s')    then return end
  if arg:match('^npc%s')     then return end
  if arg:match('^npcitem%s') then return end
  if arg == 'walk' or arg == 'clear' then return end
  if arg == 'bm' or arg:match('^bm%s') then return end
  do_search('room', arg, nil)
end)
```

- [ ] **Step 4: Run tests**

```bash
cd /home/john/dev/mallardx-discworld-cowtography
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main.lua
git commit -m "feat(bookmarks): add db bm commands for named room bookmarks"
```

---

### Task 3: Update `db` help output

**Files:**
- Modify: `src/main.lua` (the `^db$` alias, around line 626)

- [ ] **Step 1: Add bookmark lines to the help block**

Find the `^db$` alias and replace it with:

```lua
mud.alias([[^db$]], function()
  note("  db — search Quow's Discworld database", C.header)
  note('  ─────────────────────────────────────────────────────', C.rule)
  note('  db <room name>              search rooms', C.alt)
  note('  db npc <name>               search NPCs', C.alt)
  note('  db npc {<area>} <name>      search NPCs filtered by area', C.alt)
  note('  db item <name>              search shop items', C.alt)
  note('  db npcitem <name>           search items carried by NPCs', C.alt)
  note('  ─────────────────────────────────────────────────────', C.rule)
  note('  db <number>                 route to result and walk', C.alt)
  note('  db walk                     start or resume walking', C.alt)
  note('  db clear                    clear current route', C.alt)
  note('  ─────────────────────────────────────────────────────', C.rule)
  note('  db bm                       list bookmarks', C.alt)
  note('  db bm add <name>            bookmark current room', C.alt)
  note('  db bm rm <name>             remove bookmark', C.alt)
  note('  db bm <name>                route to bookmark', C.alt)
end)
```

- [ ] **Step 2: Run tests**

```bash
cd /home/john/dev/mallardx-discworld-cowtography
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/main.lua
git commit -m "feat(bookmarks): add bookmark commands to db help output"
```

---

### Task 4: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Bookmarks section after "Routing and walking"**

Find the block ending with:

```markdown
> You must be in a room tracked by the map data for routing and distance sorting to work.
```

Insert a new section immediately after it (before `---`):

```markdown
### Bookmarks

Save your current room as a named bookmark and route back to it at any time. Bookmarks are stored per character.

```
db bm                  — list all bookmarks
db bm add <name>       — bookmark current room as <name>
db bm rm <name>        — remove bookmark <name>
db bm <name>           — highlight route to <name>, then db walk to go
```

```
db bm add market       — saves current room as "market"
db bm market           — routes to your "market" bookmark
db walk                — starts walking the highlighted route
```

Saving a bookmark with a name that already exists overwrites silently.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add bookmarks section to README"
```

---

### Manual testing checklist

There is no automated test for alias behaviour — test in-game after loading the plugin:

- [ ] `db bm` with no bookmarks → "No bookmarks."
- [ ] `db bm add market` in a known room → "Bookmarked X as market."
- [ ] `db bm` → lists "market" with room name
- [ ] `db bm add market` again in a different room → overwrites silently, new room shown in list
- [ ] `db bm market` → highlights route on map, prints "Route to X — N moves. Type db walk to begin."
- [ ] `db walk` → starts walking to bookmarked room
- [ ] `db bm rm market` → "Removed bookmark market."
- [ ] `db bm rm market` again → "No bookmark named market."
- [ ] `db bm notexist` → "No bookmark named notexist."
- [ ] `db bm add foo` with no current room (pre-GMCP) → "Current room unknown."
- [ ] Reconnect and `db bm` → bookmarks persist
- [ ] Type `db` → help block shows all four `db bm` lines
- [ ] `db bm something that looks like a room name` does NOT trigger a room search
