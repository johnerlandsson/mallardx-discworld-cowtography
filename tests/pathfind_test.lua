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

print(string.format('\n%d tests passed.', passed))
