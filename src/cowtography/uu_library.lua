-- src/cowtography/uu_library.lua
-- UU Library: directions are relative (forward/backward/left/right).
-- Facing (n/s/e/w) is maintained by turn commands; strafing doesn't change it.
-- Distortions, orbs and l-space are overlaid on the map panel.

local rooms  = require('data.rooms')
local colors = require('cowtography.colors')

local M = {}

local panel -- injected via M.init(); the mud.panel("map") object

local lib_in_library      = false
local lib_in_lspace       = false    -- true when lost in L-space (distinct from library)
local lib_facing          = 'n'
local lib_x               = 166      -- current position on map 47 (tile units)
local lib_y               = 4810
local lib_move_queue      = {}       -- pending cardinal moves; aliases push, GMCP pops
local lib_checkpoint      = nil      -- {x,y,facing} saved just before each GMCP-applied move
local lib_distortion_here = nil      -- 'n'|'e'|'s'|'w' or nil
local lib_orb_here        = false
local last_lib_overlay    = nil
local last_lib_position   = nil

local TURN_LEFT  = { n='w', w='s', s='e', e='n' }
local TURN_RIGHT = { n='e', e='s', s='w', w='n' }
local OPPOSITE   = { n='s', s='n', e='w', w='e' }

function M.init(panel_obj)
  panel = panel_obj
end

function M.is_in_library() return lib_in_library end
function M.is_in_lspace()  return lib_in_lspace  end
function M.get_last_position() return last_lib_position end
function M.get_last_overlay()  return last_lib_overlay  end

-- Shift position by one tile in cardinal direction; apply x-wrap (Quow §8890).
local function lib_apply_move(card)
  local nx = lib_x + ((card=='e' and 30) or (card=='w' and -30) or 0)
  local ny = lib_y + ((card=='n' and -30) or (card=='s' and  30) or 0)
  if     nx >= 262 then nx = nx - 240
  elseif nx <= 37  then nx = nx + 240
  end
  lib_x = nx
  lib_y = ny
end

local function relative_to_cardinal(rel)
  if     rel == 'up ahead of'    then return lib_facing
  elseif rel == 'to the right of' then return TURN_RIGHT[lib_facing]
  elseif rel == 'behind'          then return OPPOSITE[lib_facing]
  elseif rel == 'to the left of'  then return TURN_LEFT[lib_facing]
  end
  return lib_facing
end

local function post_library_overlay()
  local payload = {
    facing     = lib_facing,
    distortion = lib_distortion_here,
    orb        = lib_orb_here,
  }
  last_lib_overlay = payload
  panel:post("library_overlay", payload)
end

local function post_library_position()
  local payload = { x = lib_x, y = lib_y }
  last_lib_position = payload
  panel:post("library_position", payload)
end

function M.clear_overlays()
  lib_distortion_here = nil
  lib_orb_here        = false
  post_library_overlay()
end

-- Called once per room.info transition. Resets per-room overlays, then
-- classifies/handles library and L-space rooms. Returns true if this
-- subsystem owns the room (map panel already updated), false otherwise —
-- the caller should fall through to its own room-identifier dispatch.
function M.handle_room(data)
  lib_orb_here        = false
  lib_distortion_here = nil
  local name_lower = (data.name or ''):lower()
  -- UU Library rooms have GMCP name "library" AND are absent from the rooms
  -- DB (no identifier entries). Other "library"-named rooms (Academy of
  -- Artificers, Genua, etc.) ARE in the DB, so the identifier lookup
  -- distinguishes them. L-space rooms ("mysterious library") fail the exact
  -- name match, so they fall through to the mysterious-name check below.
  local entering_library = name_lower == 'library'
                       and rooms[data.identifier] == nil

  if entering_library then
    if not lib_in_library then
      -- Fresh entry from outside: reset position, facing, and any stale queue.
      lib_facing     = 'n'
      lib_x          = 166
      lib_y          = 4810
      lib_move_queue = {}
    elseif #lib_move_queue > 0 then
      -- Moving within library: save a checkpoint for rollback (in case the
      -- "no exit" trigger fires after GMCP), then apply the queued move.
      lib_checkpoint = { x = lib_x, y = lib_y, facing = lib_facing }
      local move = table.remove(lib_move_queue, 1)
      lib_apply_move(move)
      lib_facing = move  -- facing updates to the direction physically moved
    end
    lib_in_library = true
    lib_in_lspace  = false
    post_library_overlay()
    post_library_position()
    return true
  end

  lib_in_library = false
  lib_move_queue = {}
  lib_checkpoint = nil
  if name_lower == 'mysterious library'
  or name_lower:find('maze of twisting') ~= nil then
    -- L-space rooms: "mysterious library", "maze of twisting shelves, all alike", etc.
    -- Post lspace directly to avoid resolveRoom finding map-56 DB entries.
    lib_in_lspace = true
    panel:post("lspace", {})
    return true
  end
  lib_in_lspace = false
  return false
