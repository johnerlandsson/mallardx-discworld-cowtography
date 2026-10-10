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

-- ── tour ──────────────────────────────────────────────────────────────────────

-- tour graph (directed): A -n-> B -e-> C -s-> D, B -s-> A, B -w-> E
-- (dead end), X isolated. Distances from A: B=1, C=2, E=2, D=3.
local tg = {
  A = { B = 'n' },
  B = { A = 's', C = 'e', E = 'w' },
  C = { D = 's' },
  D = {},
  E = {},
  X = {},
}

test('tour: visits stops nearest-first', function()
  local rooms, dirs, visited, skipped = pathfind.tour(tg, 'A', { 'D', 'B' })
  assert(table.concat(rooms, ',') == 'A,B,C,D', table.concat(rooms, ','))
  assert(table.concat(dirs, ',') == 'n,e,s', table.concat(dirs, ','))
  assert(visited == 2 and #skipped == 0)
end)

test('tour: stop order does not depend on input order', function()
  local rooms, _, visited = pathfind.tour(tg, 'A', { 'D', 'C' })
  assert(table.concat(rooms, ',') == 'A,B,C,D', table.concat(rooms, ','))
  assert(visited == 2)
end)

test('tour: duplicates and start room ignored', function()
  local rooms, dirs, visited, skipped = pathfind.tour(tg, 'A', { 'A', 'C', 'C' })
  assert(#rooms == 3 and #dirs == 2 and visited == 1 and #skipped == 0)
end)

test('tour: one-way exits are not walked backwards', function()
  local rooms, dirs, visited, skipped = pathfind.tour(tg, 'D', { 'A' })
  assert(#rooms == 1 and #dirs == 0 and visited == 0)
  assert(#skipped == 1 and skipped[1] == 'A')
end)

test('tour: unknown and unreachable ids skipped in input order, deduped', function()
  local _, _, visited, skipped = pathfind.tour(tg, 'A', { 'nope', 'X', 'C', 'nope' })
  assert(visited == 1)
  assert(table.concat(skipped, ',') == 'nope,X', table.concat(skipped, ','))
end)

test('tour: equal-distance tie goes to lowest id', function()
  -- C and E are both 2 moves from A; E is a dead end, so taking C first
  -- means E becomes unreachable. Lowest id ('C' < 'E') must win, every time.
  for _ = 1, 20 do
    local rooms, _, visited, skipped = pathfind.tour(tg, 'A', { 'E', 'C' })
    assert(rooms[3] == 'C', 'expected C first, got ' .. tostring(rooms[3]))
    assert(visited == 1 and skipped[1] == 'E')
  end
end)

test('tour: single stop matches find_path length', function()
  local _, steps = pathfind.find_path(exits, 'A', 'D')
  local _, dirs, visited = pathfind.tour(exits, 'A', { 'D' })
  assert(visited == 1 and #dirs == steps, 'tour ' .. #dirs .. ' vs find_path ' .. tostring(steps))
end)

test('tour: start room with no exits', function()
  local rooms, dirs, visited, skipped = pathfind.tour(tg, 'X', { 'A' })
  assert(#rooms == 1 and rooms[1] == 'X' and #dirs == 0 and visited == 0 and skipped[1] == 'A')
end)

test('tour: empty stop list', function()
  local rooms, dirs, visited, skipped = pathfind.tour(tg, 'A', {})
  assert(#rooms == 1 and #dirs == 0 and visited == 0 and #skipped == 0)
end)

print(string.format('\n%d tests passed.', passed))
