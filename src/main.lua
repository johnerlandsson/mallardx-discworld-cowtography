-- src/main.lua
-- Discworld Cowtography — mallard plugin.
--
-- Map panel: mirrors room.info GMCP frames to the map iframe.
-- Commands:
--   dbsearch <type> <query>   type: room | item | npcitem | npc
--   dbroute <number>          route to result N, sets dbwalk alias
--   dbwalk                    walk to routed destination (GMCP-driven, with countdown)
--
-- Data credit: Quow's Cow Bar and Minimap plugin — https://quow.co.uk/minimap.php

local search    = require('search')
local pathfind  = require('pathfind')
local rooms     = require('data.rooms')
local items     = require('data.items')
local npcs      = require('data.npcs')
local npc_items = require('data.npc_items')
local exits     = require('data.exits')

local last_results = {}
local current_room = nil

-- ─── Map panel ───────────────────────────────────────────────────────────────

local panel        = mud.panel("map")
local last_payload = nil
local last_route   = nil

local function post_room(payload)
  panel:post("room_info", {
    identifier = payload.identifier,
    name       = payload.name,
    terrain    = payload.terrain,
    tx         = payload.tx,
    ty         = payload.ty,
  })
end

local function post_route(room_ids)
  last_route = room_ids
  panel:post("route_set", { rooms = room_ids })
end

local function post_route_clear()
  last_route = nil
  panel:post("route_clear", {})
end

panel:on_message("ready", function()
  if lib_in_library then
    if last_lib_position then panel:post("library_position", last_lib_position) end
    if last_lib_overlay  then panel:post("library_overlay",  last_lib_overlay)  end
  else
    if last_payload then post_room(last_payload) end
    if last_route   then panel:post("route_set", { rooms = last_route }) end
  end
end)

local MAX_DISPLAY = 10

local C = {
  rule     = '#555555',
  header   = '#ffcc88',
  name     = '#ffffff',
  alt      = '#cccccc',
  location = '#88ccff',
  price    = '#aaffaa',
  err      = '#ff6666',
  ok       = '#aaffaa',
  muted    = '#888888',
}

local function note(text, colour)
  mud.note(text, { fg = colour or C.name })
end

-- Count visual columns in a UTF-8 string (codepoints, not bytes).
local function vlen(s)
  local n, i = 0, 1
  while i <= #s do
    local b = s:byte(i)
    if     b < 0x80 then i = i + 1
    elseif b < 0xE0 then i = i + 2
    elseif b < 0xF0 then i = i + 3
    else                  i = i + 4 end
    n = n + 1
  end
  return n
end


-- ─── Walk state ──────────────────────────────────────────────────────────────

local walk_steps       = {}
local walk_pos         = 0
local walk_target_name = ''

-- ─── UU Library ──────────────────────────────────────────────────────────────
-- Directions in the library are relative (forward/backward/left/right).
-- Facing (n/s/e/w) is maintained by turn commands; strafing doesn't change it.
-- Distortions, orbs and l-space are overlaid on the map panel.

local lib_in_library      = false
local lib_facing          = 'n'
local lib_x               = 166      -- current position on map 47 (tile units)
local lib_y               = 4810
local lib_last_move       = nil      -- cardinal dir of last move attempt; consumed on GMCP
local lib_distortion_here = nil      -- 'n'|'e'|'s'|'w' or nil
local lib_orb_here        = false
local last_lib_overlay    = nil
local last_lib_position   = nil

local TURN_LEFT  = { n='w', w='s', s='e', e='n' }
local TURN_RIGHT = { n='e', e='s', s='w', w='n' }
local OPPOSITE   = { n='s', s='n', e='w', w='e' }

-- Shift position by one tile in cardinal direction; apply x-wrap (Quow §8890).
local function lib_apply_move(card)
  local nx = lib_x + ((card=='e' and 30) or (card=='w' and -30) or 0)
  local ny = lib_y + ((card=='n' and -30) or (card=='s' and  30) or 0)
  if     nx >= 262 then nx = nx - 240
  elseif nx <= 37  then nx = nx + 240
  end
  lib_x = nx
  lib_y = ny
