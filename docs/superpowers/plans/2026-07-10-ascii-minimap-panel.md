# ASCII Minimap Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new, independent "ASCII Map" panel that renders Discworld's live GMCP `room.map` frame as a coloured monospace grid.

**Architecture:** A new Lua module (`src/ansi_map.lua`) parses the raw `room.map` string into rows of `{char, fg, bold}` cells (SGR escape codes resolved to hex colours). `src/main.lua` subscribes to the `room.map` GMCP frame, runs it through the parser, and pushes the resulting rows to a new panel (`ui/ascii_map.html`/`.css`/`.js`) that renders them as coloured `<span>`s in a monospace block — no interactivity, no settings, no config-fixing.

**Tech Stack:** Lua (plugin logic, LuaJIT/5.1-compatible), vanilla JS (panel UI, `window.panel` bridge injected by the Mallard host), TOML (plugin manifest).

**Reference implementation:** `/home/john/src/mallardx-discworld-mdt/src/parser.lua` — its `M.parse_terrain()` (lines 220-273) and `sgr_state_to_hex()` (lines 209-218) solve the identical SGR-grid parsing problem for a sibling GMCP frame (`room.writtenmap`'s terrain variant). This plan ports that logic into this plugin (`src/ansi_map.lua`) rather than reinventing it — it's a separate plugin repo, so no cross-plugin `require` is possible, but the algorithm is proven and its behaviour has been spot-checked against this plugin's own live-captured `room.map` payload during design (village-forge sample: `@` rendered bold-yellow `#ffff55`, `+` rendered plain red `#aa0000` — matches the game's intent).

## Global Constraints

- No new plugin settings (per spec: panel visibility uses Mallard's normal show/hide, matching the existing "Map" panel).
- No auto-fix button or automatic `options output`/config commands (per spec: confirmed live on 2026-07-10 that `options output map` has zero effect on the GMCP feed — nothing to detect or fix).
- No click-to-route or other interactivity in v1.
- Do not parse `room.writtenmap` — that belongs to the sibling `mallardx-discworld-mdt` plugin.
- Follow this repo's existing Lua test convention: standalone `lua tests/<name>_test.lua` scripts using the `pcall`-based `test(name, fn)` harness already established in `tests/search_test.lua` and `tests/pathfind_test.lua` (assert-based, `os.exit(1)` on first failure, `print('PASS: ...')`/`print('FAIL: ...')` per case) — not a test framework dependency.
- Follow this repo's existing panel-bridge convention: the JS side uses the host-injected global `window.panel` (`panel.on(name, fn)` / `panel.post(name, data)`), exactly as `ui/mapper.js` does — do not use the older raw `window.postMessage`/`window.parent.postMessage` pattern (that's a different, now-superseded convention used by the sibling `mdt` plugin, which targets an older `minimum_app_version`).
- Design doc: `docs/superpowers/specs/2026-07-10-ascii-minimap-panel-design.md` — read it if any task here seems to contradict it; this plan implements it (with the Lua-side-parsing refinement noted above).

---

### Task 1: ANSI/SGR grid parser (`src/ansi_map.lua`)

**Files:**
- Create: `src/ansi_map.lua`
- Test: `tests/ansi_map_test.lua`

**Interfaces:**
- Produces: `ansi_map.parse(input)` — takes the raw `room.map` GMCP payload (a Lua string, possibly `""` or containing `\x1b[...m` SGR sequences, `\n` row separators, and defensively-stripped MXP colour wrappers `\x1b[4zmxp<...mxp>...\x1b[3z`). Returns an array of rows, each an array of cell tables `{ char = <1-char string>, fg = <hex string or nil>, bold = <boolean> }`. Empty input returns `{}` (an empty Lua table, i.e. zero rows).
- Consumes: nothing from other tasks (pure, dependency-free module).

- [ ] **Step 1: Write the failing test file**

Create `tests/ansi_map_test.lua`:

```lua
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

print(string.format('\n%d/%d tests passed', passed, 7))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `lua tests/ansi_map_test.lua` (use `luajit tests/ansi_map_test.lua` if `lua` is not on PATH — both are Lua 5.1-compatible and run this repo's test files identically)

Expected: FAIL immediately with a `module 'ansi_map' not found` error (no PASS lines printed).

- [ ] **Step 3: Write the implementation**

Create `src/ansi_map.lua`:

```lua
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `lua tests/ansi_map_test.lua`
Expected: 7 `PASS:` lines, ending with `7/7 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/ansi_map.lua tests/ansi_map_test.lua
git commit -m "feat: add ANSI/SGR grid parser for room.map payloads"
```

