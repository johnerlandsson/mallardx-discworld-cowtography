# Keyboard Map Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/pan` and `/zoom` client commands with `Alt+arrow` / `Alt+±` / `Alt+0` default hotkeys so the map panel can be panned and zoomed from the keyboard without leaving the MUD input box.

**Architecture:** Two new `mud.command` entries in `src/main.lua` post panel messages (`"pan"` / `"zoom"`) to the mapper webview. Seven `keymap.bind()` calls at the bottom of `src/main.lua` register the default hotkeys — each callback posts directly to `panel` (the module-level `mud.panel("map")` handle). The JS side in `ui/mapper.js` adds `panel.on("pan", ...)` and `panel.on("zoom", ...)` handlers that adjust `viewBox` and call the existing `applyViewBox()`.

**Tech Stack:** Lua (`mud.command`, `keymap.bind`, `panel:post`), JavaScript (`panel.on`, `viewBox`, `applyViewBox`)

---

## File Map

- **Modify:** `src/main.lua` — add `/pan` command (line ~880, after `/ocd`), add `/zoom` command, add 7 `keymap.bind` calls at end of file
- **Modify:** `ui/mapper.js` — add `panel.on("pan", ...)` and `panel.on("zoom", ...)` before the final `panel.post("ready", {})` call (line 703)

---

### Task 1: Add `panel.on("pan", ...)` handler in mapper.js

**Files:**
- Modify: `ui/mapper.js` (before line 703: `panel.post("ready", {})`)

Context: `viewBox` is a module-level object `{ x, y, w, h }`. `applyViewBox()` writes it to the SVG's `viewBox` attribute and persists zoom. `currentSvg` is `null` when no map is displayed — guard against that. Pan step is 20% of the current viewBox dimension.

- [ ] **Step 1: Add the pan handler**

Insert before `panel.post("ready", {});` at line 703:

```javascript
panel.on("pan", (frame) => {
  if (!currentSvg) return;
  const step = 0.2;
  if      (frame.dir === "n") viewBox.y -= viewBox.h * step;
  else if (frame.dir === "s") viewBox.y += viewBox.h * step;
  else if (frame.dir === "w") viewBox.x -= viewBox.w * step;
  else if (frame.dir === "e") viewBox.x += viewBox.w * step;
  applyViewBox();
});

panel.on("zoom", (frame) => {
  if (!currentSvg) return;
  const factor = frame.dir === "in" ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
  const newW = viewBox.w * factor;
  const newH = viewBox.h * factor;
  viewBox.x += 0.5 * (viewBox.w - newW);
  viewBox.y += 0.5 * (viewBox.h - newH);
  viewBox.w  = newW;
  viewBox.h  = newH;
  applyViewBox();
});
```

- [ ] **Step 2: Verify the file looks right**

Run: `grep -n "panel\.on" ui/mapper.js`

Expected: `panel.on("pan", ...)` and `panel.on("zoom", ...)` appear before `panel.post("ready", {})`.

- [ ] **Step 3: Commit**

```bash
git add ui/mapper.js
git commit -m "feat(map-nav): add panel.on handlers for pan and zoom"
```

---

### Task 2: Add `/pan` command in main.lua

**Files:**
- Modify: `src/main.lua` (after the `/ocd` block, around line 880)

Context: `mud.command("ocd", ...)` ends around line 878. `panel` is the module-level `mud.panel("map")` handle — it's accessible from closures throughout the file. `m.args` is the raw argument string after the command name (e.g. for `/pan n`, `m.args` is `"n"`). The command handler must accept `north`/`south`/`east`/`west` as well as `n`/`s`/`e`/`w`. Post `"pan"` with `{ dir = "n" }` etc.

- [ ] **Step 1: Add the `/pan` command after the `/ocd` block**

```lua
-- ─── pan ─────────────────────────────────────────────────────────────────────
-- Shift the map view without touching the mouse.

mud.command("pan", function(m)
  local dir_map = {
    n = "n", north = "n",
    s = "s", south = "s",
    e = "e", east  = "e",
    w = "w", west  = "w",
  }
  local dir = dir_map[m.args:lower()]
  if not dir then
    note('  Usage: /pan n|s|e|w', C.err)
    return
  end
  panel:post("pan", { dir = dir })
end, {
  description = "Pan the map view north, south, east, or west.",
  usage       = "pan <n|s|e|w>",
})
```

- [ ] **Step 2: Verify it was inserted correctly**

Run: `grep -n "mud\.command\|─── pan" src/main.lua`

Expected: a `─── pan` comment and `mud.command("pan", ...)` appear between `ocd` and `libclear`.

- [ ] **Step 3: Commit**

```bash
git add src/main.lua
git commit -m "feat(map-nav): add /pan command"
```

---

### Task 3: Add `/zoom` command in main.lua

**Files:**
- Modify: `src/main.lua` (after the `/pan` block added in Task 2)

Context: Same as Task 2. Post `"zoom"` with `{ dir = "in" }` or `{ dir = "out" }`. The JS zoom handler centres the zoom on the current viewport midpoint (matching wheel behaviour).

- [ ] **Step 1: Add the `/zoom` command after `/pan`**