end

local function relative_to_cardinal(rel)
  if     rel == 'up ahead of'    then return lib_facing
  elseif rel == 'to the right of' then return TURN_RIGHT[lib_facing]
  elseif rel == 'behind'          then return OPPOSITE[lib_facing]
  elseif rel == 'to the left of'  then return TURN_LEFT[lib_facing]
  end
  return lib_facing
end

local function post_library_overlay()
  local payload = {
    facing     = lib_facing,
    distortion = lib_distortion_here,
    orb        = lib_orb_here,
  }
  last_lib_overlay = payload
  panel:post("library_overlay", payload)
end

local function post_library_position()
  local payload = { x = lib_x, y = lib_y }
  last_lib_position = payload
  panel:post("library_position", payload)
end

-- Turn commands: rotate facing, pass command through to MUD.
mud.alias([[^turn (?:left|lt)$]], function(m)
  lib_facing = TURN_LEFT[lib_facing]
  mud.send(m.text)
  post_library_overlay()
end)

mud.alias([[^turn (?:right|rt)$]], function(m)
  lib_facing = TURN_RIGHT[lib_facing]
  mud.send(m.text)
  post_library_overlay()
end)

mud.alias([[^turn around$]], function(m)
  lib_facing = OPPOSITE[lib_facing]
  mud.send(m.text)
  post_library_overlay()
end)

-- Strafe/walk commands: record intended move direction; GMCP confirms arrival.
mud.alias([[^(?:forward|fw)$]], function(m)
  if lib_in_library then lib_last_move = lib_facing end
  mud.send(m.text)
end)

mud.alias([[^(?:backward|bw)$]], function(m)
  if lib_in_library then lib_last_move = OPPOSITE[lib_facing] end
  mud.send(m.text)
end)

mud.alias([[^(?:left|lt)$]], function(m)
  if lib_in_library then lib_last_move = TURN_LEFT[lib_facing] end
  mud.send(m.text)
end)

mud.alias([[^(?:right|rt)$]], function(m)
  if lib_in_library then lib_last_move = TURN_RIGHT[lib_facing] end
  mud.send(m.text)
end)

-- Distortion visible with known direction (fires when you look at the room).
mud.trigger([[^(?:> )?There is a strange distortion in space and time (.+) you!$]], function(m)
  lib_distortion_here = relative_to_cardinal(m[1])
  post_library_overlay()
end)

-- Distortion forming warning (direction unknown until you look).
mud.trigger([[^(?:> )?(?:You notice an odd rippling in the air\.|The awful sound of nails being dragged down a blackboard fills the area briefly\.|A distortion in time and space is forming!)$]], function()
  note('  A distortion is forming nearby! Type look to see where.', C.err)
end)

-- Distortion vanished or successfully sealed.
mud.trigger([[^(?:> )?The (?:distortion fades away|area seems more mundane than before|room seems to return to normal)\.$]], function()
  lib_distortion_here = nil
  post_library_overlay()
end)

-- Escaped spell orb visible in room.
mud.trigger([[(?:a|A) (?:tiny speck|small point|moderately-sized ball|large orb|substantial sphere) of energy is tracing a .+? pattern in the air]], function()
  lib_orb_here = true
  post_library_overlay()
end)

-- Escaped spell orb captured or destroyed.
mud.trigger([[^(?:> )?The (?:tiny speck|small point|moderately-sized ball|large orb|substantial sphere) of energy (?:collapses in on itself, then winks out|is absorbed into your|vanishes)]], function()
  lib_orb_here = false
  post_library_overlay()
end)

-- ─── World lifecycle ─────────────────────────────────────────────────────────

local function seed_room()
  local raw = gmcp.get("room.info")
  if raw then
    local id = raw:match('"identifier"%s*:%s*"([^"]+)"')
    if id then current_room = id end
  end
end

local function reset_walk()
  walk_steps       = {}
  walk_pos         = 0
  walk_target_name = ''
  post_route_clear()
end

seed_room()
world.on("connect",    seed_room)
world.on("disconnect", reset_walk)

-- ─── GMCP ────────────────────────────────────────────────────────────────────

