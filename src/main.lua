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

-- Room identifiers that show a named special screen instead of the map.
local SPECIAL_SCREENS = {
  RatFarm       = 'rat_farm',
  AbandonedMine = 'mines',
  Labyrinth     = 'labyrinth',
  SandelfonMaze = 'labyrinth',
}

-- ─── AMShades: 16 interior rooms share the GMCP identifier "AMShades" ────────
-- The entrance room has a real unique ID. The 16 inner rooms are identified by
-- long description text triggers (mirrors Quow's approach).
--
-- 6 rooms have unique descriptions; the remaining 10 split into two ambiguous
-- groups (ShadesGuess1: rooms 1,10,11,13,14 / ShadesGuess2: rooms 3,4,6,7,15).
-- For ambiguous rooms we check how many of the group are reachable from the
-- previously confirmed room — if exactly one, that must be the destination.
--
-- Room numbering 1-17 matches Quow's; 17 = entrance (has a real GMCP ID).
-- Navigation graph mirrors Quow's sQSDir: SHADES_DIR[from][exit] = to.

local SHADES_ENTRY_ID = "01bbd8b887e71314d8e358cbaf4f585391206bc4"

local SHADES_GUESS1 = { [1]=true, [10]=true, [11]=true, [13]=true, [14]=true }
local SHADES_GUESS2 = { [3]=true, [4]=true,  [6]=true,  [7]=true,  [15]=true }

local SHADES_DIR = {
  [1]  = {["5"]=2,  ["3"]=11, ["2"]=16, ["4"]=10, ["1"]=17},
  [2]  = {["4"]=3,  ["1"]=12, ["3"]=11, ["2"]=1},
  [3]  = {["1"]=4,  ["3"]=12, ["4"]=11, ["2"]=2},
  [4]  = {["1"]=5,  ["4"]=13, ["2"]=12, ["3"]=3},
  [5]  = {["6"]=4,  ["5"]=6,  ["1"]=14, ["2"]=13, ["3"]=12, ["7"]=3, ["4"]=7},
  [6]  = {["3"]=5,  ["1"]=7,  ["2"]=14, ["4"]=13},
  [7]  = {["3"]=14, ["4"]=6,  ["1"]=8,  ["2"]=15},
  [8]  = {["2"]=15, ["1"]=14, ["4"]=7,  ["3"]=9},
  [9]  = {["4"]=10, ["2"]=16, ["3"]=15, ["5"]=8,  ["1"]=17},
  [10] = {["4"]=1,  ["2"]=11, ["6"]=16, ["3"]=15, ["5"]=9,  ["1"]=17},
  [11] = {["6"]=2,  ["7"]=3,  ["3"]=12, ["5"]=13, ["4"]=16, ["1"]=10, ["2"]=1},
  [12] = {["7"]=3,  ["6"]=4,  ["2"]=5,  ["3"]=13, ["1"]=16, ["4"]=11, ["5"]=2},
  [13] = {["3"]=12, ["8"]=4,  ["1"]=5,  ["7"]=6,  ["6"]=14, ["5"]=15, ["4"]=16, ["2"]=11},
  [14] = {["1"]=13, ["2"]=5,  ["6"]=6,  ["7"]=7,  ["5"]=8,  ["3"]=15, ["4"]=16},
  [15] = {["2"]=16, ["3"]=13, ["5"]=14, ["7"]=7,  ["6"]=8,  ["1"]=9,  ["4"]=10},
  [16] = {["3"]=11, ["4"]=12, ["7"]=13, ["8"]=14, ["5"]=15, ["6"]=9,  ["2"]=10, ["1"]=1},
  [17] = {["1"]=1,  ["3"]=10, ["2"]=9},
}

local shades_room       = nil   -- current room number (1-16), 17 (entrance), or nil
local shades_name       = nil   -- GMCP room name from last AMShades event
local shades_identified = false -- guard against double-posting per room
local post_shades_room          -- forward declaration

local function shades_room_id(n)
  if n == 17 then return "ShadesEntrance" end
  if n < 10  then return "Shades0" .. n end
  return "Shades" .. n
end

-- Try to resolve an ambiguous guess group given the current confirmed room.
-- Returns the room number if exactly one member of the group is reachable, else nil.
local function shades_disambiguate(guess_group)
  if not shades_room then return nil end
  local exits = SHADES_DIR[shades_room]
  if not exits then return nil end
  local candidate = nil
  for _, dest in pairs(exits) do
    if guess_group[dest] then
      if candidate then return nil end
      candidate = dest
    end
  end
  return candidate
end

-- BPMedina: 18 rooms share one GMCP identifier. Identified by room description
-- text triggers (GMCP room.info doesn't carry the description field). Specific
-- descriptions match 13 rooms uniquely; the generic description is disambiguated
-- by exit count + previous Medina room (mirrors Quow's logic).
--
-- Rooms in the inner cluster — coming from one of these makes 3-exit
-- generic rooms more likely to be Medina14 than Medina08.
local MEDINA_INNER = {
  Medina10=true, Medina11=true, Medina13=true,
  Medina14=true, Medina16=true, Medina17=true, Medina18=true,
}
local medina_prev       = nil
local medina_name       = nil  -- data.name from last BPMedina GMCP event
local medina_exit_count = 0    -- exit count from last BPMedina GMCP event
local medina_identified = false -- guards against double-posting per room
local post_medina_room          -- forward declaration; body assigned after post_room

-- ─── Map panel ───────────────────────────────────────────────────────────────

local panel        = mud.panel("map")
local last_payload = nil
local last_route             = nil
local last_route_destination = nil
local last_route_steps       = nil

local function post_room(payload)
  panel:post("room_info", {
    identifier = payload.identifier,
    name       = payload.name,
    terrain    = payload.terrain,
    tx         = payload.tx,
    ty         = payload.ty,
  })
end

post_medina_room = function(room_id)
  if medina_identified then return end
  medina_identified = true
  medina_prev = room_id
  local frame = { identifier = room_id, name = medina_name }
  last_payload = frame
  post_room(frame)
end

post_shades_room = function(n)
  if shades_identified then return end
  shades_identified = true
  shades_room = n
  local id = shades_room_id(n)
  local frame = { identifier = id, name = shades_name }
  last_payload = frame
  post_room(frame)
end

local function post_route(room_ids, destination, steps)
  last_route             = room_ids
  last_route_destination = destination
  last_route_steps       = steps
  panel:post("route_set", { rooms = room_ids, destination = destination, steps = steps })
end

local function post_route_clear()
  last_route             = nil
  last_route_destination = nil
  last_route_steps       = nil
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
  local filters = storage.get('filters')
  if type(filters) == 'table' then panel:post('filters_data', filters) end
  if lib_in_lspace then
    panel:post("lspace", {})
  elseif lib_in_library then
    if last_lib_position then panel:post("library_position", last_lib_position) end
    if last_lib_overlay  then panel:post("library_overlay",  last_lib_overlay)  end
  else
    if last_payload then post_room(last_payload) end
    if last_route then
      panel:post("route_set", { rooms = last_route, destination = last_route_destination, steps = last_route_steps })
    end
  end
end)

local current_map = nil

panel:on_message("map_changed", function(data)
  current_map = data.name
  vars.set("cowtography.map", data.name)
  events.emit("cowtography:region_changed", { map = data.name })
end)

events.on("cowtography:region_request", function()
  if current_map then
    events.emit("cowtography:region_changed", { map = current_map })
  end
end)

panel:on_message("save_filters", function(data)
  storage.set('filters', data)
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

local walk_steps       = {}
local walk_pos         = 0
local walk_target_name = ''

local function walk_arrived(name)
  note(string.format('  Arrived at "%s".', name), C.ok)
  walk_steps = {}; walk_pos = 0; walk_target_name = ''
  post_route_clear()
  local snd = settings.get('walk_sound')
  if snd and snd ~= 'none' then mud.play_sound(snd) end
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
  mud.send(m.text, { silent = true })
  post_library_overlay()
end)

mud.alias([[^turn (?:right|rt)$]], function(m)
  lib_facing = TURN_RIGHT[lib_facing]
  mud.send(m.text, { silent = true })
  post_library_overlay()
end)

mud.alias([[^turn around$]], function(m)
  lib_facing = OPPOSITE[lib_facing]
  mud.send(m.text, { silent = true })
  post_library_overlay()
end)

-- Strafe/walk commands: record intended move direction; GMCP confirms arrival.
mud.alias([[^(?:forward|fw)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, lib_facing) end
  mud.send(m.text, { silent = true })
end)

mud.alias([[^(?:backward|bw)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, OPPOSITE[lib_facing]) end
  mud.send(m.text, { silent = true })
end)

mud.alias([[^(?:left|lt)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, TURN_LEFT[lib_facing]) end
  mud.send(m.text, { silent = true })
end)

mud.alias([[^(?:right|rt)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, TURN_RIGHT[lib_facing]) end
  mud.send(m.text, { silent = true })
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

-- ─── BPMedina: room description text triggers ───────────────────────────────
-- Discworld GMCP room.info doesn't carry description text, so we match the
-- room's long description as it appears in game output. Specific patterns
-- cover 13 uniquely-described rooms; the generic "You are standing" pattern
-- handles the remaining 5 (Medina05/08/13/14/15) by exit count + prev room.
-- Register specific patterns before the generic one so that when both could
-- fire on the same line (e.g. Medina16), the specific one wins first.
for _, entry in ipairs({
  { "and there are other alleys",  "Medina01" },
  { "head spins",                  "Medina02" },
  { "very narrow",                 "Medina03" },
  { "T-junction",                  "Medina04" },
  { "cross alleyways",             "Medina06" },
  { "decision is simple",          "Medina07" },
  { "Six alleys meet",             "Medina09" },
  { "Three alleyways merge",       "Medina10" },
  { "same place you were",         "Medina11" },
  { "the Aurient",                 "Medina12" },
  { "north and south",             "Medina16" },
  { "alleys twist and turn",       "Medina17" },
  { "dark and with",               "Medina18" },
}) do
  local id = entry[2]
  mud.trigger(entry[1], function()
    if current_room == "BPMedina" then post_medina_room(id) end
  end)
end

mud.trigger([[You are standing in a small winding alleyway]], function()
  if current_room ~= "BPMedina" or medina_identified then return end
  local room_id
  if     medina_exit_count == 5 then room_id = "Medina05"
  elseif medina_exit_count == 4 then room_id = "Medina13"
  elseif medina_exit_count == 2 then room_id = "Medina15"
  elseif medina_exit_count == 3 then
    if medina_prev and MEDINA_INNER[medina_prev] then room_id = "Medina14"
    else room_id = "Medina08" end
  end
  if room_id then post_medina_room(room_id) end
end)

-- ─── AMShades: room description text triggers ────────────────────────────────
-- 6 rooms have unique descriptions; patterns chosen to be unambiguous even
-- when "alley" and "alleyway" appear in similar sentences.
for _, entry in ipairs({
  { "alley in this rabbit",   2  },  -- Shades02: "alley" (not "alleyway") + "rabbit warren"
  { "smoky, hazy",            5  },  -- Shades05: "smoky, hazy alleys"
  { "alleyway in this rabbit", 8 },  -- Shades08: "alleyway" + "rabbit warren"
  { "leads to other dark dank", 9 }, -- Shades09: unique phrasing
  { "Howls of fear and pain", 12 },  -- Shades12: unique
  { "Lady is evidently",      16 },  -- Shades16: unique
}) do
  local n = entry[2]
  mud.trigger(entry[1], function()
    if current_room == "AMShades" then post_shades_room(n) end
  end)
end

-- ShadesGuess1 (rooms 1,10,11,13,14): try to resolve via prev room.
mud.trigger([[no hope of ever escaping]], function()
  if current_room ~= "AMShades" or shades_identified then return end
  local n = shades_disambiguate(SHADES_GUESS1)
  if n then post_shades_room(n) end
end)

-- ShadesGuess2 (rooms 3,4,6,7,15): try to resolve via prev room.
mud.trigger([[Dim fires flicker]], function()
  if current_room ~= "AMShades" or shades_identified then return end
  local n = shades_disambiguate(SHADES_GUESS2)
  if n then post_shades_room(n) end
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

-- ─── Settings ────────────────────────────────────────────────────────────────
-- Registering this handler opts into live settings updates: the plugin VM
-- stays alive across setting changes instead of being restarted.
-- walk_sound is read inline at point-of-use so no caching to update here.

settings.on("change", function(_key, _new, _old) end)

-- ─── Character name ──────────────────────────────────────────────────────────
-- char.info.capname is the authoritative per-character name from GMCP.
-- Mirrors the pattern from discworld-grouping: subscribe for live updates +
-- hydrate at startup so plugin reloads mid-session get the cached value.

local char_name = nil

local function apply_char_name(name)
  if type(name) == 'string' and name ~= '' then char_name = name end
end

apply_char_name(gmcp.get('char.info.capname'))

-- ─── GMCP ────────────────────────────────────────────────────────────────────

gmcp.on('char.info', function(_, data)
  if type(data) == 'table' then apply_char_name(data.capname) end
end)

gmcp.on('room.info', function(_, data)
  if type(data) == 'table' and data.identifier then
    if _in_dark then
      _in_dark   = false
      target_room = nil
      post_target_clear(false)
    end
    local prev_room = current_room
    current_room = data.identifier
    -- Leaving the Shades entirely: reset tracked position.
    if prev_room == "AMShades" and current_room ~= "AMShades" and current_room ~= SHADES_ENTRY_ID then
      shades_room = nil
    end
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
        local special = SPECIAL_SCREENS[data.identifier]
        if special then
          panel:post("special_screen", { name = special })
        elseif data.identifier == "AMShades" then
          -- Interior Shades rooms (1-16) all share this GMCP identifier.
          -- Description triggers below will call post_shades_room() to refine.
          shades_name       = data.name
          shades_identified = false
          if prev_room ~= "AMShades" then
            -- Entering from outside: anchor map to entrance, treat prev as room 17.
            shades_room = 17
            local anchor = { identifier = "ShadesEntrance", name = data.name }
            last_payload = anchor
            post_room(anchor)
          end
          -- Don't set _in_dark — description trigger will post the real position.
        elseif data.identifier == "BPMedina" then
          -- All 18 Medina rooms share this identifier. Description-based
          -- identification happens via mud.trigger (description text is not
          -- a GMCP field). Store state for those triggers to consume.
          medina_name       = data.name
          medina_exit_count = 0
          if type(data.exits) == 'table' then
            for _ in pairs(data.exits) do medina_exit_count = medina_exit_count + 1 end
          end
          medina_identified = false
          if prev_room ~= "BPMedina" then
            -- First entry: load the Medina map immediately. Text trigger will
            -- refine position once the room description arrives.
            local anchor = { identifier = "Medina09", name = data.name }
            last_payload = anchor
            post_room(anchor)
          end
        elseif data.identifier == SHADES_ENTRY_ID then
          -- Player is physically at the Shades entrance room. Use the clean
          -- fake ID so the mapper can find room-ShadesEntrance in the SVG.
          local frame = { identifier = "ShadesEntrance", name = data.name }
          last_payload = frame
          post_room(frame)
        else
          last_payload = data
          post_room(data)
        end
      end
    end

    if walk_pos > 0 then
      if walk_pos < #walk_steps then
        walk_pos = walk_pos + 1
        local remaining = #walk_steps - walk_pos + 1
        mud.send(walk_steps[walk_pos])
        note(string.format('  %d move%s remaining.', remaining, remaining == 1 and '' or 's'), C.muted)
      else
        walk_arrived(walk_target_name)
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
        walk_arrived(walk_target_name)
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

local route_to_room  -- forward declaration; assigned below after panel setup

local function display_results(search_type, query, results, sorted_by_dist)
  local p         = mud.command_prefix()
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
  for i, line in ipairs(lines) do
    local r = results[i]
    local pad, text = line:match('^(%s*)(.*)')
    mud.note(mud.span(pad, { fg = colours[i] })
          .. mud.span(text, { fg = colours[i], on_click = function() route_to_room(r.room_id, r.location, false) end }))
  end
  note('  ' .. rule, C.rule)
  note(string.format('  Click result to route · %sdb <number> to route and walk.', p), C.muted)
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
  mud.send(m[1], { silent = true })
end)

mud.alias([[^stop$]], function(m)
  reset_walk()
  mud.send(m.text, { silent = true })
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

route_to_room = function(room_id, display_name, walk_immediately)
  local p = mud.command_prefix()
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
  post_route(route_rooms, display_name, steps)

  if steps > 140 then
    note('  Warning: long route. Discworld clears movement queues after 5 minutes of idle time.', C.header)
  end

  if walk_immediately then
    walk_pos = 1
    note(string.format('  Walking to "%s" — %d move%s.', display_name, steps, steps == 1 and '' or 's'), C.ok)
    mud.send(walk_steps[1])
    panel:post("walk_active", {})
  else
    walk_pos = 0
    note(string.format('  Route to "%s" — %d move%s. Type "%sdb walk" to begin.', display_name, steps, steps == 1 and '' or 's', p), C.ok)
  end
end

panel:on_message("room_click", function(frame)
  route_to_room(frame.id, frame.name, false)
end)

panel:on_message("walk_request", function(_frame)
  if #walk_steps == 0 or walk_pos > 0 then return end
  walk_pos = 1
  note(string.format('  Walking to "%s" — %d move%s.',
    walk_target_name, #walk_steps, #walk_steps == 1 and '' or 's'), C.ok)
  mud.send(walk_steps[1])
  panel:post("walk_active", {})
end)

panel:on_message("clear_request", function(_frame)
  walk_steps       = {}
  walk_pos         = 0
  walk_target_name = ''
  post_route_clear()
  note('  Route cleared.', C.muted)
end)


local function do_route(n, walk_immediately)
  if #last_results == 0 then
    note('  No search results. Run a /db search first.', C.err)
    return
  end
  if n < 1 or n > #last_results then
    note(string.format('  Result %d out of range (1–%d).', n, #last_results), C.err)
    return
  end
  local target = last_results[n]
  route_to_room(target.room_id, target.location, walk_immediately)
end

local function bm_key()
  return char_name and ('bm_' .. char_name) or 'bookmarks'
end

mud.command("db", function(m)
  local args = m.args
  local p    = mud.command_prefix()

  if args == '' then
    note(string.format("  %sdb — search Quow's Discworld database", p), C.header)
    note('  ─────────────────────────────────────────────────────', C.rule)
    note(string.format('  %sdb <room name>             search rooms', p), C.alt)
    note(string.format('  %sdb npc <name>              search NPCs', p), C.alt)
    note(string.format('  %sdb npc {<area>} <name>     search NPCs filtered by area', p), C.alt)
    note(string.format('  %sdb item <name>             search shop items', p), C.alt)
    note(string.format('  %sdb npcitem <name>          search items carried by NPCs', p), C.alt)
    note('  ─────────────────────────────────────────────────────', C.rule)
    note(string.format('  %sdb <number>                route to result and walk', p), C.alt)
    note(string.format('  %sdb route <number>          set route without walking', p), C.alt)
    note(string.format('  %sdb walk                    start or resume walking', p), C.alt)
    note(string.format('  %sdb clear                   clear current route', p), C.alt)
    note('  ─────────────────────────────────────────────────────', C.rule)
    note(string.format('  %sdb bm                      list bookmarks', p), C.alt)
    note(string.format('  %sdb bm add <name>           bookmark current room', p), C.alt)
    note(string.format('  %sdb bm rm <name>            remove bookmark', p), C.alt)
    note(string.format('  %sdb bm <name>               route to bookmark', p), C.alt)
    return
  end

  if args == 'walk' then
    if #walk_steps == 0 then
      note(string.format('  No route set. Run "%sdb <number>" first.', p), C.err)
      return
    end
    if walk_pos > 0 then
      note('  Already walking.', C.muted)
      return
    end
    walk_pos = 1
    note(string.format('  Walking to "%s" — %d move%s.', walk_target_name, #walk_steps, #walk_steps == 1 and '' or 's'), C.ok)
    mud.send(walk_steps[1])
    panel:post("walk_active", {})
    return
  end

  if args == 'clear' then
    walk_steps       = {}
    walk_pos         = 0
    walk_target_name = ''
    post_route_clear()
    note('  Route cleared.', C.muted)
    return
  end

  local n = args:match('^(%d+)$')
  if n then
    do_route(tonumber(n), true)
    return
  end

  local route_n = args:match('^route%s+(%d+)$')
  if route_n then
    do_route(tonumber(route_n), false)
    return
  end

  local npc_area, npc_q = args:match('^npc%s+{([^}]+)}%s+(.+)$')
  if npc_area then
    do_search('npc', npc_q, npc_area)
    return
  end

  local npc_q2 = args:match('^npc%s+(.+)$')
  if npc_q2 then
    do_search('npc', npc_q2, nil)
    return
  end

  local item_q = args:match('^item%s+(.+)$')
  if item_q then
    do_search('item', item_q, nil)
    return
  end

  local shop_q = args:match('^shop%s+(.+)$')
  if shop_q then
    do_search('item', shop_q, nil)
    return
  end

  local npcitem_q = args:match('^npcitem%s+(.+)$')
  if npcitem_q then
    do_search('npcitem', npcitem_q, nil)
    return
  end

  if args == 'bm' then
    local bmarks = storage.get(bm_key()) or {}
    local names = {}
    for name in pairs(bmarks) do names[#names + 1] = name end
    if #names == 0 then
      note('  No bookmarks.', C.muted)
      return
    end
    table.sort(names)
    note('  Bookmarks:', C.header)
    for _, name in ipairs(names) do
      local entry = bmarks[name]
      local text = string.format('%-20s %s', name, entry.location)
      mud.note(mud.span('  ', { fg = C.alt })
            .. mud.span(text, { fg = C.alt, on_click = function() route_to_room(entry.room_id, entry.location, false) end }))
    end
    return
  end

  local bm_add = args:match('^bm%s+add%s+(.+)$')
  if bm_add then
    if current_room == nil then
      note('  Current room unknown. Move through a mapped room first.', C.err)
      return
    end
    local location = (last_payload and last_payload.name) or current_room
    local bmarks   = storage.get(bm_key()) or {}
    bmarks[bm_add] = { room_id = current_room, location = location }
    storage.set(bm_key(), bmarks)
    note(string.format('  Bookmarked "%s" as "%s".', location, bm_add), C.ok)
    return
  end

  local bm_rm = args:match('^bm%s+rm%s+(.+)$')
  if bm_rm then
    local bmarks = storage.get(bm_key()) or {}
    if bmarks[bm_rm] == nil then
      note(string.format('  No bookmark named "%s".', bm_rm), C.err)
      return
    end
    bmarks[bm_rm] = nil
    storage.set(bm_key(), bmarks)
    note(string.format('  Removed bookmark "%s".', bm_rm), C.ok)
    return
  end

  local bm_name = args:match('^bm%s+(.+)$')
  if bm_name then
    local bmarks = storage.get(bm_key()) or {}
    local entry  = bmarks[bm_name]
    if entry == nil then
      note(string.format('  No bookmark named "%s".', bm_name), C.err)
      return
    end
    route_to_room(entry.room_id, entry.location, false)
    return
  end

  do_search('room', args, nil)
end, {
  description = "Search Quow's Discworld database and navigate to results. Run with no arguments for full usage.",
  usage       = "db [<room>|npc|item|npcitem|walk|clear|bm] [...]",
})

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

local function do_ocd()
  if last_payload then
    post_room(last_payload)
  else
    note('  Current position unknown.', C.muted)
  end
end

mud.command("ocd", function()
  do_ocd()
end, {
  description = "Re-centre the map on the current position without sending 'look' to the MUD.",
  usage       = "ocd",
})

-- ─── pan ──────────────────────────────────────────────────────────────────────
-- Shift the map view without touching the mouse.

mud.command("pan", function(m)
  local dir_map = {
    n = "n", north = "n",
    s = "s", south = "s",
    e = "e", east  = "e",
    w = "w", west  = "w",
  }
  local dir = dir_map[m.args:lower()]
  if not dir then
    note(string.format('  Usage: %span n|s|e|w', mud.command_prefix()), C.err)
    return
  end
  panel:post("pan", { dir = dir })
end, {
  description = "Pan the map view north, south, east, or west.",
  usage       = "pan <n|s|e|w>",
})

-- ─── zoom ────────────────────────────────────────────────────────────────────
-- Zoom the map view in or out.

mud.command("zoom", function(m)
  local arg = m.args:lower()
  if arg ~= "in" and arg ~= "out" then
    note(string.format('  Usage: %szoom in|out', mud.command_prefix()), C.err)
    return
  end
  panel:post("zoom", { dir = arg })
end, {
  description = "Zoom the map view in or out.",
  usage       = "zoom <in|out>",
})

-- ─── keyboard map navigation ─────────────────────────────────────────────────
-- Focus the map panel so bare arrow keys pan and +/-/= zoom. Clicking the map
-- also grabs focus; Escape or clicking outside releases it.

mud.command("map_focus",   function() panel:post("grab_focus",    {}) end, { hidden = true })
mud.command("map_unfocus", function() panel:post("release_focus", {}) end, { hidden = true })

mud.keymap.activate("Cowtography")

-- ─── libclear ────────────────────────────────────────────────────────────────
-- Manually clear library overlays (distortion + orb) without changing rooms.

mud.alias([[^libclear$]], function()
  lib_distortion_here = nil
  lib_orb_here        = false
  post_library_overlay()
  note('  Library overlays cleared.', C.muted)
end)