---

### Task 2: Register the panel and GMCP frame in the manifest

**Files:**
- Modify: `plugin.toml`

**Interfaces:**
- Consumes: nothing.
- Produces: a `panels.ascii_map` entry (`ui/ascii_map.html`, created in Task 4) and GMCP permission/advertisement for `room.map` (consumed by Task 3's `gmcp.on("room.map", ...)`).

- [ ] **Step 1: Add `room.map` to the GMCP permission list**

In `plugin.toml`, change:

```toml
[permissions]
sends       = true
gmcp_access = ["room.info", "char.info", "char.info.*", "char.info.capname"]
```

to:

```toml
[permissions]
sends       = true
gmcp_access = ["room.info", "char.info", "char.info.*", "char.info.capname", "room.map"]
```

- [ ] **Step 2: Add `room.map` to the GMCP advertise list**

Change:

```toml
[gmcp]
advertise = ["room.info", "char.info"]
```

to:

```toml
[gmcp]
advertise = ["room.info", "char.info", "room.map"]
```

- [ ] **Step 3: Add the new panel definition**

Immediately after the existing `[panels.map]` block:

```toml
[panels.map]
title        = "Map"
entry        = "ui/mapper.html"
default_dock = "right"
default_size = { width = 360, height = 360 }
```

add:

```toml
[panels.ascii_map]
title        = "ASCII Map"
entry        = "ui/ascii_map.html"
default_dock = "bottom"
default_size = { width = 480, height = 220 }
```

- [ ] **Step 4: Verify the file is still well-formed TOML**

Run: `node -e "require('fs').readFileSync('plugin.toml','utf8').split('\n').forEach(l=>{if(l.includes('\t'))throw new Error('tab found: '+l)})"`

Expected: no output (this project's `plugin.toml` uses aligned spaces, not tabs — this just guards against an accidental tab breaking alignment; it is not a full TOML parse, so also re-read the diff by eye to confirm bracket/quote balance).

- [ ] **Step 5: Commit**

```bash
git add plugin.toml
git commit -m "feat: register room.map GMCP access and the ASCII Map panel"
```

---

### Task 3: Wire `room.map` GMCP handling in `src/main.lua`

**Files:**
- Modify: `src/main.lua:16-23` (require block), `src/main.lua:133-139` (panel setup block), `src/main.lua:560-566` (GMCP section, immediately before the existing `gmcp.on('room.info', ...)` handler)

**Interfaces:**
- Consumes: `ansi_map.parse(input)` from Task 1 (returns rows array as documented there); `mud.panel(name)`, `panel:post(name, data)`, `panel:on_message(name, fn)`, `gmcp.on(pkg, fn)` — all already used elsewhere in this file for the existing `"map"` panel and `room.info`/`char.info` handlers, same signatures.
- Produces: a live `ascii_map` panel feed — posts `"map_rows"` with `{ rows = <rows array> }` to the `ascii_map` panel handle, on every `room.map` GMCP event and on panel `"ready"`.

- [ ] **Step 1: Add the `ansi_map` require**

In `src/main.lua`, change the require block:

```lua
local search    = require('search')
local pathfind  = require('pathfind')
local rooms     = require('data.rooms')
local items     = require('data.items')
local npcs      = require('data.npcs')
local npc_items = require('data.npc_items')
local exits     = require('data.exits')
local map_names = require('data.map_names')
```

to:

```lua
local search    = require('search')
local pathfind  = require('pathfind')
local ansi_map  = require('ansi_map')
local rooms     = require('data.rooms')
local items     = require('data.items')
local npcs      = require('data.npcs')
local npc_items = require('data.npc_items')
local exits     = require('data.exits')
local map_names = require('data.map_names')
```

- [ ] **Step 2: Add the ASCII map panel handle and rehydrate-on-ready logic**

Immediately after this existing block (`src/main.lua:135-139`):

```lua
local panel        = mud.panel("map")
local last_payload = nil
local last_route             = nil
local last_route_destination = nil
local last_route_steps       = nil
```

add:

```lua
local ascii_panel     = mud.panel("ascii_map")
local last_ascii_rows = nil

ascii_panel:on_message("ready", function()
  ascii_panel:post("map_rows", { rows = last_ascii_rows or {} })
end)
```

- [ ] **Step 3: Add the `room.map` GMCP handler**

Immediately before the existing block (`src/main.lua:566`, the `gmcp.on('room.info', ...)` handler — find it via the `-- ─── GMCP ─── ` section comment a few lines above it):

```lua
gmcp.on('room.map', function(_, payload)
  if type(payload) ~= 'string' then return end
  last_ascii_rows = ansi_map.parse(payload)
  ascii_panel:post("map_rows", { rows = last_ascii_rows })
end)

gmcp.on('room.info', function(_, data)
```

(i.e. insert the new `gmcp.on('room.map', ...)` block right before the line `gmcp.on('room.info', function(_, data)` — do not otherwise modify the `room.info` handler that follows.)

- [ ] **Step 4: Sanity-check the file parses**

Run: `luajit -e "loadfile('src/main.lua')"`

Expected: no output on success. `loadfile` only compiles the chunk (checking for syntax errors) — it does not execute it, so the missing `mud`/`gmcp`/`settings`/`vars`/`events`/`world`/`storage` globals (only provided by the real Mallard host at runtime) will not raise an error here. If this prints a Lua syntax error, fix it before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/main.lua
git commit -m "feat: subscribe to room.map GMCP and feed the ASCII map panel"
```

---

### Task 4: ASCII map panel UI (`ui/ascii_map.html` / `.css` / `.js`)

**Files:**
- Create: `ui/ascii_map.html`
- Create: `ui/ascii_map.css`
- Create: `ui/ascii_map.js`

**Interfaces:**
- Consumes: the `"map_rows"` message posted from Task 3, shaped `{ rows: [[{char, fg, bold}, ...], ...] }` (empty array `rows: []` when there's no map for the current location). Consumes the host-injected global `window.panel` (`panel.on(name, fn)`, `panel.post(name, data)`) — no import needed, exactly as `ui/mapper.js` uses it.
- Produces: nothing consumed by later tasks (this is the leaf UI layer).

- [ ] **Step 1: Create the panel HTML**

Create `ui/ascii_map.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ASCII Map</title>
  <link rel="stylesheet" href="ascii_map.css">
</head>
<body>
  <pre id="grid"></pre>
  <div id="empty" hidden>No map for this location.</div>
  <script type="module" src="ascii_map.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the panel stylesheet**

Create `ui/ascii_map.css`:

```css
/* --bg/--fg/--fg-muted are pushed by the Mallard host as inline styles
 * on :root; the fallbacks below only apply before that happens. */
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--bg, #1a1a1a);
  color: var(--fg, #eaeaea);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.3;
  overflow: auto;
}
#grid {
  margin: 8px;
  white-space: pre;
}
#empty {
  margin: 8px;
  color: var(--fg-muted, #888);
}
```

- [ ] **Step 3: Create the panel script**

Create `ui/ascii_map.js`:

```js
const $grid  = document.getElementById("grid");
const $empty = document.getElementById("empty");

function render(rows) {
  $grid.innerHTML = "";
  if (!rows || rows.length === 0) {
    $grid.hidden = true;
    $empty.hidden = false;
    return;
  }
  $grid.hidden = false;
  $empty.hidden = true;
  for (let r = 0; r < rows.length; r++) {
    for (const cell of rows[r]) {
      if (cell.fg) {
        const span = document.createElement("span");
        span.style.color = cell.fg;
        if (cell.bold) span.style.fontWeight = "bold";
        span.textContent = cell.char;
        $grid.appendChild(span);
      } else {
        $grid.appendChild(document.createTextNode(cell.char));
      }
    }
    if (r < rows.length - 1) $grid.appendChild(document.createTextNode("\n"));
  }
}

panel.on("map_rows", (frame) => render(frame.rows || []));

// Signal readiness so Lua can push the last-known grid immediately.
panel.post("ready", {});
```

- [ ] **Step 4: Verify the JS has no syntax errors**

Run: `node --check ui/ascii_map.js`

Expected: no output (exit code 0). This only checks syntax — `panel` is a host-injected global that doesn't exist under plain Node, so this step cannot execute the file, only parse it.

- [ ] **Step 5: Commit**

```bash
git add ui/ascii_map.html ui/ascii_map.css ui/ascii_map.js
git commit -m "feat: add ASCII map panel UI"
```

---

### Task 5: Wire the new Lua test into `package.json`, document the panel

**Files:**
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `tests/ansi_map_test.lua` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the new test file to the npm scripts**

In `package.json`, change:

```json
    "test": "vitest run && lua tests/search_test.lua && lua tests/pathfind_test.lua",
    "test:js": "vitest run",
    "test:lua": "lua tests/search_test.lua && lua tests/pathfind_test.lua",
```

to:

```json
    "test": "vitest run && lua tests/search_test.lua && lua tests/pathfind_test.lua && lua tests/ansi_map_test.lua",
    "test:js": "vitest run",
    "test:lua": "lua tests/search_test.lua && lua tests/pathfind_test.lua && lua tests/ansi_map_test.lua",
```

- [ ] **Step 2: Document the panel in the README**

In `README.md`, immediately after the existing "## Map panel" section (ends at the `**World map:**` paragraph, right before the `---` that precedes "## Commands"), add:

```markdown
## ASCII Map panel

A second, independent panel shows Discworld's own live ASCII minimap —
the same colour grid the MUD can print above `look`/`glance` — fed
directly from the `room.map` GMCP frame. It updates automatically as you
move, with no per-room map data to author. Some locations (indoors,
special zones) have no map to show; the panel says so rather than
showing a stale grid.

This panel is read-only in this version: no click-to-route, no zoom.
Show or hide it like any other Mallard panel.
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: vitest suite passes, followed by `PASS:` lines from all three Lua test files (`search_test.lua`, `pathfind_test.lua`, `ansi_map_test.lua`), no `FAIL:` lines, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "docs: document the ASCII map panel; wire its test into npm scripts"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only — no code changes).

**Interfaces:** none.

- [ ] **Step 1: Build the packaged plugin**

Run: `npm run pack`

Expected: `discworld-cowtography-0.27.0.mallardx` is rebuilt (check its timestamp/size changed) and includes `plugin.toml`, `src/ansi_map.lua`, and the three new `ui/ascii_map.*` files. Spot-check with:

```bash
unzip -l discworld-cowtography-0.27.0.mallardx | grep -E "ansi_map|ascii_map"
```

Expected output lists `src/ansi_map.lua`, `ui/ascii_map.html`, `ui/ascii_map.css`, `ui/ascii_map.js`.

- [ ] **Step 2: Install/reload the plugin in Mallard**

Reload the plugin the same way you normally pick up changes to this plugin during development (reinstall the built `.mallardx`, or point Mallard at this checkout if it supports loading from source). Confirm Mallard's plugin log shows no manifest or Lua load errors for `net.mallard.discworld-cowtography`.

- [ ] **Step 3: Confirm the panel appears and can be shown**

Open Mallard's panel list/menu and confirm an "ASCII Map" panel is available, docked at the bottom by default. Show it.

- [ ] **Step 4: Confirm live data renders**

Connect to Discworld and `look` or `glance` in an outdoor room. Confirm the ASCII Map panel shows a coloured grid (e.g. your player marker `@` in bold yellow, exits in red) — compare against the shape seen in the 2026-07-10 GMCP capture used during design (`village forge`: a 2-row grid, bold-yellow `@` and red `+`).

- [ ] **Step 5: Confirm the empty state**

Move indoors or into a location known to have no map data. Confirm the panel switches to the "No map for this location." message rather than showing a stale grid.

- [ ] **Step 6: Confirm rehydration on panel reopen**

With a live grid showing, hide the ASCII Map panel, then show it again (without moving or looking). Confirm the last grid reappears immediately, without needing to `look` again — this exercises the `"ready"` → `last_ascii_rows` rehydration path from Task 3.

- [ ] **Step 7: Report back**

If any step fails, note which one and the exact behaviour observed (panel missing, blank, garbled characters, wrong colours, etc.) so the responsible task can be revisited.

---

## Self-Review Notes

- **Spec coverage:** Data source (`room.map` subscription) → Task 3. Manifest changes → Task 2. Rendering (SGR parsing, monospace panel) → Tasks 1 & 4. No-data notice → Task 4 Step 3 (`$empty` state) + Task 6 Step 5. Scope cuts (no settings, no auto-fix, no interactivity, no `room.writtenmap`) → honored throughout, restated in Global Constraints. Testing section of the spec → Task 1 (Lua unit tests) + Task 6 (manual/visual).
- **Placeholder scan:** no TBD/TODO markers; every step has literal file contents or exact commands with expected output.
- **Type consistency:** `ansi_map.parse(input) → rows` (Task 1) is consumed identically in Task 3 (`ansi_map.parse(payload)`) and the shape (`rows[r][c] = {char, fg, bold}`) matches what Task 4's `render(rows)` reads (`cell.char`/`cell.fg`/`cell.bold`). The panel message name `"map_rows"` and payload key `rows` are consistent between Task 3's `ascii_panel:post("map_rows", { rows = ... })` and Task 4's `panel.on("map_rows", (frame) => render(frame.rows || []))`.
