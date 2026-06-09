local M = {}
local MAX_RESULTS = 200

function M.search_rooms(rooms, query)
  local q = string.lower(query)
  local results = {}
  for room_id, room_short in pairs(rooms) do
    if string.find(string.lower(room_short), q, 1, true) then
      table.insert(results, { room_id = room_id, name = room_short, location = room_short })
      if #results >= MAX_RESULTS then break end
    end
  end
  return results
end

function M.search_items(items, query)
  local q = string.lower(query)
  local results = {}
  for _, item in ipairs(items) do
    if string.find(string.lower(item.name), q, 1, true) then
      table.insert(results, {
        room_id  = item.room_id,
        name     = item.name,
        location = item.location,
        price    = item.price,
      })
      if #results >= MAX_RESULTS then break end
    end
  end
  return results
end

function M.search_npcs(npcs, query)
  local q = string.lower(query)
  local results = {}
  for _, npc in ipairs(npcs) do
    if string.find(string.lower(npc.name), q, 1, true) then
      table.insert(results, {
        room_id  = npc.room_id,
        name     = npc.name,
        location = npc.location,
      })
      if #results >= MAX_RESULTS then break end
    end
  end
  return results
end

function M.search_npc_items(npc_items, query)
  local q = string.lower(query)
  local results = {}
  for _, item in ipairs(npc_items) do
    if string.find(string.lower(item.name), q, 1, true) then
      table.insert(results, {
        room_id  = item.room_id,
        name     = item.name,
        npc      = item.npc,
        location = item.location,
        price    = item.price,
      })
      if #results >= MAX_RESULTS then break end
    end
  end
  return results
end

return M
