-- src/cowtography/shades.lua
-- AMShades: 16 interior rooms share the GMCP identifier "AMShades".
-- The entrance room has a real unique ID. Once we know which of the 17 rooms
-- we're in, every move is resolved deterministically from SHADES_DIR (the
-- exit typed, e.g. "3", maps straight to the destination room number) — see
-- the shades-movement on_send observer below. This mirrors Quow's sQSDir.
--
-- Description text triggers only matter for the (rare) case where we don't
-- yet know shades_room — fresh entry, or a move sent by something other than
-- the tracked on_send observer. 6 rooms have unique descriptions there;
-- the remaining 10 split into two ambiguous groups (ShadesGuess1: rooms
-- 1,10,11,13,14 / ShadesGuess2: rooms 3,4,6,7,15) disambiguated by checking
-- how many of the group are reachable from the previously confirmed room —
-- if exactly one, that must be the destination. This reachability check is
-- frequently ambiguous by itself (most rooms have 2+ same-group exits), which
-- is exactly why it's a fallback and not the primary resolution mechanism.
--
-- Room numbering 1-17 matches Quow's; 17 = entrance (has a real GMCP ID).
-- Navigation graph mirrors Quow's sQSDir: SHADES_DIR[from][exit] = to.

local state = require('cowtography.state')

local M = {}

local panel -- injected via M.init(); provides post_room

local ENTRY_ID = "01bbd8b887e71314d8e358cbaf4f585391206bc4"
M.ENTRY_ID = ENTRY_ID

local SHADES_GUESS1 = { [1]=true, [10]=true, [11]=true, [13]=true, [14]=true }
local SHADES_GUESS2 = { [3]=true, [4]=true,  [6]=true,  [7]=true,  [15]=true }

local SHADES_DIR = {
  [1]  = {["5"]=2,  ["3"]=11, ["2"]=16, ["4"]=10, ["1"]=17},
  [2]  = {["4"]=3,  ["1"]=12, ["3"]=11, ["2"]=1},
  [3]  = {["1"]=4,  ["3"]=12, ["4"]=11, ["2"]=2},
  [4]  = {["1"]=5,  ["4"]=13, ["2"]=12, ["3"]=3},
  [5]  = {["6"]=4,  ["5"]=6,  ["1"]=14, ["2"]=13, ["3"]=12, ["7"]=3, ["4"]=7},
  [6]  = {["3"]=5,  ["1"]=7,  ["2"]=14, ["4"]=13},
  [7]  = {["3"]=14, ["4"]=6,  ["1"]=8,  ["2"]=15},
  [8]  = {["2"]=15, ["1"]=14, ["4"]=7,  ["3"]=9},
  [9]  = {["4"]=10, ["2"]=16, ["3"]=15, ["5"]=8,  ["1"]=17},
  [10] = {["4"]=1,  ["2"]=11, ["6"]=16, ["3"]=15, ["5"]=9,  ["1"]=17},
  [11] = {["6"]=2,  ["7"]=3,  ["3"]=12, ["5"]=13, ["4"]=16, ["1"]=10, ["2"]=1},
  [12] = {["7"]=3,  ["6"]=4,  ["2"]=5,  ["3"]=13, ["1"]=16, ["4"]=11, ["5"]=2},
  [13] = {["3"]=12, ["8"]=4,  ["1"]=5,  ["7"]=6,  ["6"]=14, ["5"]=15, ["4"]=16, ["2"]=11},
  [14] = {["1"]=13, ["2"]=5,  ["6"]=6,  ["7"]=7,  ["5"]=8,  ["3"]=15, ["4"]=16},
  [15] = {["2"]=16, ["3"]=13, ["5"]=14, ["7"]=7,  ["6"]=8,  ["1"]=9,  ["4"]=10},
  [16] = {["3"]=11, ["4"]=12, ["7"]=13, ["8"]=14, ["5"]=15, ["6"]=9,  ["2"]=10, ["1"]=1},
  [17] = {["1"]=1,  ["3"]=10, ["2"]=9},
}

local shades_room       = nil   -- current room number (1-16), 17 (entrance), or nil
local shades_name       = nil   -- GMCP room name from last AMShades event
local shades_identified = false -- guard against double-posting per room
local shades_predicted  = false -- true when SHADES_DIR already resolved the room on send,
                                 -- so the AMShades GMCP handler shouldn't re-arm the guess triggers

function M.init(panel_mod)
  panel = panel_mod
end

local function shades_room_id(n)
  if n == 17 then return "ShadesEntrance" end
  if n < 10  then return "Shades0" .. n end
  return "Shades" .. n
end

-- Try to resolve an ambiguous guess group given the current confirmed room.
-- Returns the room number if exactly one member of the group is reachable, else nil.
local function shades_disambiguate(guess_group)
  if not shades_room then return nil end
  local exits = SHADES_DIR[shades_room]
  if not exits then return nil end
  local candidate = nil
  for _, dest in pairs(exits) do
    if guess_group[dest] then
      if candidate then return nil end
      candidate = dest
    end
  end
  return candidate
end

local function post_shades_room(n)
  if shades_identified then return end
  shades_identified = true
  shades_room = n
  local id = shades_room_id(n)
  local frame = { identifier = id, name = shades_name }
  state.last_payload = frame
  panel.post_room(frame)