gmcp.on('room.info', function(_, data)
  if type(data) == 'table' and data.identifier then
    current_room = data.identifier

    -- UU Library: clear per-room overlays on each room transition.
    lib_orb_here        = false
    lib_distortion_here = nil
    local entering_library = data.name and data.name:lower():find('library') ~= nil

    if entering_library then
      if not lib_in_library then
        -- Fresh entry from outside: reset position and facing.
        lib_facing = 'n'
        lib_x      = 166
        lib_y      = 4810
      elseif lib_last_move then
        -- Moving within library: apply the pending tile shift.
        -- Movement direction becomes the new forward (matches Quow sLastDir).
        lib_apply_move(lib_last_move)
        lib_facing = lib_last_move
      end
      lib_last_move  = nil
      lib_in_library = true
      post_library_overlay()
      post_library_position()
    else
      lib_in_library = false
      lib_last_move  = nil
      last_payload   = data
      post_room(data)
    end

    if walk_pos > 0 then
      if walk_pos < #walk_steps then
        walk_pos = walk_pos + 1
        local remaining = #walk_steps - walk_pos + 1
        mud.send(walk_steps[walk_pos])
        note(string.format('  %d move%s remaining.', remaining, remaining == 1 and '' or 's'), C.muted)
      else
        note(string.format('  Arrived at "%s".', walk_target_name), C.ok)
        walk_steps       = {}
        walk_pos         = 0
        walk_target_name = ''
        post_route_clear()
      end
    end
  end
end)

-- ─── Display ─────────────────────────────────────────────────────────────────

local TYPE_LABELS = {
  room    = 'room',
  item    = 'item (shop)',
  npcitem = 'npc item',
  npc     = 'npc',
}

local function display_results(search_type, query, results, sorted_by_dist)
  local count     = #results
  local sort_note = sorted_by_dist and ', nearest first' or ''
  local header    = string.format('  DB Search: %s \xe2\x80\x94 "%s"  (%d result%s%s)',
    TYPE_LABELS[search_type], query, count, count == 1 and '' or 's', sort_note)

  -- Build all content lines first so we can measure the widest one.
  local lines, colours = {}, {}
  for i, r in ipairs(results) do
    local dist_str = r.distance and string.format('  %d move%s', r.distance, r.distance == 1 and '' or 's') or ''
    local line
    if search_type == 'room' then
      line = string.format('  %2d.  %-44s%s', i, r.name, dist_str)
    elseif search_type == 'item' then
      local price = (r.price ~= '') and ('  ' .. r.price) or ''
      line = string.format('  %2d.  %-35s [%s]%s%s', i, r.name, r.location, price, dist_str)
    elseif search_type == 'npc' then
      line = string.format('  %2d.  %-35s [%s]%s', i, r.name, r.location, dist_str)
    elseif search_type == 'npcitem' then
      local price = (r.price ~= '') and ('  ' .. r.price) or ''
      line = string.format('  %2d.  %-28s  via %-22s  [%s]%s%s', i, r.name, r.npc or '', r.location, price, dist_str)
    end
    lines[i]   = line
    colours[i] = (i % 2 == 1) and C.name or C.alt
  end

  -- Rule spans the widest line (header or any content line).
  local max_w = vlen(header)
  for _, line in ipairs(lines) do
    local w = vlen(line)
    if w > max_w then max_w = w end
  end
  local rule = string.rep('\xe2\x94\x80', max_w - 2)

  note(header, C.header)
  note('  ' .. rule, C.rule)
  for i, line in ipairs(lines) do note(line, colours[i]) end
  note('  ' .. rule, C.rule)
  note('  Use  dbroute <number>  to navigate to a result.', C.muted)
end

-- ─── dbsearch ────────────────────────────────────────────────────────────────

