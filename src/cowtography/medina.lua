-- src/cowtography/medina.lua
-- BPMedina: 18 rooms share one GMCP identifier. Identified by room description
-- text triggers (GMCP room.info doesn't carry the description field). Specific
-- descriptions match 13 rooms uniquely; the generic description is disambiguated
-- by exit count + previous Medina room (mirrors Quow's logic).

local state = require('cowtography.state')

local M = {}

local panel -- injected via M.init(); provides post_room

-- Rooms in the inner cluster — coming from one of these makes 3-exit
-- generic rooms more likely to be Medina14 than Medina08.
local MEDINA_INNER = {
  Medina10=true, Medina11=true, Medina13=true,
  Medina14=true, Medina16=true, Medina17=true, Medina18=true,
}

local medina_prev       = nil
local medina_name       = nil  -- data.name from last BPMedina GMCP event
local medina_exit_count = 0    -- exit count from last BPMedina GMCP event
local medina_identified = false -- guards against double-posting per room

function M.init(panel_mod)
  panel = panel_mod
end

local function post_medina_room(room_id)
  if medina_identified then return end
  medina_identified = true
  medina_prev = room_id
  local frame = { identifier = room_id, name = medina_name }
  state.last_payload = frame
  panel.post_room(frame)
end

-- Handles data.identifier == "BPMedina". Returns true if handled (map panel
-- already updated for first entry; refined further by description triggers).
function M.handle_room(data, prev_room)
  if data.identifier ~= "BPMedina" then return false end
  -- All 18 Medina rooms share this identifier. Description-based
  -- identification happens via mud.trigger (description text is not
  -- a GMCP field). Store state for those triggers to consume.
  medina_name       = data.name
  medina_exit_count = 0
  if type(data.exits) == 'table' then
    for _ in pairs(data.exits) do medina_exit_count = medina_exit_count + 1 end
  end
  medina_identified = false
  if prev_room ~= "BPMedina" then
    -- First entry: load the Medina map immediately. Text trigger will
    -- refine position once the room description arrives.
    local anchor = { identifier = "Medina09", name = data.name }
    state.last_payload = anchor
    panel.post_room(anchor)
  end
  return true
end

-- ─── BPMedina: room description text triggers ───────────────────────────────
-- Discworld GMCP room.info doesn't carry description text, so we match the
-- room's long description as it appears in game output. Specific patterns
-- cover 13 uniquely-described rooms; the generic "You are standing" pattern
-- handles the remaining 5 (Medina05/08/13/14/15) by exit count + prev room.
-- Register specific patterns before the generic one so that when both could
-- fire on the same line (e.g. Medina16), the specific one wins first.
for _, entry in ipairs({
  { "and there are other alleys",  "Medina01" },
  { "head spins",                  "Medina02" },
  { "very narrow",                 "Medina03" },
  { "T-junction",                  "Medina04" },
  { "cross alleyways",             "Medina06" },
  { "decision is simple",          "Medina07" },
  { "Six alleys meet",             "Medina09" },
  { "Three alleyways merge",       "Medina10" },
  { "same place you were",         "Medina11" },
  { "the Aurient",                 "Medina12" },
  { "north and south",             "Medina16" },
  { "alleys twist and turn",       "Medina17" },
  { "dark and with",               "Medina18" },
}) do
  local id = entry[2]
  mud.trigger(entry[1], function()
    if state.current_room == "BPMedina" then post_medina_room(id) end
  end)
end

-- The game randomizes the sentence structure of this generic room's
-- description ("You are standing in..." vs "This is a... and there are...");
-- both variants must trigger identification or the map is left stranded on
-- the Medina09 entry anchor.
local function medina_generic_room()
  if state.current_room ~= "BPMedina" or medina_identified then return end
  local room_id
  if     medina_exit_count == 5 then room_id = "Medina05"
  elseif medina_exit_count == 4 then room_id = "Medina13"
  elseif medina_exit_count == 2 then room_id = "Medina15"
  elseif medina_exit_count == 3 then
    if medina_prev and MEDINA_INNER[medina_prev] then room_id = "Medina14"
    else room_id = "Medina08" end
  end
  if room_id then post_medina_room(room_id) end
end

mud.trigger([[You are standing in a small winding alleyway]], medina_generic_room)
mud.trigger([[and there are other alleys leading off it]], medina_generic_room)

return M
