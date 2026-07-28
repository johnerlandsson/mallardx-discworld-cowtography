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

local shades = require('cowtography.shades')
shades.init(panel_mod)

local medina = require('cowtography.medina')
medina.init(panel_mod)

local walk = require('cowtography.walk')

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

-- ─── AMShades ─────────────────────────────────────────────────────────────────
-- State, constants, description triggers, and the numbered-exit movement
-- observer now live in cowtography/shades.lua.

-- ─── BPMedina ─────────────────────────────────────────────────────────────────
-- State, constants, and description triggers now live in cowtography/medina.lua.

-- ─── Map panel ───────────────────────────────────────────────────────────────
-- panel/ascii_panel objects and post_room/post_route/post_route_clear now
-- live in cowtography/panel.lua; required and aliased above.

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
    shades.check_leaving(prev_room, state.current_room)
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
    post_target_clear(false)
    panel:post("room_dark", {})
    walk.advance_or_arrive()
  end
end)

-- ─── Walk state ──────────────────────────────────────────────────────────────
-- Now lives in cowtography/walk.lua (walk_paused's recalculate branch calls
-- back into route_to_room via walk.set_router(), wired below).

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
  if walk.get_pos() == 0 and walk.get_steps_count() > 0 then
    walk.clear_route()
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

-- AMShades numbered-exit movement observer now lives in cowtography/shades.lua.

mud.alias([[^stop$]], function(m)
  reset_walk()
  mud.send(m.text, { silent = true })
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

  local steps_list = {}
  for dir in path:gmatch('[^;]+') do
    steps_list[#steps_list + 1] = dir
  end
  walk.set_route(steps_list, route_rooms, display_name, room_id)
  post_route(route_rooms, display_name, steps)

  if steps > 140 then
    note('  Warning: long route. Discworld clears movement queues after 5 minutes of idle time.', C.header)
  end

  if walk_immediately then
    walk.walk()
  else
    mud.note(mud.span(string.format('  Route to "%s" — %d move%s. Type ', display_name, steps, steps == 1 and '' or 's'), { fg = C.ok })
          .. mud.span(p .. 'go', { fg = C.ok, on_click = function() walk.walk() end })
          .. mud.span(' to begin.', { fg = C.ok }))
  end
end

walk.set_router(function(...) return route_to_room(...) end)

panel:on_message("room_click", function(frame)
  route_to_room(frame.id, frame.name, false)
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

