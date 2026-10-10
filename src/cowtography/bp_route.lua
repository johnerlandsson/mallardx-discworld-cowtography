-- Pure route planner using Cowtography's known, directed map exits.
local M = {}
function M.calculate(exits, start, candidates)
  local remaining, count = {}, 0
  for _, room in ipairs(candidates) do
    if type(room) == 'table' and type(room.id) == 'string' and room.id ~= start and not remaining[room.id] then
      remaining[room.id] = room
      count = count + 1
    end
  end
  local rooms, directions, stops = {start}, {}, 0
  local current = start
  while count > 0 do
    local queue, head = {current}, 1
    local previous, seen = {}, {[current] = true}
    local target
    while head <= #queue and not target do
      local id = queue[head]; head = head + 1
      if remaining[id] then target = id; break end
      for neighbor, direction in pairs(exits[id] or {}) do
        if not seen[neighbor] then
          seen[neighbor] = true
          previous[neighbor] = {id = id, direction = direction}
          queue[#queue + 1] = neighbor
        end
      end
    end
    if not target then break end
    local reversed, id = {}, target
    while id ~= current do
      local edge = previous[id]
      reversed[#reversed + 1] = {id = id, direction = edge.direction}
      id = edge.id
    end
    for i = #reversed, 1, -1 do
      rooms[#rooms + 1] = reversed[i].id
      directions[#directions + 1] = reversed[i].direction
      -- Passing through a candidate also visits it.
      if remaining[reversed[i].id] then
        remaining[reversed[i].id] = nil
        count = count - 1
        stops = stops + 1
      end
    end
    current = target
  end
  return rooms, directions, stops, count
end
return M
