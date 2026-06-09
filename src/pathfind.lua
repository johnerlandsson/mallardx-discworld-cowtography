-- BFS pathfinding adapted from Quow's Cow Bar and Minimap plugin.
-- Credit: Quow — https://quow.co.uk/minimap.php

local M = {}

-- find_path(exits, start_id, target_id)
-- exits: { [room_id] = { [neighbor_id] = direction, ... }, ... }
-- Returns path string (e.g. "n;e;s") and step count, or nil if unreachable.
function M.find_path(exits, start_id, target_id)
  if start_id == nil or target_id == nil then return nil end
  if start_id == target_id then return nil end
  if exits[start_id] == nil then return nil end
  if exits[target_id] == nil then return nil end

  local queue     = { start_id }
  local id_to_idx = { [start_id] = 1 }
  local visited   = { [start_id] = true }
  local came_from = {}

  local next_i    = 1
  local total     = 1
  local depth     = 0
  local final_idx = 0
  local done      = false

  while not done do
    local prev_total = total
    for i = next_i, prev_total do
      if exits[queue[i]] then
        for neighbor, dir in pairs(exits[queue[i]]) do
          if not visited[neighbor] and final_idx == 0 then
            total = total + 1
            queue[total] = neighbor
            visited[neighbor] = true
            id_to_idx[neighbor] = total
            came_from[total] = { id_to_idx[queue[i]], dir }
            if queue[i] == target_id then
              done = true
              final_idx = i
            elseif neighbor == target_id then
              done = true
              final_idx = total
            end
          end
        end
      end
    end
    next_i = prev_total + 1
    if next_i > total then done = true end
    depth = depth + 1
    if depth > 500 then done = true; final_idx = 0 end
  end

  if final_idx == 0 then return nil end

  local path = {}
  local cur = final_idx
  while came_from[cur] do
    table.insert(path, 1, came_from[cur][2])
    cur = came_from[cur][1]
  end

  if #path == 0 then return nil end
  return table.concat(path, ';'), #path
end

-- distances_from(exits, start_id)
-- Returns { [room_id] = steps } for all rooms reachable from start_id.
function M.distances_from(exits, start_id)
  if start_id == nil or exits[start_id] == nil then return {} end
  local dist  = { [start_id] = 0 }
  local queue = { start_id }
  local head  = 1
  while head <= #queue do
    local room = queue[head]
    head = head + 1
    if exits[room] then
      for neighbor in pairs(exits[room]) do
        if dist[neighbor] == nil then
          dist[neighbor] = dist[room] + 1
          queue[#queue + 1] = neighbor
        end
      end
    end
  end
  return dist
end

return M
