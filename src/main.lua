-- src/main.lua
-- Discworld DB Search — mallard plugin.
--
-- Commands:
--   dbsearch <type> <query>   type: room | item | npcitem | npc
--   dbroute <number>          route to result N, creates dbwalk alias in MUD
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

-- ─── GMCP ────────────────────────────────────────────────────────────────────

gmcp.on('room.info', function(_, data)
  if type(data) == 'table' and data.identifier then
    current_room = data.identifier
  end
end)

-- ─── Display ─────────────────────────────────────────────────────────────────

local TYPE_LABELS = {
  room    = 'room',
  item    = 'item (shop)',
  npcitem = 'npc item',
  npc     = 'npc',
}

local function display_results(search_type, query, results)
  local count  = #results
  local suffix = count == 30 and '  (30 results — more may exist)' or
                 string.format('  (%d result%s)', count, count == 1 and '' or 's')
  note(string.format('  DB Search: %s — "%s"%s', TYPE_LABELS[search_type], query, suffix), C.header)
  note('  ' .. RULE, C.rule)

  for i, r in ipairs(results) do
    local colour = (i % 2 == 1) and C.name or C.alt
    local line
    if search_type == 'room' then
      line = string.format('  %2d.  %s', i, r.name)
    elseif search_type == 'item' then
      local price = (r.price ~= '') and ('   ' .. r.price) or ''
      line = string.format('  %2d.  %-40s [%s]%s', i, r.name, r.location, price)
    elseif search_type == 'npc' then
      line = string.format('  %2d.  %-40s [%s]', i, r.name, r.location)
    elseif search_type == 'npcitem' then
      local price = (r.price ~= '') and ('   ' .. r.price) or ''
      line = string.format('  %2d.  %-30s  via %-25s  [%s]%s', i, r.name, r.npc or '', r.location, price)
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
  local results

  if search_type == 'room' then
    results = search.search_rooms(rooms, query)
  elseif search_type == 'item' then
    results = search.search_items(items, query)
  elseif search_type == 'npc' then
    results = search.search_npcs(npcs, query)
  elseif search_type == 'npcitem' then
    results = search.search_npc_items(npc_items, query)
  else
    note('  Unknown type "' .. search_type .. '". Valid types: room, item, npcitem, npc', C.err)
    return
  end

  last_results = results

  if #results == 0 then
    note(string.format('  No results for "%s" (type: %s).', query, search_type), C.muted)
    return
  end

  display_results(search_type, query, results)
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

  mud.send('alias dbwalk ' .. path)
  note(string.format('  Route to "%s" — %d move%s.', target.location, steps, steps == 1 and '' or 's'), C.ok)
  note("  Alias 'dbwalk' created. Type 'dbwalk' to begin.", C.muted)

  if steps > 140 then
    note('  Warning: long route. Discworld clears movement queues after 5 minutes of idle time.', C.header)
  end
end)
