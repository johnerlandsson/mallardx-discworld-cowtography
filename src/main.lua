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
--   bm [add|rm|<name>]        list, add, remove, or route to bookmarks
--   go [clear]                start/resume the current route, or clear it
--
-- Data credit: Quow's Cow Bar and Minimap plugin — https://quow.co.uk/minimap.php

local search    = require('search')
local pathfind  = require('pathfind')
local ansi_map  = require('ansi_map')
local rooms     = require('data.rooms')
local items     = require('data.items')
local npcs      = require('data.npcs')
local npc_items = require('data.npc_items')
local exits     = require('data.exits')
local map_names = require('data.map_names')

local colors = require('cowtography.colors')
local C, note, vlen = colors.C, colors.note, colors.vlen

local state = require('cowtography.state')
local exits_by_dir = state.exits_by_dir
local PLUGIN_ID     = state.PLUGIN_ID

local uu_library = require('cowtography.uu_library')
local panel_mod  = require('cowtography.panel')
local panel      = panel_mod.panel
local post_room, post_route, post_route_clear =
  panel_mod.post_room, panel_mod.post_route, panel_mod.post_route_clear

local last_results    = {}
local target_room          = nil   -- predicted position; nil when same as confirmed
local pred_queue           = {}    -- ordered sequence of predicted rooms [next, …, target]
local just_moved           = false -- true for one GMCP after a successful move
local prev_target_at_move  = nil   -- target_room captured when just_moved was last set
local _in_dark        = false

-- Room identifiers that show a named special screen instead of the map.
local SPECIAL_SCREENS = {
  RatFarm       = 'rat_farm',
  AbandonedMine = 'mines',
  Labyrinth     = 'labyrinth',
  SandelfonMaze = 'labyrinth',
}

-- ─── AMShades: 16 interior rooms share the GMCP identifier "AMShades" ────────
-- The entrance room has a real unique ID. Once we know which of the 17 rooms
-- we're in, every move is resolved deterministically from SHADES_DIR (the
-- exit typed, e.g. "3", maps straight to the destination room number) — see
-- the shades-movement on_send observer below. This mirrors Quow's sQSDir.
--
-- Description text triggers only matter for the (rare) case where we don't
-- yet know shades_room — fresh entry, or a move sent by something other than
-- the tracked on_send observer. 6 rooms have unique descriptions there;
-- the remaining 10 split into two ambiguous groups (ShadesGuess1: rooms
-- 1,10,11,13,14 / ShadesGuess2: rooms 3,4,6,7,15) disambiguated by checking
-- how many of the group are reachable from the previously confirmed room —
-- if exactly one, that must be the destination. This reachability check is
-- frequently ambiguous by itself (most rooms have 2+ same-group exits), which
-- is exactly why it's a fallback and not the primary resolution mechanism.
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
local shades_predicted  = false -- true when SHADES_DIR already resolved the room on send,
                                 -- so the AMShades GMCP handler shouldn't re-arm the guess triggers
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
-- panel/ascii_panel objects and post_room/post_route/post_route_clear now
-- live in cowtography/panel.lua; required and aliased above.

post_medina_room = function(room_id)
  if medina_identified then return end
  medina_identified = true
  medina_prev = room_id
  local frame = { identifier = room_id, name = medina_name }
  state.last_payload = frame
  post_room(frame)
end

post_shades_room = function(n)
  if shades_identified then return end
  shades_identified = true
  shades_room = n
  local id = shades_room_id(n)
  local frame = { identifier = id, name = shades_name }
  state.last_payload = frame
  post_room(frame)
end

local function post_target_move(room_id)
  panel:post("target_move", { identifier = room_id })
end

-- snap=true: pan the view back to the confirmed position (used when stopping
-- mid-route). snap=false (default): room_info will pan, no need to do it here.
local function post_target_clear(snap)
  pred_queue  = {}
  target_room = nil
  panel:post("target_clear", { snap = snap == true })
end

local MAX_DISPLAY = 10

