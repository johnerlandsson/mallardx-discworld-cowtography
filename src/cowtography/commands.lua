-- src/cowtography/commands.lua
-- User-facing commands and aliases: db, bm, go, dbid, ocd, pan, zoom,
-- keyboard map navigation, libclear, stop.

-- injected via M.init()
local colors, state, uu_library, panel_mod, route, walk, gmcp_handlers
local C, note
local panel      -- panel_mod.panel
local post_room  -- panel_mod.post_room

local M = {}

function M.init(deps)
  colors, state, uu_library, panel_mod, route, walk, gmcp_handlers =
    deps.colors, deps.state, deps.uu_library, deps.panel, deps.route, deps.walk, deps.gmcp
  C, note   = colors.C, colors.note
  panel     = panel_mod.panel
  post_room = panel_mod.post_room
end

mud.alias([[^stop$]], function(m)
  gmcp_handlers.reset_walk()
  mud.send(m.text, { silent = true })
end)

-- ─── db ──────────────────────────────────────────────────────────────────────

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

return M
