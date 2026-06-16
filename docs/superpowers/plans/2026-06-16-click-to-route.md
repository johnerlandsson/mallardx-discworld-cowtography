# Click-to-Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Left-click a room on the map to create and highlight a route to it; show a footer with destination name, move count, walk button, and clear (✕) button when a route is active.

**Architecture:** Three tasks in dependency order — (1) Lua: extend the `route_set` message and add `room_click`/`walk_request`/`clear_request` panel handlers; (2) HTML + CSS: add the route footer element and styles; (3) JS: overhaul pointer events to support middle-mouse panning + left-click-on-room routing, and wire the footer to panel messages.

**Tech Stack:** Lua (Mallard plugin API — `panel:post`, `panel:on_message`, `mud.send`), vanilla JS (Pointer Events API, `panel.post`, `panel.on`), HTML5, CSS3 (flexbox, CSS custom properties).

---

### Task 1: Lua — extend route_set message + panel message handlers

**Files:**
- Modify: `src/main.lua`

No automated tests exist for Lua panel message handling (requires a live game connection). Verification is manual — see Step 6.

- [ ] **Step 1: Add two new state variables at line 52**

After `local last_route   = nil` (line 52), add two more:

```lua
local last_route             = nil
local last_route_destination = nil
local last_route_steps       = nil
```

- [ ] **Step 2: Extend `post_route` to store and forward destination + steps**

Replace (lines 64–67):
```lua
local function post_route(room_ids)
  last_route = room_ids
  panel:post("route_set", { rooms = room_ids })
end
```

With:
```lua
local function post_route(room_ids, destination, steps)
  last_route             = room_ids
  last_route_destination = destination
  last_route_steps       = steps
  panel:post("route_set", { rooms = room_ids, destination = destination, steps = steps })
end
```

- [ ] **Step 3: Update the `ready` re-post to include destination and steps**

Replace (line 95):
```lua
    if last_route   then panel:post("route_set", { rooms = last_route }) end
```

With:
```lua
    if last_route then
      panel:post("route_set", { rooms = last_route, destination = last_route_destination, steps = last_route_steps })
    end
```

- [ ] **Step 4: Update the `post_route` call inside `route_to_room` (line 635)**

Replace:
```lua
  post_route(route_rooms)
```

With:
```lua
  post_route(route_rooms, display_name, steps)
```

`display_name` and `steps` are already in scope at that point — `steps` comes from `pathfind.find_path` at line 624, `display_name` is the function parameter.

- [ ] **Step 5: Add three panel message handlers after `route_to_room` closes (after line ~649)**

`route_to_room` closes with `end` just before `local function do_route`. Insert after that `end`:

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

These handlers must appear **after** the `route_to_room` function definition. Lua closures capture local variables by reference at the point the closure is created — if placed before line 614, `route_to_room` would not yet be in scope and the closure would resolve to `nil`.

- [ ] **Step 6: Verify manually in Mallard**

Restart the plugin. In game:
- Run `/db <room name>` to get results, then `/db 1` to set a route — check that the terminal still shows the normal route note and the map still highlights the route.
- Check that `/db walk` and `/db clear` still work as before.
- (Full click-to-route testing done in Task 3.)

- [ ] **Step 7: Commit**

```bash
git add src/main.lua
git commit -m "feat(click-to-route): extend route_set message + panel click/walk/clear handlers"
```

---

### Task 2: HTML + CSS — route footer

**Files:**
- Modify: `ui/mapper.html`
- Modify: `ui/mapper.css`

No automated tests. Verify visually.

- [ ] **Step 1: Add footer element to mapper.html**

In `ui/mapper.html`, add a `<footer>` immediately after the closing `</div>` of `.map-container` (currently line 31, before the `<script>` tag):

```html
  </div>
  <footer class="route-footer" hidden>
    <span class="route-dest"></span>
    <button class="route-walk" type="button">walk</button>
    <button class="route-clear" type="button">✕</button>
  </footer>
  <script type="module" src="mapper.js"></script>
```

