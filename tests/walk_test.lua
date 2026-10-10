-- Run from project root: lua tests/walk_test.lua
package.path = './src/?.lua;' .. package.path

_G.mud = {
  trigger        = function() end,
  every          = function() end,
  send           = function() end,
  note           = function() end,
  span           = function(s) return s end,
  command_prefix = function() return '/' end,
  play_sound     = function() end,
}
_G.settings = { get = function() return false end }

local current_opts
local posts = {}
local panel = {
  panel = { on_message = function() end, post = function() end },
  post_route = function(rooms, dest, steps, opts)
    posts[#posts + 1] = { rooms = rooms, dest = dest, steps = steps, opts = opts }
    current_opts = opts
  end,
  post_route_clear = function() current_opts = nil end,
  route_opts = function() return current_opts end,
}
local state = { current_room = 'A' }

local walk = require('cowtography.walk')
walk.init({ state = state, panel = panel, colors = { C = {}, note = function() end } })

local router_calls = {}
walk.set_router(function(...) router_calls[#router_calls + 1] = { ... } end)

local passed = 0
local function test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    passed = passed + 1
    print('PASS: ' .. name)
  else
    print('FAIL: ' .. name .. ' — ' .. tostring(err))
    os.exit(1)
  end
end

-- Starts a 2-step walk A -> B -> C with the given opts as the panel's
-- current route opts (as if apply_route had just posted it).
local function start_walk(opts)
  current_opts = opts
  state.current_room = 'A'
  walk.set_route({ 'n', 'e' }, { 'A', 'B', 'C' }, 'Dest', 'C')
  walk.walk()
  assert(walk.get_pos() == 1)
end

test('pause on-route re-posts remaining route with current opts', function()
  local opts = { owner = { source = 'bp' } }
  start_walk(opts)
  walk.paused('Movement queue was cleared.')
  local p = posts[#posts]
  assert(p.opts == opts, 'opts must survive a pause')
  assert(p.steps == 2 and p.dest == 'Dest')
  assert(walk.get_pos() == 0)
end)

test('pause on-route with a player route posts nil opts', function()
  start_walk(nil)
  walk.paused('Movement queue was cleared.')
  assert(posts[#posts].opts == nil)
end)

test('off-route pause reroutes with the opts read before clearing', function()
  local opts = { owner = { source = 'bp' } }
  start_walk(opts)
  state.current_room = 'Z'
  walk.paused('Movement queue was cleared.')
  local call = router_calls[#router_calls]
  assert(call[1] == 'C' and call[2] == 'Dest' and call[3] == false)
  assert(call[4] == opts, 'router must receive the pre-clear opts')
end)

print(string.format('\n%d tests passed.', passed))
