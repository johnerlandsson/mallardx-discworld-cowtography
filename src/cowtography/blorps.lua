-- src/cowtography/blorps.lua
-- Optional integration with the Discworld Blorpsack plugin
-- (broaty.discworld-blorpsack): mirrors its broadcast blorp list in memory
-- and answers "which registered blorp gets you closest to room X" queries.
-- Cowtography has no hard dependency on Blorpsack — with it not installed,
-- or the blorp_routing setting off, every query below returns nil.

local pathfind = require('pathfind')

local M = {}

local EVENT_BLORPS  = "broaty.discworld-blorpsack.blorps"
local EVENT_REQUEST = "broaty.discworld-blorpsack.blorps.request"

-- Last-received { { room_id = ..., name = ... }, ... }, or {} if Blorpsack
-- isn't installed / hasn't answered the request yet.
local blorp_list = {}

function M.init(_deps)
  events.on(EVENT_BLORPS, function(data)
    blorp_list = (type(data) == 'table' and data.blorps) or {}
  end)
  -- One-shot delay, not an immediate emit: gives Blorpsack a chance to
  -- finish loading and register its own EVENT_REQUEST listener, regardless
  -- of which plugin's main.lua ran first. Matches Blorpsack's documented
  -- cross-plugin contract (see its README's "For plugin authors" section).
  mud.delay(500, function()
    events.emit(EVENT_REQUEST, {})
  end)
end

-- closest_reaching(exits, target_room_id)
-- Returns { name = ..., distance = N } for the registered blorp with the
-- shortest walking distance to target_room_id, or nil if the blorp_routing
-- setting is off, no blorps are registered, or none can reach the target.
function M.closest_reaching(exits, target_room_id)
  if not settings.get('blorp_routing') then return nil end
  if #blorp_list == 0 then return nil end

  local best
  for _, b in ipairs(blorp_list) do
    local dist = pathfind.distances_from(exits, b.room_id)[target_room_id]
    if dist ~= nil and (best == nil or dist < best.distance) then
      best = { name = b.name, distance = dist }
    end
  end
  return best
end

return M
