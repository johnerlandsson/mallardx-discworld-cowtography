-- Run from project root: lua tests/search_test.lua
package.path = './src/?.lua;' .. package.path

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
local rooms = {
  r1 = 'The Mended Drum',
  r2 = 'Broad Way',
  r3 = 'outside the drum',
}

test('room: finds case-insensitive match', function()
  local res = search.search_rooms(rooms, 'drum')
  assert(#res == 2, 'expected 2, got ' .. #res)
end)

test('room: returns zero results when no match', function()
  local res = search.search_rooms(rooms, 'zzznomatch')
  assert(#res == 0)
end)

test('room: result has room_id, name, location', function()
  local res = search.search_rooms(rooms, 'Broad')
  assert(#res == 1)
  assert(res[1].room_id == 'r2')
  assert(res[1].name == 'Broad Way')
  assert(res[1].location == 'Broad Way')
end)

test('room: capped at 200 results', function()
  local big = {}
  for i = 1, 250 do big['room' .. i] = 'test room ' .. i end
  local res = search.search_rooms(big, 'test')
  assert(#res == 200, 'expected 200, got ' .. #res)
end)

-- ── search_items ──────────────────────────────────────────────────────────────
local items = {
  { name = 'long sword',  room_id = 'r1', location = 'weapon shop', price = 'A$180' },
  { name = 'short sword', room_id = 'r2', location = 'armory',      price = 'A$90'  },
  { name = 'shield',      room_id = 'r3', location = 'armory',      price = 'A$50'  },
}

test('item: finds matches', function()
  local res = search.search_items(items, 'sword')
  assert(#res == 2, 'expected 2, got ' .. #res)
end)

test('item: case insensitive', function()
  local res = search.search_items(items, 'SWORD')
  assert(#res == 2)
end)

test('item: result has room_id, name, location, price', function()
  local res = search.search_items(items, 'shield')
  assert(#res == 1)
  assert(res[1].room_id == 'r3')
  assert(res[1].price == 'A$50')
end)

-- ── search_npcs ───────────────────────────────────────────────────────────────
local npcs = {
  { name = 'city guard',  room_id = 'r1', location = 'Market Square' },
  { name = 'court wizard', room_id = 'r2', location = 'Palace'       },
}

test('npc: finds match', function()
  local res = search.search_npcs(npcs, 'wizard')
  assert(#res == 1)
  assert(res[1].name == 'court wizard')
end)

-- ── search_npc_items ──────────────────────────────────────────────────────────
local npc_items = {
  { name = 'dagger', npc = 'city guard', room_id = 'r1', location = 'Market Square', price = '' },
  { name = 'staff',  npc = 'court wizard', room_id = 'r2', location = 'Palace',      price = '' },
}

test('npcitem: finds match', function()
  local res = search.search_npc_items(npc_items, 'dag')
  assert(#res == 1)
  assert(res[1].npc == 'city guard')
end)

print(string.format('\n%d tests passed.', passed))
