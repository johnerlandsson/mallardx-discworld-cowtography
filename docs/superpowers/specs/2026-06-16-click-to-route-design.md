# Click-to-Route Design

## Overview

Add click-to-route to the map panel: left-clicking a room sets (or silently replaces) the active route to that room. Route action controls appear in a footer below the map when a route is active.

Pan is also improved: middle mouse drag pans anywhere; left drag from empty space is the fallback. This frees left-click on room elements for route selection.

---

## Interaction Model

| Input | Behaviour |
|---|---|
| Left click on room (< 4px movement) | Set route to that room |
| Left click on room (≥ 4px movement) | Cancelled — does nothing |
| Left drag from empty space | Pan |
| Middle drag anywhere | Pan |
| Scroll wheel | Zoom (unchanged) |
| Hover | Tooltip (unchanged) |

Clicking a room while a route is already active silently replaces it.

**State machine in `mapper.js`:**
- `drag` — active pan: `{ screenX, screenY, vbX, vbY }`
- `pendingRoomClick` — candidate room click: `{ el, startX, startY }`

`pointerdown`:
- Middle mouse (`e.button === 1`) → start drag, capture pointer
- Left on empty space → start drag, capture pointer
- Left on room element → set `pendingRoomClick`, capture pointer

`pointermove`:
- If `drag` → pan as before
- If `pendingRoomClick` and movement > 4px → cancel (`pendingRoomClick = null`)

`pointerup`:
- If `pendingRoomClick` is set → fire route click (post `room_click` to Lua)
- Clear both `drag` and `pendingRoomClick`

`pointercancel` → clear both.

Middle mouse `pointerdown` needs `e.preventDefault()` to suppress the browser's autoscroll cursor.

Room element identification: `el.id.slice(5)` strips the `room-` prefix to get the room ID. Display name comes from `el.dataset.label` (already populated for tooltips).

---

## Data Flow

### Set route from click

```
JS: user left-clicks room "room-12345" (data-label = "The Drum")
  → panel.post("room_click", { id: "12345", name: "The Drum" })

Lua: panel:on_message("room_click", fn)
  → route_to_room("12345", "The Drum", false)
  → pathfind.find_path(exits, current_room, "12345")
  → post_route(route_rooms, "The Drum", steps)
  → panel:post("route_set", { rooms, destination, steps })

JS: panel.on("route_set", frame)
  → routeRoomIds = frame.rooms; applyState()
  → show footer: "→ The Drum (12 moves)"
```

### Walk

```
JS: user clicks walk button
  → panel.post("walk_request", {})

Lua: panel:on_message("walk_request", fn)
  → same logic as `db walk`
  → begins walking, notes to terminal
  (arrival clears route via existing walk_arrived → post_route_clear path)
```

### Clear

```
JS: user clicks ✕ button
  → panel.post("clear_request", {})

Lua: panel:on_message("clear_request", fn)
  → same logic as `db clear`
  → post_route_clear()
  → panel:post("route_clear", {})

JS: panel.on("route_clear")
  → routeRoomIds = []; applyState()
  → hide footer
```

### Panel reload (ready re-post)

`last_route`, `last_route_destination`, and `last_route_steps` are stored in Lua so the footer rehydrates correctly when the panel reloads. The `ready` handler re-posts `route_set` with all three fields.

---

## Footer UI

Added to `mapper.html` below `.map-container`:

```html
<footer class="route-footer" hidden>
  <span class="route-dest"></span>
  <button class="route-walk">walk</button>
  <button class="route-clear">✕</button>
</footer>
```

`.route-dest` is populated with `→ ${destination} (${steps} move${steps === 1 ? '' : 's'})`.

The footer is `hidden` by default. It is shown when `route_set` is received, hidden when `route_clear` is received. The panel layout is `display: flex; flex-direction: column` so the footer sits below the map without overlap and the map container shrinks to fit.

CSS (`mapper.css`):

```css
.route-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  background: var(--bg-header, #0f0f0f);
  border-top: 1px solid #2a2a2a;
  flex-shrink: 0;
}
.route-dest {
  flex: 1;
  color: #888;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.route-walk {
  background: #1a3a1a;
  border: 1px solid #2a6a2a;
  color: #4ade80;
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 10px;
  cursor: pointer;
}
.route-clear {
  color: #555;
  font-size: 12px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 2px;
}
```

---

## Lua Changes

### `post_route` — extended signature

```lua
local last_route_destination = nil
local last_route_steps       = nil

local function post_route(room_ids, destination, steps)
  last_route             = room_ids
  last_route_destination = destination
  last_route_steps       = steps
  panel:post("route_set", { rooms = room_ids, destination = destination, steps = steps })
end
```

All existing call sites (`route_to_room` at line 635, bookmark walk at line 802) pass `destination` and `steps`. The `ready` re-post at line 95 is updated to include these fields.

### New message handlers

```lua
panel:on_message("room_click", function(frame)
  route_to_room(frame.id, frame.name, false)
end)

panel:on_message("walk_request", function(_frame)
  if #walk_steps == 0 or walk_pos > 0 then return end
  walk_pos = 1
  note(string.format('  Walking to "%s" — %d move%s.',
    walk_target_name, #walk_steps, #walk_steps == 1 and '' or 's'), C.ok)
  mud.send(walk_steps[1])
end)

panel:on_message("clear_request", function(_frame)
  walk_steps       = {}
  walk_pos         = 0
  walk_target_name = ''
  post_route_clear()
  note('  Route cleared.', C.muted)
end)
```

---

## Files Changed

| File | Change |
|---|---|
| `ui/mapper.js` | Overhaul drag/click handlers; add `pendingRoomClick`; wire `room_click` post; update `route_set` handler for footer; add walk/clear posts |
| `ui/mapper.html` | Add `<footer class="route-footer">` |
| `ui/mapper.css` | Add footer styles |
| `src/main.lua` | Extend `post_route`; add `room_click`, `walk_request`, `clear_request` handlers; update ready re-post |
