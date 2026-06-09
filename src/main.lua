-- src/main.lua
-- Discworld DB Search — mallard plugin.
--
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

local RULE = string.rep('─', 54)

local function note(text, colour)
  mud.note(text, { fg = colour or C.name })
end

-- ─── Walk state ──────────────────────────────────────────────────────────────

local walk_steps       = {}
local walk_pos         = 0
local walk_target_name = ''

-- ─── GMCP ────────────────────────────────────────────────────────────────────

gmcp.on('room.info', function(_, data)
  if type(data) == 'table' and data.identifier then
    current_room = data.identifier

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
  local count  = #results
  local sort_note = sorted_by_dist and ', nearest first' or ''
  note(string.format('  DB Search: %s — "%s"  (%d result%s%s)',
    TYPE_LABELS[search_type], query, count, count == 1 and '' or 's', sort_note), C.header)
  note('  ' .. RULE, C.rule)

  for i, r in ipairs(results) do
    local colour = (i % 2 == 1) and C.name or C.alt
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
    note(line, colour)
  end

  note('  ' .. RULE, C.rule)
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

  local path, steps = pathfind.find_path(exits, current_room, target.room_id)
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