```lua
-- ─── zoom ────────────────────────────────────────────────────────────────────
-- Zoom the map view in or out.

mud.command("zoom", function(m)
  local arg = m.args:lower()
  if arg ~= "in" and arg ~= "out" then
    note('  Usage: /zoom in|out', C.err)
    return
  end
  panel:post("zoom", { dir = arg })
end, {
  description = "Zoom the map view in or out.",
  usage       = "zoom <in|out>",
})
```

- [ ] **Step 2: Verify**

Run: `grep -n "mud\.command\|─── zoom" src/main.lua`

Expected: `─── zoom` and `mud.command("zoom", ...)` appear after the `pan` block.

- [ ] **Step 3: Commit**

```bash
git add src/main.lua
git commit -m "feat(map-nav): add /zoom command"
```

---

### Task 4: Register default hotkeys with keymap.bind

**Files:**
- Modify: `src/main.lua` (end of file, after all `mud.command` blocks)

Context: `keymap.bind(combo, fn)` registers a plugin-level hotkey. The callback fires immediately when the key is pressed — even while the MUD input box has focus, because modifier combos always fire. `panel` is the module-level handle; it's in scope here. The Mallard maintainer has confirmed `Alt+arrows`, `Alt+=`, `Alt+-`, `Alt+0` are all free (no Mallard reservations). `Ctrl+arrows` and `Ctrl+±` are taken by Mallard's input and future UX scaling.

- [ ] **Step 1: Add the keymap.bind block at the end of main.lua**

```lua
-- ─── keyboard map navigation ─────────────────────────────────────────────────
-- Alt+arrows → pan, Alt+=/- → zoom, Alt+0 → re-centre.
-- Uses keymap.bind (plugin-level keymaps). Will appear in /commands once
-- Mallard's upcoming Lua keymap surface lands.

keymap.bind("Alt+Up",    function() panel:post("pan",  { dir = "n" }) end)
keymap.bind("Alt+Down",  function() panel:post("pan",  { dir = "s" }) end)
keymap.bind("Alt+Left",  function() panel:post("pan",  { dir = "w" }) end)
keymap.bind("Alt+Right", function() panel:post("pan",  { dir = "e" }) end)
keymap.bind("Alt+=",     function() panel:post("zoom", { dir = "in"  }) end)
keymap.bind("Alt+-",     function() panel:post("zoom", { dir = "out" }) end)
keymap.bind("Alt+0",     function()
  if last_payload then post_room(last_payload) end
end)
```

Note: `Alt+0` re-centres exactly like `/ocd` does (calls `post_room(last_payload)`). We call it directly here rather than dispatching the `/ocd` command because there's no `mud.run_command` in the Lua API — calling the panel post directly is the correct approach.

- [ ] **Step 2: Verify all seven bindings are present**

Run: `grep -n "keymap\.bind" src/main.lua`

Expected: exactly 7 lines with `keymap.bind`.

- [ ] **Step 3: Commit**

```bash
git add src/main.lua
git commit -m "feat(map-nav): bind Alt+arrows/±/0 hotkeys for pan, zoom, re-centre"
```

---

### Task 5: Smoke-test the full feature in Mallard

This is a manual verification task. No automated tests exist for Lua↔panel integration.

- [ ] **Step 1: Launch Mallard with the plugin loaded and connect to Discworld**

- [ ] **Step 2: Test `/pan` command**

Type `/pan n` in the MUD input. Expected: map shifts north (SVG viewBox moves up — rooms appear lower on screen).
Repeat for `/pan s`, `/pan e`, `/pan w`. All four directions should work.

- [ ] **Step 3: Test `/pan` with full words**

Type `/pan north`. Expected: same result as `/pan n`.

- [ ] **Step 4: Test `/pan` error case**

Type `/pan x`. Expected: `Usage: /pan n|s|e|w` printed in red.

- [ ] **Step 5: Test `/zoom` command**

Type `/zoom in`. Expected: map zooms in (rooms appear larger). Type `/zoom out`. Expected: map zooms out. Verify it matches the behaviour of the +/− buttons in the map header.

- [ ] **Step 6: Test `/zoom` error case**

Type `/zoom sideways`. Expected: `Usage: /zoom in|out` printed in red.

- [ ] **Step 7: Test Alt+arrow hotkeys**

Press `Alt+Up` while MUD input has focus. Expected: map pans north — same as `/pan n`.
Repeat for `Alt+Down`, `Alt+Left`, `Alt+Right`.

- [ ] **Step 8: Test Alt+= and Alt+-**

Press `Alt+=`. Expected: zoom in. Press `Alt+-`. Expected: zoom out.

- [ ] **Step 9: Test Alt+0 re-centre**

Walk to a new room so the map moves. Press `Alt+0`. Expected: map re-centres on current position.

- [ ] **Step 10: Test no-op when no map is displayed**

Navigate somewhere that shows a special screen (darkness, lspace). Press `Alt+Up`. Expected: no crash, no error.

- [ ] **Step 11: Commit if everything passes**

```bash
git add -p  # confirm no stray changes
git commit -m "feat(map-nav): keyboard pan/zoom — smoke tested"
```
