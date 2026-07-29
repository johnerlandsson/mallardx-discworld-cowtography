-- src/cowtography/prediction.lua
-- Movement prediction: watch outgoing cardinal directions to advance the
-- predicted position (target_room) before GMCP confirms arrival — matching
-- Quow's approach.
--
-- The mud.on_send observer below is an *observer*, not a consuming alias:
-- the direction flows to the wire and echoes normally (Source::Echo),
-- instead of being swallowed and re-sent — which is what made plain
-- `n`/`north` render in the client-command colour. Observing at the wire
-- level also means numpad/keymap movement now advances prediction, which a
-- manual `mud.alias` on typed input never saw. We skip our OWN sends
-- (route-walking via send_walk_steps) so a walk doesn't double-advance the
-- prediction it already tracks.

local M = {}

-- injected via M.init()
local state -- cowtography.state module
local walk  -- cowtography.walk module
local panel -- the mud.panel("map") object

local target_room         = nil   -- predicted position; nil when same as confirmed
local pred_queue           = {}    -- ordered sequence of predicted rooms [next, …, target]
local just_moved           = false -- true for one GMCP after a successful move
local prev_target_at_move  = nil   -- target_room captured when just_moved was last set

function M.init(deps)
  state = deps.state
  walk  = deps.walk
  panel = deps.panel
end

local function post_target_move(room_id)
  panel:post("target_move", { identifier = room_id })
end

-- snap=true: pan the view back to the confirmed position (used when stopping
-- mid-route). snap=false (default): room_info will pan, no need to do it here.
function M.clear(snap)
  pred_queue  = {}
  target_room = nil
  panel:post("target_clear", { snap = snap == true })
end

-- Called from room.info with the previous room, after state.current_room has
-- already been updated to the new identifier. Advances or clears the
-- prediction queue on an actual move; suppresses the duplicate room.info
-- Discworld fires after a successful move otherwise.
function M.on_transition(prev_room)
  if state.current_room ~= prev_room then
    -- Actual movement: advance the prediction queue if this room was expected,
    -- otherwise the prediction is stale (locked door, teleport, etc.) — clear it.
    if target_room ~= nil then
      if pred_queue[1] == state.current_room then
        table.remove(pred_queue, 1)
        target_room = pred_queue[#pred_queue]  -- nil when we've arrived at the destination
        -- Explicitly tell the frontend the prediction is resolved instead of
        -- relying on the confirming room_info's identifier matching what we
        -- predicted: a subsystem (e.g. shades.lua) may post a different,
        -- display-only alias for this same room, which would otherwise never
        -- match and leave the frontend's target stuck forever.
        if target_room == nil then M.clear(false) end
      else
        M.clear(false)
      end
    end
    just_moved          = true
    prev_target_at_move = target_room  -- snapshot after possible clear/advance
  else
    -- Same-room re-confirmation: duplicate room.info after a move, or a blocked move.
    -- Suppress when just_moved AND target hasn't changed since we arrived here:
    -- that pattern is the duplicate room.info Discworld fires after a successful move.
    if target_room ~= nil and not (just_moved and target_room == prev_target_at_move) then
      M.clear(false)
    end
    just_moved = false
  end
end

local DIR_NORMALIZE = {
  n='n', north='n', ne='ne', northeast='ne', e='e', east='e',
  se='se', southeast='se', s='s', south='s', sw='sw', southwest='sw',
  w='w', west='w', nw='nw', northwest='nw', u='u', up='u', d='d', down='d',
}

mud.on_send([[^(n|ne|e|se|s|sw|w|nw|u|d|north|northeast|east|southeast|south|southwest|west|northwest|up|down)$]], function(m)
  if m.origin.plugin_id == state.PLUGIN_ID then return end
  if walk.get_pos() == 0 and walk.get_steps_count() > 0 then
    walk.clear_route()
  end
  local dir  = DIR_NORMALIZE[m[1]]
  local from = target_room or state.current_room
  if from then
    local by_dir = state.exits_by_dir[from]
    if by_dir then
      local next_id = by_dir[dir]
      if next_id then
        pred_queue[#pred_queue + 1] = next_id
        target_room = next_id
        post_target_move(target_room)
      end
    end
  end
end, { name = "movement-observer" })

return M
