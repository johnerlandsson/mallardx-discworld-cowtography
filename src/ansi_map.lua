-- Parses Discworld's room.map GMCP payload (a coloured ASCII grid) into
-- rows of cell records for the ASCII Map panel to render.
--
-- Ported from mallardx-discworld-mdt's src/parser.lua (M.parse_terrain +
-- sgr_state_to_hex), which solves the identical problem for the terrain
-- variant of room.writtenmap — that plugin is a separate repo so this
-- logic can't be shared via require(), only re-implemented.

local M = {}

-- xterm 16-colour (VGA) palette. Bold promotes 0-7 into the bright 8-15
-- range — this matches what Discworld assumes when it emits e.g.
-- "\27[1;33m" (bold yellow) for the player marker.
local SGR_BASIC = {
  "#000000", "#aa0000", "#00aa00", "#aa5500",
  "#0000aa", "#aa00aa", "#00aaaa", "#aaaaaa",
  "#555555", "#ff5555", "#55ff55", "#ffff55",
  "#5555ff", "#ff55ff", "#55ffff", "#ffffff",
}

local function sgr_state_to_hex(fg, bold)
  if fg == nil then return nil end
  if bold and fg < 8 then fg = fg + 8 end
  return SGR_BASIC[fg + 1]
end

-- Parse a room.map payload into a list of rows, each a list of cell
-- records {char, fg, bold}. `fg` is a hex colour string or nil for
-- default. Strips all SGR sequences and defensively unwraps Discworld's
-- MXP colour-wrapper markers (\27[4zmxp<...mxp>...\27[3z) — no map.map
-- payload has been observed to carry these (unlike room.writtenmap
-- entity names), but stripping them defensively avoids rendering their
-- raw escape bytes as garbage characters if one ever does.
function M.parse(input)
  if type(input) ~= 'string' or input == '' then return {} end

  input = input:gsub('\27%[4zmxp<.-mxp>', ''):gsub('\27%[3z', '')

  local rows = {{}}
  local fg = nil
  local bold = false

  local i = 1
  while i <= #input do
    local byte = input:byte(i)
    if byte == 27 then
      -- SGR: \27[<params>m. Any other escape (unlikely here after the
      -- MXP strip above) is skipped one byte at a time.
      local params, after = input:match('^%[([0-9;]*)m()', i + 1)
      if params then
        for code in (params .. ';'):gmatch('([^;]*);') do
          if code == '' or code == '0' then
            fg = nil; bold = false
          else
            local n = tonumber(code)
            if n == 1 then bold = true
            elseif n == 22 then bold = false
            elseif n == 39 then fg = nil
            elseif n and n >= 30 and n <= 37 then fg = n - 30
            elseif n and n >= 90 and n <= 97 then fg = n - 90 + 8
            end
          end
        end
        i = after
      else
        i = i + 1
      end
    elseif byte == 10 then  -- \n
      if #rows[#rows] > 0 then rows[#rows + 1] = {} end
      i = i + 1
    elseif byte == 13 then  -- \r — defensive; not observed in captures
      i = i + 1
    else
      rows[#rows][#rows[#rows] + 1] = {
        char = string.char(byte),
        fg = sgr_state_to_hex(fg, bold),
        bold = bold and fg ~= nil,
      }
      i = i + 1
    end
  end

  -- Drop a trailing empty row (payloads end with \n).
  if #rows > 0 and #rows[#rows] == 0 then rows[#rows] = nil end
  return rows
end

return M
