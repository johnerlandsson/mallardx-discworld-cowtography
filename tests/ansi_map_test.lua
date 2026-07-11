-- Run from project root: lua tests/ansi_map_test.lua
package.path = './src/?.lua;' .. package.path

local ansi_map = require('ansi_map')

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

test('empty payload returns zero rows', function()
  local rows = ansi_map.parse('')
  assert(#rows == 0, 'expected 0 rows, got ' .. #rows)
end)

test('plain text with no escapes: one row, no colour', function()
  local rows = ansi_map.parse('ab')
  assert(#rows == 1, 'expected 1 row, got ' .. #rows)
  assert(#rows[1] == 2, 'expected 2 cells, got ' .. #rows[1])
  assert(rows[1][1].char == 'a')
  assert(rows[1][1].fg == nil, 'expected nil fg, got ' .. tostring(rows[1][1].fg))
  assert(rows[1][1].bold == false)
  assert(rows[1][2].char == 'b')
end)

test('simple SGR foreground colour applies to following chars', function()
  local rows = ansi_map.parse('\27[31m+\27[0m ')
  assert(rows[1][1].char == '+')
  assert(rows[1][1].fg == '#aa0000', 'expected red, got ' .. tostring(rows[1][1].fg))
  assert(rows[1][1].bold == false)
  -- reset (\27[0m) clears colour for the space that follows
  assert(rows[1][2].char == ' ')
  assert(rows[1][2].fg == nil)
end)

test('compound SGR (bold + colour) promotes to the bright palette entry', function()
  local rows = ansi_map.parse('\27[1;33m@\27[39;49m')
  assert(rows[1][1].char == '@')
  assert(rows[1][1].fg == '#ffff55', 'expected bright yellow, got ' .. tostring(rows[1][1].fg))
  assert(rows[1][1].bold == true)
end)

test('newlines split into separate rows', function()
  local rows = ansi_map.parse('ab\ncd\n')
  assert(#rows == 2, 'expected 2 rows, got ' .. #rows)
  assert(rows[1][1].char == 'a')
  assert(rows[2][1].char == 'c')
end)

test('trailing newline does not produce a phantom empty row', function()
  local rows = ansi_map.parse('a\n')
  assert(#rows == 1, 'expected 1 row, got ' .. #rows)
end)

test('MXP colour wrapper markers are stripped, inner text preserved', function()
  local rows = ansi_map.parse('\27[4zmxp<#ff0000mxp>Rm\27[3z')
  assert(#rows[1] == 2, 'expected 2 cells, got ' .. #rows[1])
  assert(rows[1][1].char == 'R')
  assert(rows[1][2].char == 'm')
end)

test('real captured payload (village forge) parses without error', function()
  local sample = '    \27[39;49m\27[0m\27[1;33m@\27[39;49m\27[0m     \n' ..
                 '    \27[39;49m\27[0m\27[31m+\27[39;49m\27[0m     \n'
  local rows = ansi_map.parse(sample)
  assert(#rows == 2, 'expected 2 rows, got ' .. #rows)
  assert(rows[1][5].char == '@')
  assert(rows[1][5].fg == '#ffff55')
  assert(rows[1][5].bold == true)
  assert(rows[2][5].char == '+')
  assert(rows[2][5].fg == '#aa0000')
  assert(rows[2][5].bold == false)
end)

print(string.format('\n%d/%d tests passed', passed, 8))