- [ ] **Step 2: Add footer CSS to mapper.css**

Append to the end of `ui/mapper.css`:

```css
/* ─── Route footer ─────────────────────────────────────────────────────────── */
.route-footer[hidden] { display: none; }
.route-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 6px;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  flex: 0 0 auto;
}
.route-dest {
  flex: 1;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.route-walk {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  color: var(--accent);
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
}
.route-walk:hover {
  background: color-mix(in srgb, var(--accent) 25%, transparent);
}
.route-clear {
  color: var(--muted);
  font-size: 13px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
.route-clear:hover {
  color: var(--fg);
}
```

The `body` element already uses `display: flex; flex-direction: column`. `.map-container` has `flex: 1 1 auto` so it fills remaining height. The footer's `flex: 0 0 auto` pins it to a fixed height below the map with no overlap.

- [ ] **Step 3: Verify visually**

Open `ui/mapper.html` in a browser (or reload the Mallard panel). The footer should be invisible (hidden). To spot-check the styles, temporarily remove the `hidden` attribute from the `<footer>` in DevTools — the footer should appear below the map at 24px height, matching the header. The walk button should use the green accent colour; the ✕ should be muted and borderless. Re-add `hidden` after checking.

- [ ] **Step 4: Commit**

```bash
git add ui/mapper.html ui/mapper.css
git commit -m "feat(click-to-route): add route footer element and styles"
```

---

### Task 3: JS — pointer event overhaul + footer wiring

**Files:**
- Modify: `ui/mapper.js`

No automated tests (panel JS requires the Mallard host environment). Verification is manual — see Step 5.

- [ ] **Step 1: Add DOM refs for the footer elements**

In `ui/mapper.js`, in the `─── DOM refs ───` section (lines 7–15), add three new refs after `$zoomOut`:

```js
const $footer     = document.querySelector(".route-footer");
const $routeDest  = document.querySelector(".route-dest");
const $routeWalk  = document.querySelector(".route-walk");
const $routeClear = document.querySelector(".route-clear");
```

- [ ] **Step 2: Add `pendingRoomClick` state variable**

In the `─── State ───` section (after line 39 where `drag` is declared), add:

```js
let drag              = null;  // { screenX, screenY, vbX, vbY } | null
let pendingRoomClick  = null;  // { el, startX, startY } | null — candidate left-click on a room
```

(Replace the existing `let drag = null;` line with both lines above.)

- [ ] **Step 3: Replace the drag pan listeners with the new pointer event handlers**

Find and replace the entire `─── Drag pan ───` section (lines 453–467):

```js
// ─── Drag pan ─────────────────────────────────────────────────────────────
$container.addEventListener("pointerdown", (e) => {
  if (!currentSvg || e.target.closest(".room")) return;
  drag = { screenX: e.clientX, screenY: e.clientY, vbX: viewBox.x, vbY: viewBox.y };
  $container.setPointerCapture(e.pointerId);
});
$container.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const rect = $container.getBoundingClientRect();
  viewBox.x  = drag.vbX - (e.clientX - drag.screenX) / rect.width  * viewBox.w;
  viewBox.y  = drag.vbY - (e.clientY - drag.screenY) / rect.height * viewBox.h;
  applyViewBox();
});
$container.addEventListener("pointerup",     () => { drag = null; });
$container.addEventListener("pointercancel", () => { drag = null; });
```

Replace with:

