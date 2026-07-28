-- src/cowtography/panel.lua
-- Map panel + ASCII map panel: owns both mud.panel() objects and every
-- post_* helper that mirrors state to them.

local M = {}

M.panel        = mud.panel("map")
M.ascii_panel  = mud.panel("ascii_map")

-- injected via M.init(); the "ready" handler below closes over these
local state      -- cowtography.state module
local uu_library -- cowtography.uu_library module

local last_route             = nil
local last_route_destination = nil
local last_route_steps       = nil
local last_ascii_rows        = nil
local current_map             = nil

function M.init(deps)
  state      = deps.state
  uu_library = deps.uu_library
end

function M.post_room(payload)
  M.panel:post("room_info", {
    identifier = payload.identifier,
    name       = payload.name,
    terrain    = payload.terrain,
    tx         = payload.tx,
    ty         = payload.ty,
  })
end

function M.post_route(room_ids, destination, steps)
  last_route             = room_ids
  last_route_destination = destination
  last_route_steps       = steps
  M.panel:post("route_set", { rooms = room_ids, destination = destination, steps = steps })
end

function M.post_route_clear()
  last_route             = nil
  last_route_destination = nil
  last_route_steps       = nil
  M.panel:post("route_clear", {})
end

function M.post_ascii_rows(rows)
  last_ascii_rows = rows
  M.ascii_panel:post("map_rows", { rows = rows })
end

M.ascii_panel:on_message("ready", function()
  M.ascii_panel:post("map_rows", { rows = last_ascii_rows or {} })
  local zoom = storage.get('ascii_zoom')
  if type(zoom) == 'number' then M.ascii_panel:post('zoom_data', { size = zoom }) end
end)

M.ascii_panel:on_message("save_zoom", function(data)
  storage.set('ascii_zoom', data.size)
end)

M.ascii_panel:on_message("set_map_output", function(data)
  local value = data.on and "top" or "off"
  mud.send("options output map look=" .. value, { silent = true })
  mud.send("options output map lookcity=" .. value, { silent = true })
  mud.send("options output map glance=" .. value, { silent = true })
  mud.send("options output map glancecity=" .. value, { silent = true })
end)

M.panel:on_message("ready", function()
  local zoom = storage.get('zoom')
  if type(zoom) == 'table' then M.panel:post('zoom_data', zoom) end
  local filters = storage.get('filters')
  if type(filters) == 'table' then M.panel:post('filters_data', filters) end
  M.panel:post("map_style", { style = settings.get('map_style') or 'svg' })
  if uu_library.is_in_lspace() then
    M.panel:post("lspace", {})
  elseif uu_library.is_in_library() then
    local last_lib_position = uu_library.get_last_position()
    local last_lib_overlay  = uu_library.get_last_overlay()
    if last_lib_position then M.panel:post("library_position", last_lib_position) end
    if last_lib_overlay  then M.panel:post("library_overlay",  last_lib_overlay)  end
  else
    if state.last_payload then M.post_room(state.last_payload) end
    if last_route then
      M.panel:post("route_set", { rooms = last_route, destination = last_route_destination, steps = last_route_steps })
    end
  end
end)

M.panel:on_message("map_changed", function(data)
  current_map = data.name
  vars.set("cowtography.map", data.name)
  events.emit("cowtography:region_changed", { map = data.name })
end)

events.on("cowtography:region_request", function()
  if current_map then
    events.emit("cowtography:region_changed", { map = current_map })
  end
end)

M.panel:on_message("save_filters", function(data)
  storage.set('filters', data)
end)

M.panel:on_message("save_zoom", function(data)
  local zoom = storage.get('zoom')
  if type(zoom) ~= 'table' then zoom = {} end
  zoom[tostring(data.mapId)] = data.w
  storage.set('zoom', zoom)
end)

return M