end

-- Called from room.info before identifier dispatch: reset tracked position
-- when leaving the Shades entirely (not just moving between interior rooms).
function M.check_leaving(prev_room, current_room)
  if prev_room == "AMShades" and current_room ~= "AMShades" and current_room ~= ENTRY_ID then
    shades_room      = nil
    shades_predicted = false
  end
end

-- Handles data.identifier == "AMShades" or == ENTRY_ID. Returns true if
-- handled (map panel already updated), false otherwise.
function M.handle_room(data, prev_room)
  if data.identifier == "AMShades" then
    -- Interior Shades rooms (1-16) all share this GMCP identifier.
    shades_name = data.name
    if shades_predicted then
      -- SHADES_DIR already resolved this move when the direction was sent
      -- (see the shades-movement on_send observer) — don't re-arm the
      -- guess triggers below and clobber a correct prediction.
      shades_predicted = false
    else
      -- No prediction for this move (fresh entry, or an untracked send
      -- like an alias) — fall back to description-trigger identification.
      shades_identified = false
      if prev_room ~= "AMShades" then
        -- Entering from outside: anchor map to entrance, treat prev as room 17.
        shades_room = 17
        local anchor = { identifier = "ShadesEntrance", name = data.name }
        state.last_payload = anchor
        panel.post_room(anchor)
      end
    end
    -- Don't set _in_dark — description trigger (or the prediction above) posts the real position.
    return true
  elseif data.identifier == ENTRY_ID then
    -- Player is physically at the Shades entrance room — this GMCP
    -- identifier is unambiguous, so pin shades_room = 17 directly
    -- (this is the only place that happens for the entrance; the
    -- shades-movement observer needs it set to resolve exits "1"/"2"/"3"
    -- into the interior). GMCP confirming the entrance is authoritative,
    -- so any pending direction-based prediction is now moot.
    shades_room       = 17
    shades_identified = true
    shades_predicted  = false
    -- Use the clean fake ID so the mapper can find the ShadesEntrance
    -- entry in room-custom.js.
    local frame = { identifier = "ShadesEntrance", name = data.name }
    state.last_payload = frame
    panel.post_room(frame)
    return true
  end
  return false
end

function M.debug_state()
  return shades_room, shades_predicted, shades_identified
end

-- ─── AMShades: room description text triggers ────────────────────────────────
-- 6 rooms have unique descriptions; patterns chosen to be unambiguous even
-- when "alley" and "alleyway" appear in similar sentences.
for _, entry in ipairs({
  { "alley in this rabbit",   2  },  -- Shades02: "alley" (not "alleyway") + "rabbit warren"
  { "smoky, hazy",            5  },  -- Shades05: "smoky, hazy alleys"
  { "alleyway in this rabbit", 8 },  -- Shades08: "alleyway" + "rabbit warren"
  { "leads to other dark dank", 9 }, -- Shades09: unique phrasing
  { "Howls of fear and pain", 12 },  -- Shades12: unique
  { "Lady is evidently",      16 },  -- Shades16: unique
}) do
  local n = entry[2]
  mud.trigger(entry[1], function()
    if state.current_room == "AMShades" then post_shades_room(n) end
  end)
end

-- ShadesGuess1 (rooms 1,10,11,13,14): try to resolve via prev room.
mud.trigger([[no hope of ever escaping]], function()
  if state.current_room ~= "AMShades" or shades_identified then return end
  local n = shades_disambiguate(SHADES_GUESS1)
  if n then post_shades_room(n) end
end)

-- ShadesGuess2 (rooms 3,4,6,7,15): try to resolve via prev room.
mud.trigger([[Dim fires flicker]], function()
  if state.current_room ~= "AMShades" or shades_identified then return end
  local n = shades_disambiguate(SHADES_GUESS2)
  if n then post_shades_room(n) end
end)

-- AMShades numbered exits ("1".."8") aren't cardinal directions, so the
-- movement-prediction observer never sees them. The maze's numbered layout
-- is fully known (SHADES_DIR mirrors Quow's sQSDir), so once shades_room is
-- pinned down we can resolve every subsequent move deterministically from
-- the exit typed — no need to wait for (and guess from) the room
-- description. This mirrors Quow's approach: description-trigger guessing
-- is only a fallback for when shades_room isn't known yet (see M.handle_room).
mud.on_send([[^([1-8])$]], function(m)
  if m.origin.plugin_id == state.PLUGIN_ID then return end
  if not shades_room then return end
  if state.current_room ~= "AMShades" and state.current_room ~= ENTRY_ID then return end
  -- Mallard coerces purely-numeric captures to a Lua number (mirrors
  -- tonumber()), but SHADES_DIR's inner tables use string keys ("1", "2", …)
  -- to match Quow's sQSDir — tostring() back before indexing.
  local exits = SHADES_DIR[shades_room]
  local dest  = exits and exits[tostring(m[1])]
  if not dest then return end
  shades_identified = false  -- re-arm: this is a fresh move, not a re-confirmation
  shades_predicted  = true
  post_shades_room(dest)
end, { name = "shades-movement-observer" })

return M