```js
// ─── Pointer events: pan + click-to-route ─────────────────────────────────
// Middle mouse: pan anywhere.
// Left mouse on empty space: pan.
// Left click on a room (< 4px movement): route to that room.
$container.addEventListener("pointerdown", (e) => {
  if (!currentSvg) return;
  const roomEl = e.target.closest(".room");
  if (e.button === 1) {
    e.preventDefault();  // suppress browser autoscroll cursor
    drag = { screenX: e.clientX, screenY: e.clientY, vbX: viewBox.x, vbY: viewBox.y };
    $container.setPointerCapture(e.pointerId);
  } else if (e.button === 0 && !roomEl) {
    drag = { screenX: e.clientX, screenY: e.clientY, vbX: viewBox.x, vbY: viewBox.y };
    $container.setPointerCapture(e.pointerId);
  } else if (e.button === 0 && roomEl) {
    pendingRoomClick = { el: roomEl, startX: e.clientX, startY: e.clientY };
    $container.setPointerCapture(e.pointerId);
  }
});
$container.addEventListener("pointermove", (e) => {
  if (drag) {
    const rect = $container.getBoundingClientRect();
    viewBox.x  = drag.vbX - (e.clientX - drag.screenX) / rect.width  * viewBox.w;
    viewBox.y  = drag.vbY - (e.clientY - drag.screenY) / rect.height * viewBox.h;
    applyViewBox();
  } else if (pendingRoomClick) {
    const dx = e.clientX - pendingRoomClick.startX;
    const dy = e.clientY - pendingRoomClick.startY;
    if (Math.hypot(dx, dy) > 4) pendingRoomClick = null;
  }
});
$container.addEventListener("pointerup", () => {
  if (pendingRoomClick) {
    const el = pendingRoomClick.el;
    const roomId = el.id.slice(5);        // strip "room-" prefix
    const name   = el.dataset.label ?? "";
    panel.post("room_click", { id: roomId, name });
  }
  drag = null;
  pendingRoomClick = null;
});
$container.addEventListener("pointercancel", () => {
  drag = null;
  pendingRoomClick = null;
});
```

- [ ] **Step 4: Wire the footer to route_set / route_clear**

Find the existing `route_set` and `route_clear` handlers (lines 527–535):

```js
panel.on("route_set", (frame) => {
  routeRoomIds = Array.isArray(frame.rooms) ? frame.rooms : [];
  applyState();
});

panel.on("route_clear", () => {
  routeRoomIds = [];
  applyState();
});
```

Replace with:

```js
panel.on("route_set", (frame) => {
  routeRoomIds = Array.isArray(frame.rooms) ? frame.rooms : [];
  applyState();
  if (frame.destination) {
    const s = frame.steps ?? routeRoomIds.length;
    $routeDest.textContent = `→ ${frame.destination} (${s} move${s === 1 ? '' : 's'})`;
    $footer.hidden = false;
  }
});

panel.on("route_clear", () => {
  routeRoomIds = [];
  applyState();
  $footer.hidden = true;
});
```

Also add the button click handlers. Place them after the `$zoomOut` listener (after line 437) or grouped with the other button listeners — either location works. Add after the zoom button listeners:

```js
$routeWalk.addEventListener("click",  () => { panel.post("walk_request",  {}); });
$routeClear.addEventListener("click", () => { panel.post("clear_request", {}); });
```

- [ ] **Step 5: Verify manually in Mallard**

Restart the plugin and test:

1. **Middle mouse pan**: Hold middle mouse and drag on the map — should pan smoothly. No room routes should fire.
2. **Left drag on empty space**: Hold left mouse on empty map area and drag — should pan as before.
3. **Left click on a room**: Single left-click on a room — should set a route (highlighted rooms + edges), and the footer should appear below the map showing `→ <Room Name> (N moves)`.
4. **Replace route**: With a route active, left-click a different room — route should update silently and the footer destination should change.
5. **Walk button**: Click `walk` in the footer — walking should begin and the terminal should show the walking note.
6. **Clear button**: Click `✕` in the footer — route highlight disappears and footer hides.
7. **Footer hides on arrival**: Walk to the destination — footer should hide automatically when `walk_arrived` fires (which calls `post_route_clear`).
8. **Panel reload**: With an active route, close and reopen the panel — footer should rehydrate with the correct destination name and step count.
9. **Tooltip still works**: Hover rooms — tooltip should still appear.
10. **Zoom still works**: Scroll and zoom buttons — unchanged.

- [ ] **Step 6: Commit**

```bash
git add ui/mapper.js
git commit -m "feat(click-to-route): pointer event overhaul + footer wiring"
```