local walk_steps        = {}
local walk_pos          = 0
local walk_target_name  = ''
local walk_target_id    = nil  -- destination room id, for auto-reroute if a pause lands us off-route
local walk_rooms        = {}   -- expected room id at each step (parallels walk_steps, one longer)
local walk_last_progress = 0   -- os.time() of the last confirmed step, for the stall watchdog

local function walk_arrived(name)
  note(string.format('  Arrived at "%s".', name), C.ok)
  walk_steps = {}; walk_pos = 0; walk_target_name = ''
  walk_rooms = {}; walk_target_id = nil
  post_route_clear()
  local snd = settings.get('walk_sound')
  if snd and snd ~= 'none' then mud.play_sound(snd) end
end

-- ─── UU Library ──────────────────────────────────────────────────────────────
-- State, aliases, and triggers now live in cowtography/uu_library.lua.

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
    if state.current_room == "BPMedina" then post_medina_room(id) end
  end)
end

-- The game randomizes the sentence structure of this generic room's
-- description ("You are standing in..." vs "This is a... and there are...");
-- both variants must trigger identification or the map is left stranded on
-- the Medina09 entry anchor.
local function medina_generic_room()
  if state.current_room ~= "BPMedina" or medina_identified then return end
  local room_id
  if     medina_exit_count == 5 then room_id = "Medina05"
  elseif medina_exit_count == 4 then room_id = "Medina13"
  elseif medina_exit_count == 2 then room_id = "Medina15"
  elseif medina_exit_count == 3 then
    if medina_prev and MEDINA_INNER[medina_prev] then room_id = "Medina14"
    else room_id = "Medina08" end
  end
  if room_id then post_medina_room(room_id) end
end

mud.trigger([[You are standing in a small winding alleyway]], medina_generic_room)
mud.trigger([[and there are other alleys leading off it]], medina_generic_room)

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
    if state.current_room == "AMShades" then post_shades_room(n) end
  end)
end

-- ShadesGuess1 (rooms 1,10,11,13,14): try to resolve via prev room.
mud.trigger([[no hope of ever escaping]], function()
  if state.current_room ~= "AMShades" or shades_identified then return end
  local n = shades_disambiguate(SHADES_GUESS1)
  if n then post_shades_room(n) end
end)

-- ShadesGuess2 (rooms 3,4,6,7,15): try to resolve via prev room.
mud.trigger([[Dim fires flicker]], function()
  if state.current_room ~= "AMShades" or shades_identified then return end
  local n = shades_disambiguate(SHADES_GUESS2)
  if n then post_shades_room(n) end
end)

-- ─── World lifecycle ─────────────────────────────────────────────────────────

local function seed_room()
  local raw = gmcp.get("room.info")
  if raw then
    local id = raw:match('"identifier"%s*:%s*"([^"]+)"')
    if id then state.current_room = id end
  end
end

local function reset_walk()
  walk_steps       = {}
  walk_pos         = 0
  walk_target_name = ''
  walk_rooms       = {}
  walk_target_id   = nil
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

settings.on("change", function(key, new_val, _old)
  if key == 'map_style' then
    panel:post("map_style", { style = new_val })
  end
end)

-- ─── Character name ──────────────────────────────────────────────────────────
-- char.info.capname is the authoritative per-character name from GMCP.
-- Mirrors the pattern from discworld-grouping: subscribe for live updates +
-- hydrate at startup so plugin reloads mid-session get the cached value.

local function apply_char_name(name)
  if type(name) == 'string' and name ~= '' then state.char_name = name end
end

apply_char_name(gmcp.get('char.info.capname'))

-- ─── GMCP ────────────────────────────────────────────────────────────────────

gmcp.on('char.info', function(_, data)
  if type(data) == 'table' then apply_char_name(data.capname) end
end)

gmcp.on('room.map', function(_, payload)
  if type(payload) ~= 'string' then return end
  panel_mod.post_ascii_rows(ansi_map.parse(payload))
end)

