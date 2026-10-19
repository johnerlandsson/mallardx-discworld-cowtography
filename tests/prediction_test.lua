-- Run from project root: lua tests/prediction_test.lua
package.path = './src/?.lua;' .. package.path

-- Captures every mud.on_send observer by name so tests can drive them with
-- the captures Mallard's regex engine would hand over.
local observers = {}
_G.mud = {
  on_send = function(_, fn, opts) observers[opts.name] = fn end,
}

local posts = {}
local panel = { post = function(_, kind, data) posts[#posts + 1] = { kind = kind, data = data } end }
local walk = { get_pos = function() return 0 end, get_steps_count = function() return 0 end }

-- Cardinal rooms: A -n-> B -u-> C.  Ship rooms: P -sf-> F -sa-> S -a-> T.
local state = {
  PLUGIN_ID = 'net.mallard.discworld-cowtography',
  current_room = 'A',
  exits_by_dir = {
    A = { n = 'B' },
    B = { u = 'C' },
    P = { ['starboard fore'] = 'F' },
    F = { ['starboard aft'] = 'S' },
    S = { aft = 'T' },
  },
  unsinkable_rooms = { P = true, F = true, S = true, T = true },
}

local prediction = require('cowtography.prediction')
prediction.init({ state = state, walk = walk, panel = panel })

local function send(observer, ...)
  local m = { ... }
  m.origin = { plugin_id = 'someone-else' }
  assert(observers[observer], 'no observer named ' .. observer)
  observers[observer](m)
end

local function last_target()
  local p = posts[#posts]
  return p and p.kind == 'target_move' and p.data.identifier or nil
end

local passed = 0
local function test(name, fn)
  posts = {}
  prediction.clear(false)
  posts = {}
  local ok, err = pcall(fn)
  if ok then
    passed = passed + 1
    print('PASS: ' .. name)
  else
    print('FAIL: ' .. name .. ' — ' .. tostring(err))
    os.exit(1)
  end
end

test('plain cardinal move advances prediction', function()
  state.current_room = 'A'
  send('movement-observer', 'n')
  assert(last_target() == 'B', 'expected B, got ' .. tostring(last_target()))
end)

test('plain ship move advances prediction', function()
  state.current_room = 'P'
  send('movement-observer-ship', 'sf')
  assert(last_target() == 'F', 'expected F, got ' .. tostring(last_target()))
end)

test('dragging an object in a cardinal direction advances prediction', function()
  state.current_room = 'A'
  send('drag-observer', 'large wooden chest', 'north')
  assert(last_target() == 'B', 'expected B, got ' .. tostring(last_target()))
  send('drag-observer', 'chest', 'u')
  assert(last_target() == 'C', 'expected C, got ' .. tostring(last_target()))
end)

test('dragging an object aboard the Unsinkable advances prediction', function()
  state.current_room = 'P'
  send('drag-observer', 'tank', 'sf')
  assert(last_target() == 'F', 'expected F, got ' .. tostring(last_target()))
  send('drag-observer', 'tank', 'starboard aft')
  assert(last_target() == 'S', 'expected S, got ' .. tostring(last_target()))
  send('drag-observer', 'tank', 'a')
  assert(last_target() == 'T', 'expected T, got ' .. tostring(last_target()))
end)

test('drag "s" aboard ship means starboard, not south', function()
  state.current_room = 'A'
  state.exits_by_dir.A.s = 'SOUTH'
  state.current_room = 'P'
  state.exits_by_dir.P.starboard = 'STAR'
  send('drag-observer', 'tank', 's')
  assert(last_target() == 'STAR', 'expected STAR, got ' .. tostring(last_target()))
end)

test('own plugin sends are ignored', function()
  state.current_room = 'A'
  local m = { 'tank', 'n', origin = { plugin_id = state.PLUGIN_ID } }
  observers['drag-observer'](m)
  assert(#posts == 0, 'expected no posts')
end)

print(('\n%d tests passed'):format(passed))
