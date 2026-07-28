-- src/cowtography/gmcp.lua
-- World lifecycle, settings, character name, and GMCP event handlers.
-- Orchestrates shades/medina/uu_library/prediction/walk in the same order
-- as the original monolithic room.info handler's if/elseif chain.

local ansi_map = require('ansi_map')

local colors     = require('cowtography.colors')
local state      = require('cowtography.state')
local uu_library = require('cowtography.uu_library')
local panel_mod  = require('cowtography.panel')
local shades     = require('cowtography.shades')
local medina     = require('cowtography.medina')
local walk       = require('cowtography.walk')
local prediction = require('cowtography.prediction')

local C, note = colors.C, colors.note
local panel = panel_mod.panel
local post_room = panel_mod.post_room

local M = {}

local _in_dark = false

-- Room identifiers that show a named special screen instead of the map.
local SPECIAL_SCREENS = {
  RatFarm       = 'rat_farm',
  AbandonedMine = 'mines',
  Labyrinth     = 'labyrinth',
  SandelfonMaze = 'labyrinth',
}

-- ─── World lifecycle ─────────────────────────────────────────────────────────

local function seed_room()
  local raw = gmcp.get("room.info")
  if raw then
    local id = raw:match('"identifier"%s*:%s*"([^"]+)"')
    if id then state.current_room = id end
  end
end

function M.reset_walk()
  walk.reset_for_disconnect()
  prediction.clear(true)  -- snap view back; no room_info is coming
end

seed_room()
world.on("connect",    seed_room)
world.on("disconnect", M.reset_walk)

-- ─── Settings ────────────────────────────────────────────────────────────────
-- Registering this handler opts into live settings updates: the plugin VM
-- stays alive across setting changes instead of being restarted.
-- walk_sound is read inline at point-of-use so no caching to update here.

settings.on("change", function(key, new_val, _old)
  if key == 'map_style' then
    panel:post("map_style", { style = new_val })
  end
end)

-- ─── Character name ──────────────────────────────────────────────────────────
-- char.info.capname is the authoritative per-character name from GMCP.
-- Mirrors the pattern from discworld-grouping: subscribe for live updates +
-- hydrate at startup so plugin reloads mid-session get the cached value.

local function apply_char_name(name)
  if type(name) == 'string' and name ~= '' then state.char_name = name end
end

apply_char_name(gmcp.get('char.info.capname'))

-- ─── GMCP ────────────────────────────────────────────────────────────────────

gmcp.on('char.info', function(_, data)
  if type(data) == 'table' then apply_char_name(data.capname) end
end)

gmcp.on('room.map', function(_, payload)
  if type(payload) ~= 'string' then return end
  panel_mod.post_ascii_rows(ansi_map.parse(payload))
end)

gmcp.on('room.info', function(_, data)
  if type(data) == 'table' and data.identifier then
    if _in_dark then
      _in_dark = false
      prediction.clear(false)
    end
    local prev_room = state.current_room
    state.current_room = data.identifier
    shades.check_leaving(prev_room, state.current_room)
    prediction.on_transition(prev_room)
    if state.room_id_echo then note('  ' .. state.current_room, C.name) end

    -- UU Library: clear per-room overlays on each room transition; identify
    -- library/L-space rooms. Returns false for rooms outside the subsystem.
    if not uu_library.handle_room(data) then
      local special = SPECIAL_SCREENS[data.identifier]
      if special then
          panel:post("special_screen", { name = special })
        elseif shades.handle_room(data, prev_room) then
          -- Don't set _in_dark — description trigger (or the prediction above) posts the real position.
        elseif medina.handle_room(data, prev_room) then
          -- handled
        else
          state.last_payload = data
          post_room(data)
        end
      end
    if state.room_id_echo then
      local shades_room, shades_predicted, shades_identified = shades.debug_state()
      if shades_room then
        note(string.format('  shades_room=%s predicted=%s identified=%s',
          tostring(shades_room), tostring(shades_predicted), tostring(shades_identified)), C.muted)
      end
    end

    walk.advance_or_arrive()
  elseif type(data) == 'table' then
    -- Dark room: room.info without an identifier. Keep the map on last known position
    -- (muted) rather than tracking or showing a darkness overlay.
    _in_dark    = true
    prediction.clear(false)
    panel:post("room_dark", {})
    walk.advance_or_arrive()
  end
end)

return M
