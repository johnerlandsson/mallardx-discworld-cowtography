-- src/cowtography/api.lua
-- Cross-plugin routing API over Mallard's events bus. The wire contract is
-- documented in README.md, "For plugin authors: routing API".
--
-- Never makes the character move: walkable routes still need the player's
-- /go, and requests are refused while a walk is in progress. Every incoming
-- event gets exactly one cowtography:route_result reply.

local M = {}

-- injected via M.init()
local state, route, walk, panel
local C, note

local EVENT_ROUTE  = 'cowtography:route'
local EVENT_CLEAR  = 'cowtography:route_clear'
local EVENT_RESULT = 'cowtography:route_result'
local MAX_ROOMS    = 500

local ROOMS_SHAPE = 'rooms must be a non-empty array of room id strings'

local function reply(data, fields)
  local src = type(data) == 'table' and data or {}
  fields.request = src.request
  fields.source  = src.source
  events.emit(EVENT_RESULT, fields)
end

local function fail(data, code, message)
  reply(data, { ok = false, error = code, message = message })
end

local function bad_source(data)
  return data.source ~= nil and type(data.source) ~= 'string'
end

-- Returns an error message, or nil when the route payload is valid.
local function validate_route(data)
  if type(data) ~= 'table' then return 'payload must be a table' end
  local rooms = data.rooms
  if type(rooms) ~= 'table' then return ROOMS_SHAPE end
  local n = #rooms
  if n == 0 then return ROOMS_SHAPE end
  if n > MAX_ROOMS then
    return string.format('rooms has %d entries; the limit is %d', n, MAX_ROOMS)
  end
  for k, v in pairs(rooms) do
    if type(k) ~= 'number' or k % 1 ~= 0 or k < 1 or k > n or type(v) ~= 'string' then
      return ROOMS_SHAPE
    end
  end
  if bad_source(data) then return 'source must be a string' end
  if data.label ~= nil and type(data.label) ~= 'string' then return 'label must be a string' end
  if data.walkable ~= nil and type(data.walkable) ~= 'boolean' then return 'walkable must be a boolean' end
  return nil
end

local function success_note(source, visited, moves, skipped_count, walkable)
  local text = string.format('  %s%s: %s%d move%s%s.',
    walkable and 'Route' or 'Guide route',
    source and (' from ' .. source) or '',
    visited > 1 and string.format('%d stops, ', visited) or '',
    moves, moves == 1 and '' or 's',
    skipped_count > 0 and string.format(' (%d skipped)', skipped_count) or '')
  if walkable then
    local p = mud.command_prefix()
    mud.note(mud.span(text .. ' Type ', { fg = C.ok })
          .. mud.span(p .. 'go', { fg = C.ok, on_click = function() walk.walk() end })
          .. mud.span(' to begin.', { fg = C.ok }))
  else
    note(text, C.ok)
  end
end

local function handle_route(data)
  local err = validate_route(data)
  if err then return fail(data, 'invalid_payload', err) end
  if state.current_room == nil then
    return fail(data, 'location_unknown', 'Current room unknown; the player must move through a mapped room first.')
  end
  if walk.get_pos() > 0 then
    return fail(data, 'walk_in_progress', 'The player is walking a route.')
  end

  local stops, seen = {}, {}
  for _, id in ipairs(data.rooms) do
    if id ~= state.current_room and not seen[id] then
      seen[id] = true
      stops[#stops + 1] = id
    end
  end

  local rooms, directions, visited, skipped = route.plan_tour(stops)
  if visited == 0 then
    return fail(data, 'no_reachable_stops', 'None of the requested rooms can be reached from the current room.')
  end

  local walkable = data.walkable ~= false
  local label = data.label or (data.source and ('Route from ' .. data.source)) or 'Route'
  route.apply_route(rooms, directions, label, rooms[#rooms],
    { guide = not walkable, owner = { source = data.source } })
  success_note(data.source, visited, #directions, #skipped, walkable)
  reply(data, { ok = true, stops = visited, moves = #directions, skipped = skipped })
end

local function handle_clear(data)
  if type(data) ~= 'table' then return fail(data, 'invalid_payload', 'payload must be a table') end
  if bad_source(data) then return fail(data, 'invalid_payload', 'source must be a string') end

  local opts = panel.route_opts()
  if not (opts and opts.owner and opts.owner.source == data.source) then
    return reply(data, { ok = true, cleared = false })
  end
  if walk.get_pos() > 0 then
    return fail(data, 'walk_in_progress', 'The player is walking this route.')
  end
  walk.reset_state()
  panel.post_route_clear()
  reply(data, { ok = true, cleared = true })
end

function M.init(deps)
  state = deps.state
  route = deps.route
  walk  = deps.walk
  panel = deps.panel
  C, note = deps.colors.C, deps.colors.note

  events.on(EVENT_ROUTE, handle_route)
  events.on(EVENT_CLEAR, handle_clear)
end

return M