gmcp.on('room.info', function(_, data)
  if type(data) == 'table' and data.identifier then
    if _in_dark then
      _in_dark = false
      post_target_clear(false)
    end
    local prev_room = state.current_room
    state.current_room = data.identifier
    -- Leaving the Shades entirely: reset tracked position.
    if prev_room == "AMShades" and state.current_room ~= "AMShades" and state.current_room ~= SHADES_ENTRY_ID then
      shades_room      = nil
      shades_predicted = false
    end
    if state.current_room ~= prev_room then
      -- Actual movement: advance the prediction queue if this room was expected,
      -- otherwise the prediction is stale (locked door, teleport, etc.) — clear it.
      if target_room ~= nil then
        if pred_queue[1] == state.current_room then
          table.remove(pred_queue, 1)
          target_room = pred_queue[#pred_queue]  -- nil when we've arrived at the destination
        else
          post_target_clear(false)
        end
      end
      just_moved          = true
      prev_target_at_move = target_room  -- snapshot after possible clear/advance
    else
      -- Same-room re-confirmation: duplicate room.info after a move, or a blocked move.
      -- Suppress when just_moved AND target hasn't changed since we arrived here:
      -- that pattern is the duplicate room.info Discworld fires after a successful move.
      if target_room ~= nil and not (just_moved and target_room == prev_target_at_move) then
        post_target_clear(false)
      end
      just_moved = false
    end
    if state.room_id_echo then note('  ' .. state.current_room, C.name) end

    -- UU Library: clear per-room overlays on each room transition; identify
    -- library/L-space rooms. Returns false for rooms outside the subsystem.
    if not uu_library.handle_room(data) then
      local special = SPECIAL_SCREENS[data.identifier]
      if special then
          panel:post("special_screen", { name = special })
        elseif data.identifier == "AMShades" then
          -- Interior Shades rooms (1-16) all share this GMCP identifier.
          shades_name = data.name
          if shades_predicted then
            -- SHADES_DIR already resolved this move when the direction was sent
            -- (see the shades-movement on_send observer) — don't re-arm the
            -- guess triggers below and clobber a correct prediction.
            shades_predicted = false
          else
            -- No prediction for this move (fresh entry, or an untracked send
            -- like an alias) — fall back to description-trigger identification.
            shades_identified = false
            if prev_room ~= "AMShades" then
              -- Entering from outside: anchor map to entrance, treat prev as room 17.
              shades_room = 17
              local anchor = { identifier = "ShadesEntrance", name = data.name }
              state.last_payload = anchor
              post_room(anchor)
            end
          end
          -- Don't set _in_dark — description trigger (or the prediction above) posts the real position.
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
            state.last_payload = anchor
            post_room(anchor)
          end
        elseif data.identifier == SHADES_ENTRY_ID then
          -- Player is physically at the Shades entrance room — this GMCP
          -- identifier is unambiguous, so pin shades_room = 17 directly
          -- (this is the only place that happens for the entrance; the
          -- shades-movement observer needs it set to resolve exits "1"/"2"/"3"
          -- into the interior). GMCP confirming the entrance is authoritative,
          -- so any pending direction-based prediction is now moot.
          shades_room       = 17
          shades_identified = true
          shades_predicted  = false
          -- Use the clean fake ID so the mapper can find the ShadesEntrance
          -- entry in room-custom.js.
          local frame = { identifier = "ShadesEntrance", name = data.name }
          state.last_payload = frame
          post_room(frame)
        else
          state.last_payload = data
          post_room(data)
        end
      end
    if state.room_id_echo and shades_room then
      note(string.format('  shades_room=%s predicted=%s identified=%s',
        tostring(shades_room), tostring(shades_predicted), tostring(shades_identified)), C.muted)
    end

    if walk_pos > 0 then
      walk_last_progress = os.time()
      if walk_pos < #walk_steps then
        walk_pos = walk_pos + 1
        local remaining = #walk_steps - walk_pos + 1
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
      walk_last_progress = os.time()
      if walk_pos < #walk_steps then
        walk_pos = walk_pos + 1
        local remaining = #walk_steps - walk_pos + 1
        note(string.format('  %d move%s remaining.', remaining, remaining == 1 and '' or 's'), C.muted)
      else
        walk_arrived(walk_target_name)
      end
    end
  end
end)

-- ─── Walk state ──────────────────────────────────────────────────────────────
-- Shared by /go, /db, and /bm — either can create a route, and /go walks it.

-- Discworld queues commands sent while a movement queue is active, so the
-- verbose look fires as soon as the queued moves actually finish.
-- Fixed name, redefined (overwritten) on every walk — do_walk() already
-- guards against two walks running at once, so nothing else can be mid-
-- invocation of this alias when it's redefined.
local WALK_ALIAS_NAME = 'CowtographyWalk'

local function send_walk_steps()
  -- Sending each step as its own top-level command hit an internal
  -- Discworld command-queue cap around ~60-64 no matter how it was
  -- delivered: one mud.send() per step, or one call with the steps '\r\n'-
  -- joined into a single line (which correctly reads as separate commands
  -- to Discworld, ruling out this being only Mallard's bounded-channel
  -- bug — that fix stayed, this cap is Discworld's own). Its alias system
  -- doesn't share that cap: the identical route walked to completion in
  -- MUSHclient using Quow's plugin, which defines the whole route as a
  -- server-side alias and invokes it, rather than submitting the steps as
  -- top-level commands. ';' is only meaningful to Discworld as a separator
  -- *inside* an alias body (confirmed in-game — raw ';'-joined input isn't
  -- split at all), which is exactly this context.
  local parts = {}
  if settings.get('brief_verbose_look') then parts[#parts + 1] = 'brief look' end
  for _, step in ipairs(walk_steps) do parts[#parts + 1] = step end
  if settings.get('brief_verbose_look') then parts[#parts + 1] = 'verbose look' end
  mud.send('alias ' .. WALK_ALIAS_NAME .. ' ' .. table.concat(parts, ';'), { silent = true })
  mud.send(WALK_ALIAS_NAME, { silent = true })
end

local function do_walk()
  local p = mud.command_prefix()
  if #walk_steps == 0 then
    note(string.format('  No route set. Run "%sdb <number>" or "%sbm <name>" first.', p, p), C.err)
    return
  end
  if walk_pos > 0 then
    note('  Already walking.', C.muted)
    return
  end
  walk_pos = 1
  walk_last_progress = os.time()
  note(string.format('  Walking to "%s" — %d move%s.', walk_target_name, #walk_steps, #walk_steps == 1 and '' or 's'), C.ok)
  send_walk_steps()
  panel:post("walk_active", {})
end

local function do_clear_route()
  walk_steps       = {}
  walk_pos         = 0
  walk_target_name = ''
  walk_rooms       = {}
  walk_target_id   = nil
  post_route_clear()
  note('  Route cleared.', C.muted)
end

-- ─── Display ─────────────────────────────────────────────────────────────────

local TYPE_LABELS = {
  room    = 'place',
  item    = 'item',
  npcitem = 'npc item',
  npc     = 'npc',
}

local route_to_room  -- forward declaration; assigned below after panel setup

-- Discworld can clear a queued walk without printing any recognizable text,
-- so a stalled walk is detected either by that message or by the watchdog
-- further down. Both funnel here: keep the untraveled remainder of the route
-- instead of discarding it, so a plain /go resumes rather than forcing a
-- fresh /db or /bm.
local function walk_paused(reason)
  if walk_pos == 0 then return end
  local at_pos         = walk_pos
  local dest_id        = walk_target_id
  local dest_name      = walk_target_name
  local expected_room  = walk_rooms[at_pos]
  walk_pos = 0

  if expected_room and state.current_room and state.current_room ~= expected_room then
    -- We ended up somewhere the route didn't expect (dragged, teleported,
    -- portal, etc.) — the remaining directions are no longer valid.
    walk_steps = {}; walk_rooms = {}; walk_target_id = nil
    post_route_clear()
    note(string.format('  %s Position no longer matches the route — recalculating.', reason), C.header)
    route_to_room(dest_id, dest_name, false)
    return
  end

  walk_steps = { table.unpack(walk_steps, at_pos, #walk_steps) }
  walk_rooms = { table.unpack(walk_rooms, at_pos, #walk_rooms) }
  local remaining = #walk_steps
  post_route(walk_rooms, dest_name, remaining)
  local p = mud.command_prefix()
  mud.note(mud.span(string.format('  %s %d move%s remaining to "%s". Type ', reason, remaining, remaining == 1 and '' or 's', dest_name), { fg = C.header })
        .. mud.span(p .. 'go', { fg = C.header, on_click = function() do_walk() end })
        .. mud.span('.', { fg = C.header }))
end

local function display_results(search_type, query, results, sorted_by_dist)
  local p         = mud.command_prefix()
  local count     = #results
  local n_reachable = 0
  if sorted_by_dist then
    for _, r in ipairs(results) do
      if r.distance then n_reachable = n_reachable + 1 end
    end
  end
  local sort_note
  if sorted_by_dist then
    local n_unreachable = count - n_reachable
    if n_unreachable > 0 then
      sort_note = string.format(', %d reachable · %d unreachable', n_reachable, n_unreachable)
    else
      sort_note = ', nearest first'
    end
  else
    sort_note = ''
  end
  local header = string.format('  DB Search: %s \xe2\x80\x94 "%s"  (%d result%s%s)',
    TYPE_LABELS[search_type], query, count, count == 1 and '' or 's', sort_note)

  -- Build all content lines first so we can measure the widest one.
  local lines, colours = {}, {}
  for i, r in ipairs(results) do
    local unreachable = sorted_by_dist and not r.distance
    local dist_str
    if r.distance then
      dist_str = string.format('  %d move%s', r.distance, r.distance == 1 and '' or 's')
    elseif unreachable then
      dist_str = '  unreachable'
    else
      dist_str = ''
    end
    local map_str = r.map_name and ('  \xc2\xb7 ' .. r.map_name) or ''
    local line
    if search_type == 'room' then
      line = string.format('  %2d.  %-44s%s%s', i, r.name, map_str, dist_str)
    elseif search_type == 'item' then
      local price = (r.price ~= '') and ('  ' .. r.price) or ''
      line = string.format('  %2d.  %-35s [%s]%s%s%s', i, r.name, r.location, map_str, price, dist_str)
    elseif search_type == 'npc' then
      line = string.format('  %2d.  %-35s [%s]%s%s', i, r.name, r.location, map_str, dist_str)
    elseif search_type == 'npcitem' then
      local price = (r.price ~= '') and ('  ' .. r.price) or ''
      line = string.format('  %2d.  %-28s  via %-22s  [%s]%s%s%s', i, r.name, r.npc or '', r.location, map_str, price, dist_str)
    end
    lines[i]   = line
    colours[i] = unreachable and C.muted or ((i % 2 == 1) and C.name or C.alt)
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
-- Watch outgoing cardinal directions to advance the predicted position
-- (target_room) before GMCP confirms arrival — matching Quow's approach.
--
-- This is an *observer* (mud.on_send), not a consuming alias: the direction
-- flows to the wire and echoes normally (Source::Echo), instead of being
-- swallowed and re-sent — which is what made plain `n`/`north` render in the
-- client-command colour. Observing at the wire level also means numpad/keymap
-- movement now advances prediction, which a manual `mud.alias` on typed input
-- never saw. We skip our OWN sends (route-walking via send_walk_steps) so a
-- walk doesn't double-advance the prediction it already tracks.

local DIR_NORMALIZE = {
  n='n', north='n', ne='ne', northeast='ne', e='e', east='e',
  se='se', southeast='se', s='s', south='s', sw='sw', southwest='sw',
  w='w', west='w', nw='nw', northwest='nw', u='u', up='u', d='d', down='d',
}

mud.on_send([[^(n|ne|e|se|s|sw|w|nw|u|d|north|northeast|east|southeast|south|southwest|west|northwest|up|down)$]], function(m)
  if m.origin.plugin_id == PLUGIN_ID then return end
  if walk_pos == 0 and #walk_steps > 0 then
    do_clear_route()
  end
  local dir  = DIR_NORMALIZE[m[1]]
  local from = target_room or state.current_room
  if from then
    local by_dir = exits_by_dir[from]
    if by_dir then
      local next_id = by_dir[dir]
      if next_id then
        pred_queue[#pred_queue + 1] = next_id
        target_room = next_id
        post_target_move(target_room)
      end
    end
  end
end, { name = "movement-observer" })

-- AMShades numbered exits ("1".."8") aren't cardinal directions, so the
-- observer above never sees them. The maze's numbered layout is fully known
-- (SHADES_DIR mirrors Quow's sQSDir), so once shades_room is pinned down we
-- can resolve every subsequent move deterministically from the exit typed —
-- no need to wait for (and guess from) the room description. This mirrors
-- Quow's approach: description-trigger guessing is only a fallback for when
-- shades_room isn't known yet (see the AMShades GMCP handler above).
mud.on_send([[^([1-8])$]], function(m)
  if m.origin.plugin_id == PLUGIN_ID then return end
  if not shades_room then return end
  if state.current_room ~= "AMShades" and state.current_room ~= SHADES_ENTRY_ID then return end
  -- Mallard coerces purely-numeric captures to a Lua number (mirrors
  -- tonumber()), but SHADES_DIR's inner tables use string keys ("1", "2", …)
  -- to match Quow's sQSDir — tostring() back before indexing.
  local exits = SHADES_DIR[shades_room]
  local dest  = exits and exits[tostring(m[1])]
  if not dest then return end
  shades_identified = false  -- re-arm: this is a fresh move, not a re-confirmation
  shades_predicted  = true
  post_shades_room(dest)
end, { name = "shades-movement-observer" })

mud.alias([[^stop$]], function(m)
  reset_walk()
  mud.send(m.text, { silent = true })
end)

mud.trigger([[^(?:> )?Removed queue\.$]], function()
  walk_paused('Movement queue was cleared.')
end)

-- Fallback for interruptions that clear the queue without printing anything
-- the trigger above can match. Empirically, room arrivals during a normal
-- walk land 0-2s apart; 5s of silence mid-route means the queue emptied
-- unnoticed.
local WALK_STALL_SECONDS = 5
mud.every(1000, function()
  if walk_pos > 0 and os.time() - walk_last_progress >= WALK_STALL_SECONDS then
    walk_paused(string.format('No movement for %ds — you may have been interrupted.', WALK_STALL_SECONDS))
  end
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

  -- Annotate every candidate with its map name.
  for _, r in ipairs(candidates) do
    r.map_name = map_names[r.room_id]
  end

  local results
  local sorted_by_dist = false

  if state.current_room ~= nil then
    local dist = pathfind.distances_from(exits, state.current_room)
    for _, r in ipairs(candidates) do
      local d = dist[r.room_id]
      if d ~= nil then r.distance = d end
    end
    -- Reachable first (sorted by distance), then unreachable (sorted by name).
    table.sort(candidates, function(a, b)
      local ar, br = a.distance ~= nil, b.distance ~= nil
      if ar ~= br then return ar end
      if ar then return a.distance < b.distance end
      return (a.name or '') < (b.name or '')
    end)
    results = candidates
    sorted_by_dist = true
  else
    note('  (Room tracking inactive — showing unsorted results.)', C.muted)
    results = candidates
  end

  last_results = results

  local display = results
  if #display > 20 then display = {table.unpack(display, 1, 20)} end

  display_results(search_type, query, display, sorted_by_dist)
end

route_to_room = function(room_id, display_name, walk_immediately)
  local p = mud.command_prefix()
  if state.current_room == nil then
    note('  Current room unknown. Move through a mapped room first.', C.err)
    return
  end
  if state.current_room == room_id then
    note('  You are already there.', C.ok)
    return
  end

  local path, steps, route_rooms = pathfind.find_path(exits, state.current_room, room_id)
  if path == nil then
    note('  Could not find a route. You may be in an untracked area, or the destination is unreachable.', C.err)
    panel:post("route_error", { name = display_name })
    return
  end

  walk_steps = {}
  for dir in path:gmatch('[^;]+') do
    walk_steps[#walk_steps + 1] = dir
  end
  walk_target_name = display_name
  walk_target_id   = room_id
  walk_rooms       = route_rooms
  post_route(route_rooms, display_name, steps)

  if steps > 140 then
    note('  Warning: long route. Discworld clears movement queues after 5 minutes of idle time.', C.header)
  end

  if walk_immediately then
    walk_pos = 1
    walk_last_progress = os.time()
    note(string.format('  Walking to "%s" — %d move%s.', display_name, steps, steps == 1 and '' or 's'), C.ok)
    send_walk_steps()
    panel:post("walk_active", {})
  else
    walk_pos = 0
    mud.note(mud.span(string.format('  Route to "%s" — %d move%s. Type ', display_name, steps, steps == 1 and '' or 's'), { fg = C.ok })
          .. mud.span(p .. 'go', { fg = C.ok, on_click = function() do_walk() end })
          .. mud.span(' to begin.', { fg = C.ok }))
  end
end

panel:on_message("room_click", function(frame)
  route_to_room(frame.id, frame.name, false)
end)

panel:on_message("walk_request", function(_frame)
  do_walk()
end)

panel:on_message("clear_request", function(_frame)
  do_clear_route()
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
  return state.char_name and ('bm_' .. state.char_name) or 'bookmarks'
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

  do_search('room', args, nil)
end, {
  description = "Search Quow's Discworld database and navigate to results. Run with no arguments for full usage.",
  usage       = "db [<room>|npc|item|npcitem|route] [...]",
})

-- ─── bm ──────────────────────────────────────────────────────────────────────

mud.command("bm", function(m)
  local args = m.args

  if args == '' then
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

  local bm_add = args:match('^add%s+(.+)$')
  if bm_add then
    if state.current_room == nil then
      note('  Current room unknown. Move through a mapped room first.', C.err)
      return
    end
    local location = (state.last_payload and state.last_payload.name) or state.current_room
    local bmarks   = storage.get(bm_key()) or {}
    bmarks[bm_add] = { room_id = state.current_room, location = location }
    storage.set(bm_key(), bmarks)
    note(string.format('  Bookmarked "%s" as "%s".', location, bm_add), C.ok)
    return
  end

  local bm_rm = args:match('^rm%s+(.+)$')
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

  local bmarks = storage.get(bm_key()) or {}
  local entry  = bmarks[args]
  if entry == nil then
    note(string.format('  No bookmark named "%s".', args), C.err)
    return
  end
  route_to_room(entry.room_id, entry.location, false)
end, {
  description = "List, add, remove, and route to bookmarks.",
  usage       = "bm [add|rm|<name>] [...]",
})

-- ─── go ──────────────────────────────────────────────────────────────────────

mud.command("go", function(m)
  local args = m.args

  if args == '' then
    do_walk()
    return
  end

  if args == 'clear' then
    do_clear_route()
    return
  end

  note(string.format('  Usage: %sgo [clear]', mud.command_prefix()), C.err)
end, {
  description = "Start or resume walking the current route (set via /db or /bm), or clear it.",
  usage       = "go [clear]",
})

-- ─── dbid ────────────────────────────────────────────────────────────────────
-- Toggle printing of the current room ID on every room transition.
-- Useful when populating room-types.json and room-compact.json.

mud.alias([[^dbid$]], function()
  state.room_id_echo = not state.room_id_echo
  if state.room_id_echo then
    note('  Room ID echo ON.', C.ok)
    if state.current_room then note('  ' .. state.current_room, C.name) end
  else
    note('  Room ID echo OFF.', C.muted)
  end
end)

-- ─── ocd ─────────────────────────────────────────────────────────────────────
-- Re-centre the map on the current position without sending 'look' to the MUD.

local function do_ocd()
  if state.last_payload then
    post_room(state.last_payload)
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
  uu_library.clear_overlays()
  note('  Library overlays cleared.', C.muted)
end)

