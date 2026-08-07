-- src/cowtography/route.lua
-- Search-result display and route computation/dispatch. Shared by /db, /bm,
-- and the map panel's room-click handler.

local search = require('search')
local pathfind = require('pathfind')
local maps   = require('data.maps')

local M = {}

-- injected via M.init()
local state       -- cowtography.state module; also owns exits (see state.lua)
local panel       -- cowtography.panel module
local walk        -- cowtography.walk module
local blorps      -- cowtography.blorps module
local C, note, vlen -- colors.C, colors.note, colors.vlen
local exits -- state.exits

function M.init(deps)
  state  = deps.state
  panel  = deps.panel
  walk   = deps.walk
  blorps = deps.blorps
  C, note, vlen = deps.colors.C, deps.colors.note, deps.colors.vlen
  exits = state.exits

  walk.set_router(M.route_to_room)

  panel.panel:on_message("room_click", function(frame)
    M.route_to_room(frame.id, frame.name, false)
  end)
end

local TYPE_LABELS = {
  room    = 'place',
  item    = 'item',
  npcitem = 'npc item',
  npc     = 'npc',
}

local last_results = {}

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
    elseif unreachable and r.blorp_hint then
      dist_str = string.format('  unreachable · via blorp "%s" (%d move%s)',
        r.blorp_hint.name, r.blorp_hint.distance, r.blorp_hint.distance == 1 and '' or 's')
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
    local unreachable = sorted_by_dist and not r.distance
    local pad, text = line:match('^(%s*)(.*)')
    local text_opts = { fg = colours[i] }
    if not unreachable then
      text_opts.on_click = function() M.route_to_room(r.room_id, r.location, false) end
    end
    mud.note(mud.span(pad, { fg = colours[i] }) .. mud.span(text, text_opts))
  end
  note('  ' .. rule, C.rule)
  note(string.format('  Click result to route · %sdb <number> to route and walk.', p), C.muted)
end

function M.do_search(search_type, query, area_filter)
  local candidates
  if search_type == 'room' then
    candidates = search.search_rooms(query)
  elseif search_type == 'item' or search_type == 'shop' then
    candidates = search.search_items(query)
    search_type = 'item'
  elseif search_type == 'npc' then
    candidates = search.search_npcs(query)
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
    candidates = search.search_npc_items(query)
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

  -- Annotate every candidate with its map name. map_id may come back as a
  -- Lua number (real Mallard) or a string (LuaSQL in tests) — tostring()
  -- normalizes either into maps.lua's string keys (see search.lua and
  -- Global Constraints on map_id typing).
  for _, r in ipairs(candidates) do
    r.map_name = maps[tostring(r.map_id)]
  end

  local results
  local sorted_by_dist = false

  if state.current_room ~= nil then
    local dist = pathfind.distances_from(exits, state.current_room)
    for _, r in ipairs(candidates) do
      local d = dist[r.room_id]
      if d ~= nil then r.distance = d end
    end
    for _, r in ipairs(candidates) do
      if r.distance == nil then
        local hit = blorps.closest_reaching(exits, r.room_id)
        if hit then r.blorp_hint = hit end
      end
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

function M.route_to_room(room_id, display_name, walk_immediately)
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
    local hit = blorps.closest_reaching(exits, room_id)
    if hit then
      note(string.format('  Tip: blorp "%s" reaches it in %d move%s.', hit.name, hit.distance, hit.distance == 1 and '' or 's'), C.muted)
    end
    panel.panel:post("route_error", { name = display_name })
    return
  end

  local steps_list = {}
  for dir in path:gmatch('[^;]+') do
    steps_list[#steps_list + 1] = dir
  end
  walk.set_route(steps_list, route_rooms, display_name, room_id)
  panel.post_route(route_rooms, display_name, steps)

  if steps > 140 then
    note('  Warning: long route. Discworld clears movement queues after 5 minutes of idle time.', C.header)
  end

  local blorp_hit = blorps.closest_reaching(exits, room_id)
  if blorp_hit and blorp_hit.distance < steps then
    note(string.format('  Tip: blorp "%s" is %d move%s away — %d shorter.',
      blorp_hit.name, blorp_hit.distance, blorp_hit.distance == 1 and '' or 's', steps - blorp_hit.distance), C.muted)
  end

  if walk_immediately then
    walk.walk()
  else
    mud.note(mud.span(string.format('  Route to "%s" — %d move%s. Type ', display_name, steps, steps == 1 and '' or 's'), { fg = C.ok })
          .. mud.span(p .. 'go', { fg = C.ok, on_click = function() walk.walk() end })
          .. mud.span(' to begin.', { fg = C.ok }))
  end
end

function M.do_route(n, walk_immediately)
  if #last_results == 0 then
    note('  No search results. Run a /db search first.', C.err)
    return
  end
  if n < 1 or n > #last_results then
    note(string.format('  Result %d out of range (1–%d).', n, #last_results), C.err)
    return
  end
  local target = last_results[n]
  M.route_to_room(target.room_id, target.location, walk_immediately)
end

return M
