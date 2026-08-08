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

-- Memoized "distance and name of the nearest blorp" for every room, from a
-- single multi-source BFS seeded at every registered blorp's room at once
-- (see pathfind.multi_source_distances) — not one BFS per blorp. Caching
-- one BFS per blorp room was tried first and OOM'd the plugin's 32MB-capped
-- Lua VM for players with many blorps registered (each cached distance
-- table spans the whole ~19k-room map; 87 blorps measured ~21MB resident).
-- A single multi-source BFS costs the same as one ordinary BFS regardless
-- of blorp count (~0.8MB on the real map), because it explores each room
-- once, keeping whichever source reached it first.
-- Load-bearing assumption: state.exits is built once at startup and never
-- mutated afterward (see state.lua), so this cache stays valid for the
-- whole session. Only the blorp *list* changes (new/removed/moved blorps),
-- which is what invalidates it — see the EVENT_BLORPS handler below.
local cache_dist, cache_origin, cache_names

local function invalidate_cache()
  cache_dist, cache_origin, cache_names = nil, nil, nil
end

-- Builds the cache on first use after invalidation. Ties among blorps at
-- the same distance are broken by BFS/blorp-list order, not "closest" in
-- any other sense — any nearest blorp is a correct answer.
local function ensure_cache(exits)
  if cache_dist ~= nil then return end
  local source_ids = {}
  cache_names = {}
  for _, b in ipairs(blorp_list) do
    if type(b) == 'table' and b.room_id ~= nil then
      if cache_names[b.room_id] == nil then
        source_ids[#source_ids + 1] = b.room_id
      end
      cache_names[b.room_id] = b.name
    end
  end
  cache_dist, cache_origin = pathfind.multi_source_distances(exits, source_ids)
end

function M.init(_deps)
  events.on(EVENT_BLORPS, function(data)
    blorp_list = (type(data) == 'table' and data.blorps) or {}
    invalidate_cache()
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

  ensure_cache(exits)
  local dist = cache_dist[target_room_id]
  if dist == nil then return nil end
  local origin_room = cache_origin[target_room_id]
  return { name = cache_names[origin_room], distance = dist }
end

return M