end

-- Turn commands: rotate facing, pass command through to MUD.
mud.alias([[^turn (?:left|lt)$]], function(m)
  lib_facing = TURN_LEFT[lib_facing]
  mud.send(m.text, { silent = true })
  post_library_overlay()
end)

mud.alias([[^turn (?:right|rt)$]], function(m)
  lib_facing = TURN_RIGHT[lib_facing]
  mud.send(m.text, { silent = true })
  post_library_overlay()
end)

mud.alias([[^turn around$]], function(m)
  lib_facing = OPPOSITE[lib_facing]
  mud.send(m.text, { silent = true })
  post_library_overlay()
end)

-- Strafe/walk commands: record intended move direction; GMCP confirms arrival.
mud.alias([[^(?:forward|fw)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, lib_facing) end
  mud.send(m.text, { silent = true })
end)

mud.alias([[^(?:backward|bw)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, OPPOSITE[lib_facing]) end
  mud.send(m.text, { silent = true })
end)

mud.alias([[^(?:left|lt)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, TURN_LEFT[lib_facing]) end
  mud.send(m.text, { silent = true })
end)

mud.alias([[^(?:right|rt)$]], function(m)
  if lib_in_library then table.insert(lib_move_queue, TURN_RIGHT[lib_facing]) end
  mud.send(m.text, { silent = true })
end)

-- Blocked-move handler. The UU Library returns one of three messages when
-- a direction is invalid. Since these mean the command wasn't processed,
-- GMCP never fires — we just discard the stale queue entry and clear any
-- checkpoint left over from the previous successful move.
mud.trigger([[^(?:> )?(?:What\?|That doesn't work\.|Try something else\.)\s*$]], function()
  if lib_in_library then
    lib_checkpoint = nil
    if #lib_move_queue > 0 then
      table.remove(lib_move_queue, 1)
    end
  end
  -- Do NOT clear target here: the direction alias didn't advance target_room when
  -- no exit was found, so target is still valid for any commands already queued.
  -- The GMCP handler clears target naturally when current_room catches up.
end)

-- Distortion visible with known direction (fires when you look at the room).
mud.trigger([[^(?:> )?There is a strange distortion in space and time (.+) you!$]], function(m)
  lib_distortion_here = relative_to_cardinal(m[1])
  post_library_overlay()
end)

-- Distortion forming warning (direction unknown until you look).
mud.trigger([[^(?:> )?(?:You notice an odd rippling in the air\.|The awful sound of nails being dragged down a blackboard fills the area briefly\.|A distortion in time and space is forming!)$]], function()
  colors.note('  A distortion is forming nearby! Type look to see where.', colors.C.err)
end)

-- Distortion vanished or successfully sealed.
mud.trigger([[^(?:> )?The (?:distortion fades away|area seems more mundane than before|room seems to return to normal)\.$]], function()
  lib_distortion_here = nil
  post_library_overlay()
end)

-- Escaped spell orb visible in room — capture size word for the panel.
mud.trigger([[(?:a|A) (tiny speck|small point|moderately-sized ball|large orb|substantial sphere) of energy is tracing a .+? pattern in the air]], function(m)
  lib_orb_here = m[1]
  post_library_overlay()
end)

-- Escaped spell orb captured or destroyed (various messages).
mud.trigger([[^(?:> )?The (?:tiny speck|small point|moderately-sized ball|large orb|substantial sphere) of energy (?:collapses in on itself, then winks out|is absorbed into your|vanishes)]], function()
  lib_orb_here = false
  post_library_overlay()
end)

mud.trigger([[(?:tiny speck|small point|moderately-sized ball|large orb|substantial sphere) of energy vanishes with a "Pop!"]], function()
  lib_orb_here = false
  post_library_overlay()
end)

-- L-space is detected from the room description rather than GMCP name,
-- since L-space rooms may share the "Library" name with regular rooms.
-- This fires after any GMCP-based library_position is already posted, so
-- the lspace message overrides it in the JS panel.
mud.trigger([[^(?:> )?You are somewhere in the depths of L-space\.]], function()
  lib_in_library = false
  lib_in_lspace  = true
  panel:post("lspace", {})
end)

return M
