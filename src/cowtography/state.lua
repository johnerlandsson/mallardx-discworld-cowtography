-- src/cowtography/state.lua
-- Cross-cutting mutable state shared by multiple cowtography modules.
-- Plain fields on a shared table (not locals) so mutations are visible
-- across every module that requires this one.

local M = {
  current_room = nil,
  last_payload = nil,
  room_id_echo = false,
  char_name    = nil,
  in_dark      = false,
}

M.PLUGIN_ID = "net.mallard.discworld-cowtography"

-- Loaded once at plugin startup from the seeded room_exits table (see
-- plugin.toml's [database] block and Quow's shipped schema). Kept
-- in-memory for pathfind.lua's BFS, which needs full graph residency.
-- exits[room_id] is nil for rooms with no known exits.
local exits = {}
for _, row in ipairs(db.query("SELECT room_id, connect_id, exit FROM room_exits")) do
  exits[row.room_id] = exits[row.room_id] or {}
  exits[row.room_id][row.connect_id] = row.exit
end
M.exits = exits

-- Invert exits into direction-keyed lookup: exits_by_dir[roomId][dir] = targetRoomId
M.exits_by_dir = {}
for room_id, neighbors in pairs(exits) do
  local by_dir = {}
  for neighbor_id, dir in pairs(neighbors) do
    by_dir[dir] = neighbor_id
  end
  M.exits_by_dir[room_id] = by_dir
end

-- Point lookup against Quow's rooms table. Replaces the old full
-- in-memory id->name table (data.rooms), which existed only to answer
-- "is this id a real database room?" at two call sites (uu_library.lua,
-- notes.lua) — not worth keeping ~18,769 rows resident for that.
function M.room_exists(room_id)
  return #db.query("SELECT 1 FROM rooms WHERE room_id = ? LIMIT 1", { room_id }) > 0
end

return M