mud.alias([[^dbsearch ([a-zA-Z]+)\s+(.+)$]], function(m)
  local search_type = string.lower(m[1])
  local query       = m[2]
  local candidates

  if search_type == 'room' then
    candidates = search.search_rooms(rooms, query)
  elseif search_type == 'item' then
    candidates = search.search_items(items, query)
  elseif search_type == 'npc' then
    candidates = search.search_npcs(npcs, query)
  elseif search_type == 'npcitem' then
    candidates = search.search_npc_items(npc_items, query)
  else
    note('  Unknown type "' .. search_type .. '". Valid types: room, item, npcitem, npc', C.err)
    return
  end

  if #candidates == 0 then
    note(string.format('  No results for "%s" (type: %s).', query, search_type), C.muted)
    last_results = {}
    return
  end

  local results
  local sorted_by_dist = false

  if current_room ~= nil then
    local dist = pathfind.distances_from(exits, current_room)
    -- Annotate with distance, drop unreachable
    local reachable = {}
    for _, r in ipairs(candidates) do
      local d = dist[r.room_id]
      if d ~= nil then
        r.distance = d
        reachable[#reachable + 1] = r
      end
    end
    table.sort(reachable, function(a, b) return a.distance < b.distance end)
    -- Cap at MAX_DISPLAY
    results = {}
    for i = 1, math.min(#reachable, MAX_DISPLAY) do
      results[i] = reachable[i]
    end
    sorted_by_dist = true
  else
    note('  (Room tracking inactive — showing unsorted results.)', C.muted)
    results = {}
    for i = 1, math.min(#candidates, MAX_DISPLAY) do
      results[i] = candidates[i]
    end
  end

  last_results = results

  if #results == 0 then
    note(string.format('  No reachable results for "%s" (type: %s).', query, search_type), C.muted)
    return
  end

  display_results(search_type, query, results, sorted_by_dist)
end)

-- ─── dbroute ─────────────────────────────────────────────────────────────────

mud.alias([[^dbroute (\d+)$]], function(m)
  local n = tonumber(m[1])

  if #last_results == 0 then
    note('  No search results yet. Run dbsearch first.', C.err)
    return
  end
  if n < 1 or n > #last_results then
    note(string.format('  Result %d out of range (1–%d).', n, #last_results), C.err)
    return
  end
  if current_room == nil then
    note('  Current room unknown. Move through a mapped room first.', C.err)
    return
  end

  local target = last_results[n]

  if current_room == target.room_id then
    note('  You are already there.', C.ok)
    return
  end

  local path, steps, route_rooms = pathfind.find_path(exits, current_room, target.room_id)
  if path == nil then
    note('  Could not find a route. You may be in an untracked area, or the destination is unreachable.', C.err)
    return
  end

  -- Build walk state
  walk_steps = {}
  for dir in path:gmatch('[^;]+') do
    walk_steps[#walk_steps + 1] = dir
  end
  walk_pos         = 0
  walk_target_name = target.location

  post_route(route_rooms)

  note(string.format('  Route to "%s" — %d move%s. Type dbwalk to begin.', target.location, steps, steps == 1 and '' or 's'), C.ok)

  if steps > 140 then
    note('  Warning: long route. Discworld clears movement queues after 5 minutes of idle time.', C.header)
  end
end)

-- ─── dbwalk ──────────────────────────────────────────────────────────────────

mud.alias([[^dbwalk$]], function()
  if #walk_steps == 0 then
    note('  No route set. Run dbroute first.', C.err)
    return
  end
  if walk_pos > 0 then
    note('  Already walking.', C.muted)
    return
  end
  walk_pos = 1
  note(string.format('  Walking to "%s" — %d move%s.', walk_target_name, #walk_steps, #walk_steps == 1 and '' or 's'), C.ok)
  mud.send(walk_steps[1])
end)

-- ─── dbclear ─────────────────────────────────────────────────────────────────

mud.alias([[^dbclear$]], function()
  walk_steps       = {}
  walk_pos         = 0
  walk_target_name = ''
  post_route_clear()
  note('  Route cleared.', C.muted)
end)

-- ─── libclear ────────────────────────────────────────────────────────────────
-- Manually clear library overlays (distortion + orb) without changing rooms.

mud.alias([[^libclear$]], function()
  lib_distortion_here = nil
  lib_orb_here        = false
  post_library_overlay()
  note('  Library overlays cleared.', C.muted)
end)
