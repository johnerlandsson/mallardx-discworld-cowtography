-- src/cowtography/state.lua
-- Cross-cutting mutable state shared by multiple cowtography modules.
-- Plain fields on a shared table (not locals) so mutations are visible
-- across every module that requires this one.
--
-- This is also the single owner of data.rooms/data.exits: Mallard's plugin
-- require() has no caching (every call re-reads and re-executes the target
-- file from scratch - see plugins/sandbox.rs), so requiring the same large
-- data file from more than one place multiplies its parse cost per call
-- site. Every other module gets these via state.rooms/state.exits instead
-- of requiring the data files themselves.

local exits = require('data.exits')
local rooms = require('data.rooms')

local M = {
  current_room = nil,
  last_payload = nil,
  room_id_echo = false,
  char_name    = nil,
}

M.PLUGIN_ID = "net.mallard.discworld-cowtography"
M.exits     = exits
M.rooms     = rooms

-- Invert exits into direction-keyed lookup: exits_by_dir[roomId][dir] = targetRoomId
M.exits_by_dir = {}
for room_id, neighbors in pairs(exits) do
  local by_dir = {}
  for neighbor_id, dir in pairs(neighbors) do
    by_dir[dir] = neighbor_id
  end
  M.exits_by_dir[room_id] = by_dir
end

return M
