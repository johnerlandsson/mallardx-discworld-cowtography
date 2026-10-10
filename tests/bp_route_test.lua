-- Run from project root: lua tests/bp_route_test.lua
package.path = './src/?.lua;' .. package.path
local planner = require('cowtography.bp_route')
local passed = 0
local function test(name, fn)
  local ok, err = pcall(fn)
  assert(ok, name .. ': ' .. tostring(err))
  passed = passed + 1
  print('PASS: ' .. name)
end

local exits = { A = {B = 'n'}, B = {C = 'e'}, C = {D = 's'}, D = {} }
test('visits nearest candidates with every intermediate map room', function()
  local rooms, directions, stops, skipped = planner.calculate(exits, 'A', {{id='D'}, {id='C'}, {id='missing'}})
  assert(table.concat(rooms, ',') == 'A,B,C,D')
  assert(table.concat(directions, ',') == 'n,e,s')
  assert(stops == 2 and skipped == 1)
end)
test('ignores duplicate and current-room candidates', function()
  local rooms, directions, stops, skipped = planner.calculate(exits, 'A', {{id='A'}, {id='C'}, {id='C'}})
  assert(#rooms == 3 and #directions == 2 and stops == 1 and skipped == 0)
end)
test('does not invent reverse exits', function()
  local rooms, directions, stops, skipped = planner.calculate(exits, 'D', {{id='A'}})
  assert(#rooms == 1 and #directions == 0 and stops == 0 and skipped == 1)
end)
test('handles empty candidates and invalid room ids', function()
  local rooms, directions, stops, skipped = planner.calculate(exits, 'A', {{}, {id=1}, false, 'invalid'})
  assert(#rooms == 1 and #directions == 0 and stops == 0 and skipped == 0)
end)
test('handles a missing starting room', function()
  local rooms, directions, stops, skipped = planner.calculate(exits, 'unknown', {{id='C'}})
  assert(#rooms == 1 and #directions == 0 and stops == 0 and skipped == 1)
end)
test('keeps large route searches within an instruction budget', function()
  local graph, candidates = {}, {}
  for i = 1, 3000 do
    graph[tostring(i)] = {}
    if i < 3000 then graph[tostring(i)][tostring(i + 1)] = 'n' end
    if i > 1 and i <= 271 then candidates[#candidates + 1] = {id=tostring(i)} end
  end
  candidates[#candidates + 1] = {id='unreachable'}
  local ticks = 0
  debug.sethook(function()
    ticks = ticks + 1
    assert(ticks < 5000, 'instruction budget exceeded')
  end, '', 1000)
  local rooms, directions, stops, skipped = planner.calculate(graph, '1', candidates)
  debug.sethook()
  assert(#rooms == 271 and #directions == 270 and stops == 270 and skipped == 1)
end)
print(string.format('%d BP route planner tests passed', passed))
