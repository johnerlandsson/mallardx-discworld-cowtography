-- src/cowtography/colors.lua
-- Shared note colours and small text-formatting helpers.

local M = {}

M.C = {
  rule     = '#555555',
  header   = '#ffcc88',
  name     = '#ffffff',
  alt      = '#cccccc',
  location = '#88ccff',
  price    = '#aaffaa',
  err      = '#ff6666',
  ok       = '#aaffaa',
  muted    = '#888888',
}

function M.note(text, colour)
  mud.note(text, { fg = colour or M.C.name })
end

-- Count visual columns in a UTF-8 string (codepoints, not bytes).
function M.vlen(s)
  local n, i = 0, 1
  while i <= #s do
    local b = s:byte(i)
    if     b < 0x80 then i = i + 1
    elseif b < 0xE0 then i = i + 2
    elseif b < 0xF0 then i = i + 3
    else                  i = i + 4 end
    n = n + 1
  end
  return n
end

return M
