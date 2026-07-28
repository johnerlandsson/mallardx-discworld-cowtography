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

local ansi_map  = require('ansi_map')

local colors = require('cowtography.colors')
local C, note, vlen = colors.C, colors.note, colors.vlen

local state = require('cowtography.state')

local uu_library = require('cowtography.uu_library')
local panel_mod  = require('cowtography.panel')
local panel      = panel_mod.panel
local post_room, post_route, post_route_clear =
  panel_mod.post_room, panel_mod.post_route, panel_mod.post_route_clear

local shades = require('cowtography.shades')
shades.init(panel_mod)

local medina = require('cowtography.medina')
medina.init(panel_mod)

local walk = require('cowtography.walk')

local prediction = require('cowtography.prediction')
prediction.init(panel_mod.panel)

local route = require('cowtography.route')

local _in_dark        = false

-- Room identifiers that show a named special screen instead of the map.
local SPECIAL_SCREENS = {
  RatFarm       = 'rat_farm',
  AbandonedMine = 'mines',
  Labyrinth     = 'labyrinth',
  SandelfonMaze = 'labyrinth',
}

-- ─── AMShades ─────────────────────────────────────────────────────────────────
-- State, constants, description triggers, and the numbered-exit movement
-- observer now live in cowtography/shades.lua.

-- ─── BPMedina ─────────────────────────────────────────────────────────────────
-- State, constants, and description triggers now live in cowtography/medina.lua.

-- ─── Map panel ───────────────────────────────────────────────────────────────
-- panel/ascii_panel objects and post_room/post_route/post_route_clear now
-- live in cowtography/panel.lua; required and aliased above.

local MAX_DISPLAY = 10

-- ─── UU Library ──────────────────────────────────────────────────────────────
-- State, aliases, and triggers now live in cowtography/uu_library.lua.

-- ─── World lifecycle ─────────────────────────────────────────────────────────

local function seed_room()
  local raw = gmcp.get("room.info")
  if raw then
    local id = raw:match('"identifier"%s*:%s*"([^"]+)"')
    if id then state.current_room = id end
  end
end

local function reset_walk()
  walk.reset_for_disconnect()
  prediction.clear(true)  -- snap view back; no room_info is coming
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
      prediction.clear(false)
    end
    local prev_room = state.current_room
    state.current_room = data.identifier
    shades.check_leaving(prev_room, state.current_room)
    prediction.on_transition(prev_room)
    if state.room_id_echo then note('  ' .. state.current_room, C.name) end

    -- UU Library: clear per-room overlays on each room transition; identify
    -- library/L-space rooms. Returns false for rooms outside the subsystem.
    if not uu_library.handle_room(data) then
      local special = SPECIAL_SCREENS[data.identifier]
      if special then
          panel:post("special_screen", { name = special })
        elseif shades.handle_room(data, prev_room) then
          -- Don't set _in_dark — description trigger (or the prediction above) posts the real position.
        elseif medina.handle_room(data, prev_room) then
          -- handled
        else
          state.last_payload = data
          post_room(data)
        end
      end
    if state.room_id_echo then
      local shades_room, shades_predicted, shades_identified = shades.debug_state()
      if shades_room then
        note(string.format('  shades_room=%s predicted=%s identified=%s',
          tostring(shades_room), tostring(shades_predicted), tostring(shades_identified)), C.muted)
      end
    end

    walk.advance_or_arrive()
  elseif type(data) == 'table' then
    -- Dark room: room.info without an identifier. Keep the map on last known position
    -- (muted) rather than tracking or showing a darkness overlay.
    _in_dark    = true
    prediction.clear(false)
    panel:post("room_dark", {})
    walk.advance_or_arrive()
  end
end)

-- ─── Walk state ──────────────────────────────────────────────────────────────
-- Now lives in cowtography/walk.lua (walk_paused's recalculate branch calls
-- back into route_to_room via walk.set_router(), wired below).

-- ─── Display ─────────────────────────────────────────────────────────────────
-- Now lives in cowtography/route.lua (display_results, do_search,
-- route_to_room, do_route, TYPE_LABELS, last_results, room_click handler).

-- ─── Movement prediction ─────────────────────────────────────────────────────
-- Now lives in cowtography/prediction.lua (cardinal-direction observer).
-- AMShades numbered-exit movement observer lives in cowtography/shades.lua.

mud.alias([[^stop$]], function(m)
  reset_walk()
  mud.send(m.text, { silent = true })
end)

-- ─── db ──────────────────────────────────────────────────────────────────────
-- do_search/route_to_room/do_route now live in cowtography/route.lua.

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
    route.do_route(tonumber(n), true)
    return
  end

  local route_n = args:match('^route%s+(%d+)$')
  if route_n then
    route.do_route(tonumber(route_n), false)
    return
  end

  local npc_area, npc_q = args:match('^npc%s+{([^}]+)}%s+(.+)$')
  if npc_area then
    route.do_search('npc', npc_q, npc_area)
    return
  end

  local npc_q2 = args:match('^npc%s+(.+)$')
  if npc_q2 then
    route.do_search('npc', npc_q2, nil)
    return
  end

  local item_q = args:match('^item%s+(.+)$')
  if item_q then
    route.do_search('item', item_q, nil)
    return
  end

  local shop_q = args:match('^shop%s+(.+)$')
  if shop_q then
    route.do_search('item', shop_q, nil)
    return
  end

  local npcitem_q = args:match('^npcitem%s+(.+)$')
  if npcitem_q then
    route.do_search('npcitem', npcitem_q, nil)
    return
  end

  route.do_search('room', args, nil)
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
            .. mud.span(text, { fg = C.alt, on_click = function() route.route_to_room(entry.room_id, entry.location, false) end }))
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
  route.route_to_room(entry.room_id, entry.location, false)
end, {
  description = "List, add, remove, and route to bookmarks.",
  usage       = "bm [add|rm|<name>] [...]",
})

-- ─── go ──────────────────────────────────────────────────────────────────────

mud.command("go", function(m)
  local args = m.args

  if args == '' then
    walk.walk()
    return
  end

  if args == 'clear' then
    walk.clear_route()
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

