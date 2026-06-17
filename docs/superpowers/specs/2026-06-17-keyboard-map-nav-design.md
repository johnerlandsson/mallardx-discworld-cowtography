# Keyboard Map Navigation Design

## Goal

Add `/pan` and `/zoom` client commands with default `Alt+arrow` / `Alt+±` / `Alt+0` hotkeys so the map can be navigated without touching the mouse, while the MUD input box retains focus.

## Architecture

Two new `mud.command` entries in Lua post panel messages to the mapper webview. Seven `keymap.bind()` calls register default hotkeys at plugin startup. The JS side handles the pan/zoom arithmetic and calls `applyViewBox()`.

`/ocd` (re-centre) already exists as a command and already posts to the panel; it only needs a `keymap.bind` call added.

## Hotkeys

| Key | Action |
|-----|--------|
| `Alt+Up` | pan north |
| `Alt+Down` | pan south |
| `Alt+Left` | pan west |
| `Alt+Right` | pan east |
| `Alt+=` | zoom in |
| `Alt+-` | zoom out |
| `Alt+0` | re-centre (`/ocd`) |

All use `keymap.bind()` (plugin-level keymaps). These fire while the MUD input box has focus. No Mallard reservations on any of these combos.

**Why not Ctrl:** `Ctrl+Left/Right` move the cursor word-by-word in the MUD input. `Ctrl+=/-` are reserved by Mallard for future UI scaling. `Alt` avoids all of these conflicts. Some Linux window managers claim `Alt+arrows`, but that is a user config concern.

**Upcoming Mallard change:** The Mallard maintainer is adding a Lua surface for plugin keymaps today, with plugin bindings showing up in `/commands` for discoverability. When that lands, these `keymap.bind()` calls will automatically benefit without any changes needed on the cowtography side.

## Commands

### `/pan <direction>`

- **Directions:** `n`, `s`, `e`, `w` (also accept `north`, `south`, `east`, `west`)
- **Step size:** 20% of the current viewBox dimension per keypress
  - Pan east/west: `viewBox.x ± viewBox.w * 0.2`
  - Pan north/south: `viewBox.y ± viewBox.h * 0.2`
- **Panel message:** `panel:post("pan", { dir = "n" })`
- **No-op** when no map is displayed (JS side guards on `currentSvg`)

### `/zoom <direction>`

- **Directions:** `in`, `out`
- **Factor:** `ZOOM_FACTOR = 1.3` — matches existing +/− buttons and mouse wheel
  - Zoom in: `viewBox.w /= 1.3; viewBox.h /= 1.3`
  - Zoom out: `viewBox.w *= 1.3; viewBox.h *= 1.3`
- **Panel message:** `panel:post("zoom", { dir = "in" })`
- **No-op** when no map is displayed

## Data Flow

```
keypress (Alt+Up)
  → keymap.bind callback (Lua, runs immediately)
  → mud.run_command("pan n")
  → mud.command("pan") handler receives m = { args = {"n"} }
  → panel:post("pan", { dir = "n" })
  → mapper.js panel.on("pan", frame)
  → viewBox.x -= viewBox.w * 0.2; applyViewBox()
```

## Files Changed

- **`src/main.lua`**
  - Add `mud.command("pan", ...)` — parses direction arg, posts `"pan"` to panel
  - Add `mud.command("zoom", ...)` — parses in/out arg, posts `"zoom"` to panel
  - Add 7 `keymap.bind()` calls after panel setup (where `keymap.bind` has access to the panel handle)

- **`ui/mapper.js`**
  - Add `panel.on("pan", frame)` handler — adjusts `viewBox.x`/`viewBox.y`, calls `applyViewBox()`
  - Add `panel.on("zoom", frame)` handler — adjusts `viewBox.w`/`viewBox.h`, calls `applyViewBox()`
