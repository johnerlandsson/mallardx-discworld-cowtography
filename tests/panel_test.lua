-- Run from project root: lua tests/panel_test.lua
package.path = './src/?.lua;' .. package.path

local panels = {}
_G.mud = {
  panel = function(id)
    local p = { callbacks = {}, posts = {} }
    function p:on_message(name, cb) self.callbacks[name] = cb end
    function p:post(name, data) self.posts[#self.posts + 1] = { name = name, data = data } end
    panels[id] = p
    return p
  end,
}
_G.storage  = { get = function() end, set = function() end }
_G.settings = { get = function() end }
_G.vars     = { set = function() end }
_G.events   = { on = function() end, emit = function() end }

local panel = require('cowtography.panel')
panel.init({
  state = { last_payload = nil },
  uu_library = {
    is_in_lspace  = function() return false end,
    is_in_library = function() return false end,
  },
})
local map = panels.map
local function last() return map.posts[#map.posts] end

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

test('post_route without opts posts no guide and stores no opts', function()
  panel.post_route({ 'A', 'B' }, 'B', 1)
  assert(last().name == 'route_set')
  assert(last().data.guide == nil)
  assert(panel.route_opts() == nil)
end)

test('post_route with opts posts guide, keeps owner Lua-side', function()
  local opts = { guide = true, owner = { source = 'bp' } }
  panel.post_route({ 'A', 'B' }, 'Farm', 1, opts)
  assert(last().data.guide == true)
  assert(last().data.owner == nil, 'owner must not be sent to the UI')
  assert(panel.route_opts() == opts)
end)

test('guide=false is posted as nil', function()
  panel.post_route({ 'A', 'B' }, 'B', 1, { guide = false, owner = {} })
  assert(last().data.guide == nil)
end)

test('player route after API route drops ownership', function()
  panel.post_route({ 'A', 'B' }, 'Farm', 1, { guide = true, owner = { source = 'bp' } })
  panel.post_route({ 'A', 'C' }, 'C', 1)
  assert(panel.route_opts() == nil)
end)

test('ready replay includes guide', function()
  panel.post_route({ 'A', 'B' }, 'Farm', 1, { guide = true, owner = { source = 'bp' } })
  map.callbacks.ready()
  local replay
  for i = #map.posts, 1, -1 do
    if map.posts[i].name == 'route_set' then replay = map.posts[i]; break end
  end
  assert(replay and replay.data.guide == true and replay.data.destination == 'Farm')
end)

test('post_route_clear clears opts and ready replays no route', function()
  panel.post_route({ 'A', 'B' }, 'Farm', 1, { guide = true })
  panel.post_route_clear()
  assert(last().name == 'route_clear')
  assert(panel.route_opts() == nil)
  local n = #map.posts
  map.callbacks.ready()
  for i = n + 1, #map.posts do assert(map.posts[i].name ~= 'route_set') end
end)

print(string.format('\n%d tests passed.', passed))
