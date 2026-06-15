-- src/main.lua
-- Discworld Cowtography — mallard plugin.
--
-- Map panel: mirrors room.info GMCP frames to the map iframe.
-- Commands:
--   db <place>                search rooms by name
--   db npc [<{area}>] <name>  search NPCs, optionally filtered by area
--   db item <name>            search shop items
--   db shop <name>            alias for db item
--   db <number>               route to result N and start walking immediately
--   db walk                   start/resume last route
--   db clear                  clear current route
--
-- Data credit: Quow's Cow Bar and Minimap plugin — https://quow.co.uk/minimap.php

local search    = require('search')
local pathfind  = require('pathfind')
local rooms     = require('data.rooms')
local items     = require('data.items')
local npcs      = require('data.npcs')
local npc_items = require('data.npc_items')
local exits     = require('data.exits')

-- Invert exits into direction-keyed lookup: exits_by_dir[roomId][dir] = targetRoomId
local exits_by_dir = {}
for room_id, neighbors in pairs(exits) do
  local by_dir = {}
  for neighbor_id, dir in pairs(neighbors) do
    by_dir[dir] = neighbor_id
  end
  exits_by_dir[room_id] = by_dir
end

local last_results    = {}
local current_room    = nil
local target_room     = nil  -- predicted position; nil when same as confirmed
local room_id_echo    = false
local _in_dark        = false

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

local function post_target_move(room_id)
  panel:post("target_move", { identifier = room_id })
end

-- snap=true: pan the view back to the confirmed position (used when stopping
-- mid-route). snap=false (default): room_info will pan, no need to do it here.
local function post_target_clear(snap)
  target_room = nil
  panel:post("target_clear", { snap = snap == true })
end

panel:on_message("ready", function()
  local zoom = storage.get('zoom')
  if type(zoom) == 'table' then panel:post('zoom_data', zoom) end
  if lib_in_lspace then
    panel:post("lspace", {})
  elseif lib_in_library then
    if last_lib_position then panel:post("library_position", last_lib_position) end
    if last_lib_overlay  then panel:post("library_overlay",  last_lib_overlay)  end
  else
    if last_payload then post_room(last_payload) end
    if last_route   then panel:post("route_set", { rooms = last_route }) end
  end
end)

panel:on_message("save_zoom", function(data)
  local zoom = storage.get('zoom')
  if type(zoom) ~= 'table' then zoom = {} end
  zoom[tostring(data.mapId)] = data.w
  storage.set('zoom', zoom)
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
local lib_in_lspace       = false    -- true when lost in L-space (distinct from library)
local lib_facing          = 'n'
local lib_x               = 166      -- current position on map 47 (tile units)
local lib_y               = 4810
local lib_move_queue      = {}       -- pending cardinal moves; aliases push, GMCP pops
local lib_checkpoint      = nil      -- {x,y,facing} saved just before each GMCP-applied move
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
  if lib_in_library then table.insert(lib_move_queue, lib_facing) end
  mud.send(m.text)
end)

