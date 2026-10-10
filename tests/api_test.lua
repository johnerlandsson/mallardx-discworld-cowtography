-- Run from project root: lua tests/api_test.lua
package.path = './src/?.lua;' .. package.path

local pathfind = require('pathfind')

local listeners, emitted = {}, {}
_G.events = {
  on   = function(name, fn) listeners[name] = fn end,
  emit = function(name, data) emitted[#emitted + 1] = { name = name, data = data } end,
}
local notes = {}
_G.mud = {
  command_prefix = function() return '/' end,
  span = function(s) return s end,
  note = function(s) notes[#notes + 1] = s end,
}

-- A -n-> B -e-> C -s-> D, B -s-> A; X isolated.
local graph = { A = { B = 'n' }, B = { A = 's', C = 'e' }, C = { D = 's' }, D = {}, X = {} }
local state = { current_room = 'A' }

local walk_pos, resets, applied, panel_opts, clears
local function reset()
  emitted, notes = {}, {}
  walk_pos, resets, applied, panel_opts, clears = 0, 0, nil, nil, 0
  state.current_room = 'A'
end

local route = {
  plan_tour   = function(stops) return pathfind.tour(graph, state.current_room, stops) end,
  apply_route = function(rooms, dirs, label, target, opts)
    applied = { rooms = rooms, dirs = dirs, label = label, target = target, opts = opts }
    panel_opts = opts
  end,
}
local walk = {
  get_pos     = function() return walk_pos end,
  reset_state = function() resets = resets + 1 end,
  walk        = function() end,
}
local panel = {
  route_opts       = function() return panel_opts end,
  post_route_clear = function() clears = clears + 1; panel_opts = nil end,
}
local colors = { C = {}, note = function(s) notes[#notes + 1] = s end }

local api = require('cowtography.api')
api.init({ state = state, route = route, walk = walk, panel = panel, colors = colors })

local passed = 0
local function test(name, fn)
  reset()
  local ok, err = pcall(fn)
  if ok then
    passed = passed + 1
    print('PASS: ' .. name)
  else
    print('FAIL: ' .. name .. ' — ' .. tostring(err))
    os.exit(1)
  end
end

-- Fires one event and asserts it produced exactly one route_result reply.
local function send(event, payload)
  local before = #emitted
  listeners[event](payload)
  assert(#emitted == before + 1, 'expected exactly one reply, got ' .. (#emitted - before))
  local r = emitted[#emitted]
  assert(r.name == 'cowtography:route_result', 'reply event was ' .. tostring(r.name))
  return r.data
end
local function route_req(p) return send('cowtography:route', p) end
local function clear_req(p) return send('cowtography:route_clear', p) end

test('non-table payload: invalid_payload, nil request', function()
  local r = route_req('nope')
  assert(r.ok == false and r.error == 'invalid_payload' and r.request == nil)
  assert(type(r.message) == 'string')
end)

test('bad rooms shapes are invalid_payload with request echoed', function()
  local big = {}
  for i = 1, 501 do big[i] = 'R' .. i end
  for _, rooms in ipairs({ 'A', {}, { 1, 2 }, { { id = 'C' } }, { a = 'C' }, big }) do
    local r = route_req({ request = 7, rooms = rooms })
    assert(r.ok == false and r.error == 'invalid_payload' and r.request == 7)
  end
  assert(applied == nil)
end)

test('exactly 500 rooms is accepted', function()
  local rooms = {}
  for i = 1, 499 do rooms[i] = 'missing' .. i end
  rooms[500] = 'C'
  local r = route_req({ rooms = rooms })
  assert(r.ok == true and r.stops == 1 and #r.skipped == 499)
end)

test('bad source, label, walkable types are invalid_payload', function()
  for _, p in ipairs({
    { rooms = { 'C' }, source = 5 },
    { rooms = { 'C' }, label = {} },
    { rooms = { 'C' }, walkable = 'no' },
  }) do
    assert(route_req(p).error == 'invalid_payload')
  end
end)

test('location_unknown when no current room', function()
  state.current_room = nil
  local r = route_req({ rooms = { 'C' } })
  assert(r.error == 'location_unknown')
end)

test('invalid_payload checked before location_unknown', function()
  state.current_room = nil
  assert(route_req({ rooms = {} }).error == 'invalid_payload')
end)

test('walk_in_progress refuses and leaves the route alone', function()
  walk_pos = 3
  local r = route_req({ rooms = { 'C' }, source = 'bp' })
  assert(r.error == 'walk_in_progress' and r.source == 'bp')
  assert(applied == nil and resets == 0)
end)

test('no_reachable_stops for unknown, unreachable, or only-current room', function()
  assert(route_req({ rooms = { 'nope', 'X' } }).error == 'no_reachable_stops')
  assert(route_req({ rooms = { 'A' } }).error == 'no_reachable_stops')
  assert(applied == nil)
end)

test('walkable success: reply, opts, label, note with /go', function()
  local r = route_req({ request = 'r1', source = 'bp', rooms = { 'D', 'nope', 'C', 'C' } })
  assert(r.ok == true and r.request == 'r1' and r.source == 'bp')
  assert(r.stops == 2 and r.moves == 3)
  assert(#r.skipped == 1 and r.skipped[1] == 'nope')
  assert(applied.opts.guide == false and applied.opts.owner.source == 'bp')
  assert(applied.label == 'Route from bp' and applied.target == 'D')
  local n = notes[#notes]
  assert(n:find('Route from bp: 2 stops, 3 moves (1 skipped). Type /go to begin.', 1, true), n)
end)

test('guide success: guide opts and Guide note without /go', function()
  local r = route_req({ source = 'bp', rooms = { 'C' }, walkable = false })
  assert(r.ok == true and applied.opts.guide == true)
  local n = notes[#notes]
  assert(n:find('Guide route from bp: 2 moves.', 1, true), n)
  assert(not n:find('/go', 1, true))
end)

test('labels: custom label wins; no source gives "Route"', function()
  route_req({ rooms = { 'C' }, label = 'Farm run', source = 'bp' })
  assert(applied.label == 'Farm run')
  route_req({ rooms = { 'C' } })
  assert(applied.label == 'Route' and applied.opts.owner.source == nil)
  assert(notes[#notes]:find('Route: 2 moves.', 1, true), notes[#notes])
end)

test('same source twice: one reply each, second route wins', function()
  route_req({ source = 'bp', rooms = { 'B' } })
  route_req({ source = 'bp', rooms = { 'C' } })
  assert(applied.target == 'C' and panel_opts.owner.source == 'bp')
end)

test('clear by owner clears', function()
  route_req({ source = 'bp', rooms = { 'C' } })
  local r = clear_req({ request = 9, source = 'bp' })
  assert(r.ok == true and r.cleared == true and r.request == 9)
  assert(clears == 1 and resets == 1)
end)

test('clear by another source, or none, does nothing', function()
  route_req({ source = 'bp', rooms = { 'C' } })
  assert(clear_req({ source = 'other' }).cleared == false)
  assert(clear_req({}).cleared == false)
  assert(clears == 0)
end)

test('clear with no source matches a route set with no source', function()
  route_req({ rooms = { 'C' } })
  assert(clear_req({}).cleared == true)
end)

test('clear after a player route replaced the API route', function()
  route_req({ source = 'bp', rooms = { 'C' } })
  panel_opts = nil -- player set a route: panel.post_route without opts
  assert(clear_req({ source = 'bp' }).cleared == false and clears == 0)
end)

test('clear of owned route while walking is refused', function()
  route_req({ source = 'bp', rooms = { 'C' } })
  walk_pos = 1
  local r = clear_req({ source = 'bp' })
  assert(r.ok == false and r.error == 'walk_in_progress' and clears == 0)
end)

test('clear with bad payload is invalid_payload', function()
  assert(clear_req(42).error == 'invalid_payload')
  assert(clear_req({ source = 1 }).error == 'invalid_payload')
end)

test('clear works with no current room', function()
  route_req({ source = 'bp', rooms = { 'C' } })
  state.current_room = nil
  assert(clear_req({ source = 'bp' }).cleared == true)
end)

print(string.format('\n%d tests passed.', passed))
