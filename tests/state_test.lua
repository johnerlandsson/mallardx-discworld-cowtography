-- Run from project root: lua tests/state_test.lua
package.path = './src/?.lua;./tests/?.lua;' .. package.path

local fake_db = require('support.fake_db')

_G.db = fake_db.new()
db.exec([[
  CREATE TABLE rooms (
    room_id TEXT PRIMARY KEY, map_id INTEGER, xpos INTEGER, ypos INTEGER,
    room_short TEXT, room_type TEXT
  )
]])
db.exec([[
  CREATE TABLE room_exits (
    room_id TEXT, connect_id TEXT, exit TEXT, guessed INTEGER
  )
]])
db.exec("INSERT INTO rooms VALUES ('r1',1,0,0,'The Mended Drum','inside')")
db.exec("INSERT INTO rooms VALUES ('r2',1,0,0,'Broad Way','outside')")
db.exec("INSERT INTO room_exits VALUES ('r1','r2','n',0)")
db.exec("INSERT INTO room_exits VALUES ('r2','r1','s',0)")

local state = require('cowtography.state')

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

test('exits graph built from room_exits table', function()
  assert(state.exits.r1.r2 == 'n')
  assert(state.exits.r2.r1 == 's')
end)

test('exits_by_dir inverted correctly', function()
  assert(state.exits_by_dir.r1.n == 'r2')
  assert(state.exits_by_dir.r2.s == 'r1')
end)

test('room_exists true for a real room', function()
  assert(state.room_exists('r1') == true)
end)

test('room_exists false for an unknown id', function()
  assert(state.room_exists('AMShades') == false)
end)

print(string.format('\n%d tests passed.', passed))
