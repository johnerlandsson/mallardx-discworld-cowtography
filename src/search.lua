-- src/search.lua
-- Live SQL search against Quow's seeded database (see plugin.toml's
-- [database] block). SQLite's LIKE is ASCII-case-insensitive by default,
-- matching this module's old substring-scan behaviour. % and _ in the
-- query are escaped so they stay literal characters rather than becoming
-- LIKE wildcards, also matching the old behaviour
-- (string.find(..., true) treated the query as a plain literal).
local M = {}

local function like_pattern(query)
  return (query:gsub('([%%_])', '\\%1'))
end

function M.search_rooms(query)
  return db.query([[
    SELECT room_id, room_short AS name, room_short AS location, map_id
    FROM rooms
    WHERE room_short LIKE '%' || ? || '%' ESCAPE '\'
    LIMIT 200
  ]], { like_pattern(query) })
end

function M.search_items(query)
  return db.query([[
    SELECT si.item_name AS name, si.room_id, si.sale_price AS price,
           r.room_short AS location, r.map_id
    FROM shop_items si
    JOIN rooms r ON r.room_id = si.room_id
    WHERE si.item_name LIKE '%' || ? || '%' ESCAPE '\'
    LIMIT 200
  ]], { like_pattern(query) })
end

function M.search_npcs(query)
  return db.query([[
    SELECT ni.npc_name AS name, ni.room_id, r.room_short AS location, r.map_id
    FROM npc_info ni
    JOIN rooms r ON r.room_id = ni.room_id
    WHERE ni.npc_name LIKE '%' || ? || '%' ESCAPE '\'
    LIMIT 200
  ]], { like_pattern(query) })
end

function M.search_npc_items(query)
  return db.query([[
    SELECT nit.item_name AS name, ni.npc_name AS npc, ni.room_id,
           r.room_short AS location, nit.sale_price AS price, r.map_id
    FROM npc_items nit
    JOIN npc_info ni ON ni.npc_id = nit.npc_id
    JOIN rooms r ON r.room_id = ni.room_id
    WHERE nit.item_name LIKE '%' || ? || '%' ESCAPE '\'
    LIMIT 200
  ]], { like_pattern(query) })
end

return M
