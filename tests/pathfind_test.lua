-- Run from project root: lua tests/pathfind_test.lua
package.path = './src/?.lua;' .. package.path

local pathfind = require('pathfind')

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

-- Simple graph: A -[n]-> B -[e]-> C
--                        B -[n]-> D
local exits = {
  A = { B = 'n' },
  B = { A = 's', C = 'e', D = 'n' },
  C = { B = 'w' },
  D = { B = 's' },
}

test('finds shortest path A to C', function()
  local path, steps = pathfind.find_path(exits, 'A', 'C')
  assert(path == 'n;e', 'expected "n;e" got "' .. tostring(path) .. '"')
  assert(steps == 2, 'expected 2 steps, got ' .. tostring(steps))
end)

test('find_path returns room_ids as third value', function()
  local _, _, room_ids = pathfind.find_path(exits, 'A', 'C')
  assert(type(room_ids) == 'table', 'expected table, got ' .. type(room_ids))
  assert(room_ids[1] == 'A', 'first should be A, got ' .. tostring(room_ids[1]))
  assert(room_ids[#room_ids] == 'C', 'last should be C, got ' .. tostring(room_ids[#room_ids]))
  assert(#room_ids == 3, 'A->B->C = 3 rooms, got ' .. #room_ids)
end)

test('finds path A to D', function()
  local path, steps = pathfind.find_path(exits, 'A', 'D')
  assert(path == 'n;n', 'expected "n;n" got "' .. tostring(path) .. '"')
  assert(steps == 2)
end)

test('returns nil when start == target', function()
  local path = pathfind.find_path(exits, 'A', 'A')
  assert(path == nil)
end)

test('returns nil for unreachable target', function()
  local exits2 = { A = { B = 'n' }, B = { A = 's' }, X = {} }
  local path = pathfind.find_path(exits2, 'A', 'X')
  assert(path == nil, 'expected nil, got ' .. tostring(path))
end)

test('returns nil when start not in exits', function()
  local path = pathfind.find_path(exits, 'Z', 'C')
  assert(path == nil)
end)

test('returns nil when target not in exits', function()
  local path = pathfind.find_path(exits, 'A', 'Z')
  assert(path == nil)
end)

test('returns nil for nil inputs', function()
  assert(pathfind.find_path(exits, nil, 'C') == nil)
  assert(pathfind.find_path(exits, 'A', nil) == nil)
end)

-- ── distances_from ────────────────────────────────────────────────────────────

test('distances_from: correct distances from A', function()
  local dist = pathfind.distances_from(exits, 'A')
  assert(dist['A'] == 0, 'A should be 0')
  assert(dist['B'] == 1, 'B should be 1')
  assert(dist['C'] == 2, 'C should be 2')
  assert(dist['D'] == 2, 'D should be 2')
end)

test('distances_from: start not in exits returns empty table', function()
  local dist = pathfind.distances_from(exits, 'Z')
  assert(next(dist) == nil, 'expected empty table')
end)

test('distances_from: nil start returns empty table', function()
  local dist = pathfind.distances_from(exits, nil)
  assert(next(dist) == nil, 'expected empty table')
end)

test('distances_from: unreachable room absent from result', function()
  local exits2 = { A = { B = 'n' }, B = { A = 's' }, X = {} }
  local dist = pathfind.distances_from(exits2, 'A')
  assert(dist['A'] == 0)
  assert(dist['B'] == 1)
  assert(dist['X'] == nil, 'X is unreachable from A')
end)

-- ── multi_source_distances ────────────────────────────────────────────────────

test('multi_source_distances: single source matches distances_from', function()
  local dist, origin = pathfind.multi_source_distances(exits, {'A'})
  local single = pathfind.distances_from(exits, 'A')
  for room_id, d in pairs(single) do
    assert(dist[room_id] == d, 'mismatch for ' .. room_id)
    assert(origin[room_id] == 'A', 'origin should be A for ' .. room_id)
  end
end)

test('multi_source_distances: two sources give min distance and correct origin', function()
  local dist, origin = pathfind.multi_source_distances(exits, {'C', 'D'})
  assert(dist['C'] == 0 and origin['C'] == 'C')
  assert(dist['D'] == 0 and origin['D'] == 'D')
  assert(dist['B'] == 1, 'B should be 1 away from nearest source')
  assert(origin['B'] == 'C', 'B should trace back to C (first source in BFS order)')
  assert(dist['A'] == 2, 'A should be 2 away (via B)')
  assert(origin['A'] == 'C')
end)

test('multi_source_distances: empty source list returns empty tables', function()
  local dist, origin = pathfind.multi_source_distances(exits, {})
  assert(next(dist) == nil)
  assert(next(origin) == nil)
end)

test('multi_source_distances: unreachable room absent from result', function()
  local exits2 = { A = { B = 'n' }, B = { A = 's' }, X = {} }
  local dist, origin = pathfind.multi_source_distances(exits2, {'A'})
  assert(dist['X'] == nil, 'X is unreachable')
  assert(origin['X'] == nil)
end)

test('multi_source_distances: duplicate source ids are safe', function()
  local dist, origin = pathfind.multi_source_distances(exits, {'A', 'A', 'B'})
  assert(dist['A'] == 0)
  assert(dist['B'] == 0, 'B is itself a source')
end)

print(string.format('\n%d tests passed.', passed))