mud.alias([[^(?:backward|bw)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, OPPOSITE[lib_facing]) end
  mud.send(m.text)
end)

mud.alias([[^(?:left|lt)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, TURN_LEFT[lib_facing]) end
  mud.send(m.text)
end)

mud.alias([[^(?:right|rt)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, TURN_RIGHT[lib_facing]) end
  mud.send(m.text)
end)

-- Blocked-move handler. The UU Library returns one of three messages when
-- a direction is invalid. Since these mean the command wasn't processed,
-- GMCP never fires — we just discard the stale queue entry and clear any
-- checkpoint left over from the previous successful move.
mud.trigger([[^(?:> )?(?:What\?|That doesn't work\.|Try something else\.)\s*$]], function()
  if lib_in_library then
    lib_checkpoint = nil
    if #lib_move_queue > 0 then
      table.remove(lib_move_queue, 1)
    end
  end
  -- Do NOT clear target here: the direction alias didn't advance target_room when
  -- no exit was found, so target is still valid for any commands already queued.
  -- The GMCP handler clears target naturally when current_room catches up.
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

-- Escaped spell orb visible in room — capture size word for the panel.
mud.trigger([[(?:a|A) (tiny speck|small point|moderately-sized ball|large orb|substantial sphere) of energy is tracing a .+? pattern in the air]], function(m)
  lib_orb_here = m[1]
  post_library_overlay()
end)

-- Escaped spell orb captured or destroyed (various messages).
mud.trigger([[^(?:> )?The (?:tiny speck|small point|moderately-sized ball|large orb|substantial sphere) of energy (?:collapses in on itself, then winks out|is absorbed into your|vanishes)]], function()
  lib_orb_here = false
  post_library_overlay()
end)

mud.trigger([[(?:tiny speck|small point|moderately-sized ball|large orb|substantial sphere) of energy vanishes with a "Pop!"]], function()
  lib_orb_here = false
  post_library_overlay()
end)

-- L-space is detected from the room description rather than GMCP name,
-- since L-space rooms may share the "Library" name with regular rooms.
-- This fires after any GMCP-based library_position is already posted, so
-- the lspace message overrides it in the JS panel.
mud.trigger([[^(?:> )?You are somewhere in the depths of L-space\.]], function()
  lib_in_library = false
  lib_in_lspace  = true
  panel:post("lspace", {})
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
  post_target_clear(true)  -- snap view back; no room_info is coming
end

seed_room()
world.on("connect",    seed_room)
world.on("disconnect", reset_walk)

-- ─── GMCP ────────────────────────────────────────────────────────────────────

gmcp.on('room.info', function(_, data)
  if type(data) == 'table' and data.identifier then
    if _in_dark then
      _in_dark   = false
      target_room = nil
      post_target_clear(false)
    end
    local prev_room = current_room
    current_room = data.identifier
    if target_room == current_room then
      target_room = nil  -- room_info handles this atomically
    elseif target_room ~= nil and current_room == prev_room then
      -- GMCP re-confirmed the current room while a move was predicted — movement blocked.
      target_room = nil
      post_target_clear(false)
    end
    if room_id_echo then note('  ' .. current_room, C.name) end

    -- UU Library: clear per-room overlays on each room transition.
    lib_orb_here        = false
    lib_distortion_here = nil
    local name_lower      = (data.name or ''):lower()
    -- UU Library rooms have GMCP name "library" AND are absent from the rooms
    -- DB (no identifier entries). Other "library"-named rooms (Academy of
    -- Artificers, Genua, etc.) ARE in the DB, so the identifier lookup
    -- distinguishes them. L-space rooms ("mysterious library") fail the exact
    -- name match, so they fall through to the mysterious-name check below.
    local entering_library = name_lower == 'library'
                         and rooms[data.identifier] == nil

    if entering_library then
      if not lib_in_library then
        -- Fresh entry from outside: reset position, facing, and any stale queue.
        lib_facing     = 'n'
        lib_x          = 166
        lib_y          = 4810
        lib_move_queue = {}
      elseif #lib_move_queue > 0 then
        -- Moving within library: save a checkpoint for rollback (in case the
        -- "no exit" trigger fires after GMCP), then apply the queued move.
        lib_checkpoint = { x = lib_x, y = lib_y, facing = lib_facing }
        local move = table.remove(lib_move_queue, 1)
        lib_apply_move(move)
        lib_facing = move  -- facing updates to the direction physically moved
      end
      lib_in_library = true
      lib_in_lspace  = false
      post_library_overlay()
      post_library_position()
    else
      lib_in_library = false
      lib_move_queue = {}
      lib_checkpoint = nil
      if name_lower == 'mysterious library'
      or name_lower:find('maze of twisting') ~= nil then
        -- L-space rooms: "mysterious library", "maze of twisting shelves, all alike", etc.
        -- Post lspace directly to avoid resolveRoom finding map-56 DB entries.
        lib_in_lspace = true
        panel:post("lspace", {})
      else
        lib_in_lspace = false
        last_payload  = data
        post_room(data)
      end
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
  elseif type(data) == 'table' then
    -- Dark room: room.info without an identifier. Keep the map on last known position
    -- (muted) rather than tracking or showing a darkness overlay.
    _in_dark    = true
    post_target_clear(false)
    panel:post("room_dark", {})
    if walk_pos > 0 then
      if walk_pos < #walk_steps then
        walk_pos = walk_pos + 1
        local remaining = #walk_steps - walk_pos + 1
        mud.send(walk_steps[walk_pos])
        note(string.format('  %d move%s remaining.', remaining, remaining == 1 and '' or 's'), C.muted)
      else
        note(string.format('  Arrived at "%s".', walk_target_name), C.ok)
        walk_steps = {}; walk_pos = 0; walk_target_name = ''
        post_route_clear()
      end
    end
  end
end)

-- ─── Display ─────────────────────────────────────────────────────────────────

local TYPE_LABELS = {
  room    = 'place',
  item    = 'item',
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
  note('  db <number>         — route and walk immediately.', C.muted)
end

-- ─── Movement prediction ─────────────────────────────────────────────────────
-- Intercept cardinal directions to advance the predicted position (target_room)
-- before GMCP confirms arrival — matching Quow's approach.

local DIR_NORMALIZE = {
  n='n', north='n', ne='ne', northeast='ne', e='e', east='e',
  se='se', southeast='se', s='s', south='s', sw='sw', southwest='sw',
  w='w', west='w', nw='nw', northwest='nw', u='u', up='u', d='d', down='d',
}

mud.alias([[^(n|ne|e|se|s|sw|w|nw|u|d|north|northeast|east|southeast|south|southwest|west|northwest|up|down)$]], function(m)
  local dir  = DIR_NORMALIZE[m[1]]
  local from = target_room or current_room
  if from then
    local by_dir = exits_by_dir[from]
    if by_dir then
      local next_id = by_dir[dir]
      if next_id then
        target_room = next_id
        post_target_move(target_room)
      end
    end
  end
  mud.send(m[1])
end)

mud.alias([[^stop$]], function(m)
  reset_walk()
  mud.send(m.text)
end)

mud.trigger([[^(?:> )?Removed queue\.$]], function()
  reset_walk()
end)

-- ─── db ──────────────────────────────────────────────────────────────────────

local function do_search(search_type, query, area_filter)
  local candidates
  if search_type == 'room' then
    candidates = search.search_rooms(rooms, query)
  elseif search_type == 'item' or search_type == 'shop' then
    candidates = search.search_items(items, query)
    search_type = 'item'
  elseif search_type == 'npc' then
    candidates = search.search_npcs(npcs, query)
    if area_filter then
      local af = string.lower(area_filter)
      local filtered = {}
      for _, r in ipairs(candidates) do
        if string.find(string.lower(r.location), af, 1, true) then
          filtered[#filtered + 1] = r
        end
      end
      candidates = filtered
    end
  elseif search_type == 'npcitem' then
    candidates = search.search_npc_items(npc_items, query)
  else
    note('  Unknown type. Valid: room, npc, item, shop, npcitem', C.err)
    return
  end

  if #candidates == 0 then
    local area_note = area_filter and (' in {' .. area_filter .. '}') or ''
    note(string.format('  No results for "%s"%s.', query, area_note), C.muted)
    last_results = {}
    return
  end

  local results
  local sorted_by_dist = false

  if current_room ~= nil then
    local dist = pathfind.distances_from(exits, current_room)
    local reachable = {}
    for _, r in ipairs(candidates) do
      local d = dist[r.room_id]
      if d ~= nil then
        r.distance = d
        reachable[#reachable + 1] = r
      end
    end
    table.sort(reachable, function(a, b) return a.distance < b.distance end)
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
    local area_note = area_filter and (' in {' .. area_filter .. '}') or ''
    note(string.format('  No reachable results for "%s"%s.', query, area_note), C.muted)
    return
  end

  display_results(search_type, query, results, sorted_by_dist)
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

  walk_steps = {}
  for dir in path:gmatch('[^;]+') do
    walk_steps[#walk_steps + 1] = dir
  end
  walk_target_name = target.location
  post_route(route_rooms)

  if steps > 140 then
    note('  Warning: long route. Discworld clears movement queues after 5 minutes of idle time.', C.header)
  end

  if walk_immediately then
    walk_pos = 1
    note(string.format('  Walking to "%s" — %d move%s.', target.location, steps, steps == 1 and '' or 's'), C.ok)
    mud.send(walk_steps[1])
  else
    walk_pos = 0
    note(string.format('  Route to "%s" — %d move%s. Type "db walk" to begin.', target.location, steps, steps == 1 and '' or 's'), C.ok)
  end
end

-- Specific patterns first, catch-all last.

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
end)

mud.alias([[^db walk$]], function()
  if #walk_steps == 0 then
    note('  No route set. Run "db <number>" first.', C.err)
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

mud.alias([[^db (\d+)$]], function(m)
  do_route(tonumber(m:raw(1)), true)
end)

mud.alias([[^db npc\s+\{([^}]+)\}\s+(.+)$]], function(m)
  do_search('npc', m:raw(2), m:raw(1))
end)

mud.alias([[^db npc\s+([^{].*)$]], function(m)
  do_search('npc', m:raw(1), nil)
end)

mud.alias([[^db item\s+(.+)$]], function(m)
  do_search('item', m:raw(1), nil)
end)

mud.alias([[^db shop\s+(.+)$]], function(m)
  do_search('item', m:raw(1), nil)
end)

mud.alias([[^db npcitem\s+(.+)$]], function(m)
  do_search('npcitem', m:raw(1), nil)
end)

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

-- ─── db clear ────────────────────────────────────────────────────────────────

mud.alias([[^db clear$]], function()
  walk_steps       = {}
  walk_pos         = 0
  walk_target_name = ''
  post_route_clear()
  note('  Route cleared.', C.muted)
end)

-- ─── dbid ────────────────────────────────────────────────────────────────────
-- Toggle printing of the current room ID on every room transition.
-- Useful when populating room-types.json and room-compact.json.

mud.alias([[^dbid$]], function()
  room_id_echo = not room_id_echo
  if room_id_echo then
    note('  Room ID echo ON.', C.ok)
    if current_room then note('  ' .. current_room, C.name) end
  else
    note('  Room ID echo OFF.', C.muted)
  end
end)

-- ─── ocd ─────────────────────────────────────────────────────────────────────
-- Re-centre the map on the current position without sending 'look' to the MUD.

mud.alias([[^ocd$]], function()
  if last_payload then
    post_room(last_payload)
  else
    note('  Current position unknown.', C.muted)
  end
end)

-- ─── libclear ────────────────────────────────────────────────────────────────
-- Manually clear library overlays (distortion + orb) without changing rooms.

mud.alias([[^libclear$]], function()
  lib_distortion_here = nil
  lib_orb_here        = false
  post_library_overlay()
  note('  Library overlays cleared.', C.muted)
end)
