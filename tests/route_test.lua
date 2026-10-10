-- Run from project root: lua tests/route_test.lua
package.path = './src/?.lua;' .. package.path

package.loaded.search      = {}
package.loaded['data.maps'] = {}
_G.mud = {
  command_prefix = function() return '/' end,
  note           = function() end,
  span           = function(s) return s end,
}
_G.settings = { get = function() return 5 end }

local calls
local function reset() calls = { set_route = {}, reset_state = 0, post_route = {}, notes = {} } end
reset()

local walk = {
  set_router  = function() end,
  set_route   = function(...) calls.set_route[#calls.set_route + 1] = { ... } end,
  reset_state = function() calls.reset_state = calls.reset_state + 1 end,
  walk        = function() end,
}
local panel = {
  panel      = { on_message = function() end, post = function() end },
  post_route = function(...) calls.post_route[#calls.post_route + 1] = { ... } end,
}
local state = {
  current_room = 'A',
  exits = { A = { B = 'n' }, B = { A = 's', C = 'e' }, C = { B = 'w' } },
}
local colors = {
  C = {},
  note = function(text) calls.notes[#calls.notes + 1] = text end,
  vlen = function(s) return #s end,
}

local route = require('cowtography.route')
route.init({
  state = state, panel = panel, walk = walk, colors = colors,
  blorps = { closest_reaching = function() return nil end },
})

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

local function has_note(fragment)
  for _, n in ipairs(calls.notes) do
    if n:find(fragment, 1, true) then return true end
  end
  return false
end

test('plan_tour plans from the current room', function()
  local rooms, dirs, visited, skipped = route.plan_tour({ 'C' })
  assert(table.concat(rooms, ',') == 'A,B,C' and table.concat(dirs, ',') == 'n,e')
  assert(visited == 1 and #skipped == 0)
end)

test('apply_route walkable sets the walk and posts opts', function()
  local opts = { owner = { source = 'bp' } }
  route.apply_route({ 'A', 'B', 'C' }, { 'n', 'e' }, 'Lbl', 'C', opts)
  local s = calls.set_route[1]
  assert(s and table.concat(s[1], ',') == 'n,e' and s[3] == 'Lbl' and s[4] == 'C')
  assert(calls.reset_state == 0)
  local p = calls.post_route[1]
  assert(p[2] == 'Lbl' and p[3] == 2 and p[4] == opts)
end)

test('apply_route guide resets the walk instead of setting it', function()
  route.apply_route({ 'A', 'B' }, { 'n' }, 'Lbl', 'B', { guide = true })
  assert(#calls.set_route == 0 and calls.reset_state == 1)
  assert(calls.post_route[1][4].guide == true)
end)

test('long-route warning only for walkable routes over 140 moves', function()
  local rooms, dirs = { 'A' }, {}
  for i = 1, 141 do rooms[#rooms + 1] = 'R' .. i; dirs[#dirs + 1] = 'n' end
  route.apply_route(rooms, dirs, 'L', 'R141', nil)
  assert(has_note('long route'), 'walkable 141 should warn')
  reset()
  route.apply_route(rooms, dirs, 'L', 'R141', { guide = true })
  assert(not has_note('long route'), 'guide should not warn')
end)

test('route_to_room still sets a player route with nil opts', function()
  route.route_to_room('C', 'Cee', false)
  assert(#calls.set_route == 1 and calls.set_route[1][4] == 'C')
  local p = calls.post_route[1]
  assert(p[2] == 'Cee' and p[3] == 2 and p[4] == nil)
end)

test('route_to_room passes opts through', function()
  local opts = { owner = { source = 'bp' } }
  route.route_to_room('C', 'Cee', false, opts)
  assert(calls.post_route[1][4] == opts)
end)

print(string.format('\n%d tests passed.', passed))
