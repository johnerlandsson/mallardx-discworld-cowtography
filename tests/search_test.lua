-- Run from project root: lua tests/search_test.lua
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
  CREATE TABLE shop_items (
    room_id TEXT, item_name TEXT, sale_price TEXT
  )
]])
db.exec([[
  CREATE TABLE npc_info (
    npc_id TEXT PRIMARY KEY, map_id INTEGER, npc_name TEXT, room_id TEXT
  )
]])
db.exec([[
  CREATE TABLE npc_items (
    npc_id TEXT, item_name TEXT, sale_price TEXT
  )
]])

db.exec("INSERT INTO rooms VALUES ('r1',1,0,0,'The Mended Drum','inside')")
db.exec("INSERT INTO rooms VALUES ('r2',1,0,0,'Broad Way','outside')")
db.exec("INSERT INTO rooms VALUES ('r3',1,0,0,'outside the drum','outside')")

db.exec("INSERT INTO shop_items VALUES ('r1','long sword','A$180')")
db.exec("INSERT INTO shop_items VALUES ('r2','short sword','A$90')")
db.exec("INSERT INTO shop_items VALUES ('r3','shield','A$50')")

db.exec("INSERT INTO npc_info VALUES ('npc1',1,'city guard','r1')")
db.exec("INSERT INTO npc_info VALUES ('npc2',1,'court wizard','r2')")

db.exec("INSERT INTO npc_items VALUES ('npc1','dagger','')")
db.exec("INSERT INTO npc_items VALUES ('npc2','staff','')")

local search = require('search')

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

-- ── search_rooms ─────────────────────────────────────────────────────────────
test('room: finds case-insensitive match', function()
  local res = search.search_rooms('drum')
  assert(#res == 2, 'expected 2, got ' .. #res)
end)

test('room: returns zero results when no match', function()
  local res = search.search_rooms('zzznomatch')
  assert(#res == 0)
end)

test('room: result has room_id, name, location, map_id', function()
  local res = search.search_rooms('Broad')
  assert(#res == 1)
  assert(res[1].room_id == 'r2')
  assert(res[1].name == 'Broad Way')
  assert(res[1].location == 'Broad Way')
  assert(tostring(res[1].map_id) == '1')
end)

test('room: capped at 200 results', function()
  for i = 1, 250 do
    db.exec("INSERT INTO rooms VALUES (?,1,0,0,?,'inside')", { 'bulk' .. i, 'test room ' .. i })
  end
  local res = search.search_rooms('test')
  assert(#res == 200, 'expected 200, got ' .. #res)
end)

-- ── search_items ──────────────────────────────────────────────────────────────
test('item: finds matches', function()
  local res = search.search_items('sword')
  assert(#res == 2, 'expected 2, got ' .. #res)
end)

test('item: case insensitive', function()
  local res = search.search_items('SWORD')
  assert(#res == 2)
end)

test('item: result has room_id, name, location, price', function()
  local res = search.search_items('shield')
  assert(#res == 1)
  assert(res[1].room_id == 'r3')
  assert(res[1].price == 'A$50')
end)

test('item: underscore in query is literal, not a single-char wildcard', function()
  db.exec("INSERT INTO shop_items VALUES ('r1','long_sword','A$10')")
  db.exec("INSERT INTO shop_items VALUES ('r2','longXsword','A$10')")
  local res = search.search_items('long_sword')
  assert(#res == 1, 'expected 1, got ' .. #res)
  assert(res[1].name == 'long_sword')
end)

test('item: percent sign in query is literal, not a wildcard', function()
  db.exec("INSERT INTO shop_items VALUES ('r1','50% discount token','A$1')")
  local res = search.search_items('50%')
  assert(#res == 1, 'expected 1, got ' .. #res)
end)

test('item: backslash in query is literal, not an escape character', function()
  db.exec("INSERT INTO shop_items VALUES ('r1','back\\slash','A$1')")
  db.exec("INSERT INTO shop_items VALUES ('r2','backslash','A$1')")
  local res = search.search_items('back\\slash')
  assert(#res == 1, 'expected 1, got ' .. #res)
  assert(res[1].name == 'back\\slash', 'expected back\\slash, got ' .. tostring(res[1].name))
end)

-- ── search_npcs ───────────────────────────────────────────────────────────────
test('npc: finds match', function()
  local res = search.search_npcs('wizard')
  assert(#res == 1)
  assert(res[1].name == 'court wizard')
end)

-- ── search_npc_items ──────────────────────────────────────────────────────────
test('npcitem: finds match', function()
  local res = search.search_npc_items('dag')
  assert(#res == 1)
  assert(res[1].npc == 'city guard')
end)

print(string.format('\n%d tests passed.', passed))
