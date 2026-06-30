# PNG / SVG Map Style Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plugin setting that switches between SVG vector maps and classic PNG pixel-art maps from Quow's Cow Bar, with a clean renderer interface so `mapper.js` never touches renderer internals.

**Architecture:** Extract SVG rendering into `ui/svg-renderer.js`, write PNG rendering in `ui/png-renderer.js`, reduce `mapper.js` to a thin coordinator that holds all state, handles all `panel.on(...)` events, and delegates rendering to whichever renderer is currently active. Both renderers implement an identical interface.

**Tech Stack:** Vanilla JS ES modules, HTML5 Canvas (PNG overlay), Mallard `settings` API.

## Global Constraints

- All JS is ES modules (`import`/`export`), no build step, no new dependencies.
- Existing tests must continue passing (`npm test`).
- The SVG renderer must behave identically to the current `mapper.js` SVG logic — zero regressions.
- PNG files live at `ui/maps/<name>.png`; `discwhole.png` is already there.
- Pack script unchanged — it already includes `ui/maps/*.png`.
- Implementation goes on branch `feat/png-svg-map-style`, not `main`.
- `plugin.toml` `minimum_app_version` stays at `0.11.0`.
- Room data format in `ui/data/rooms.js`: `{ roomId: [map_id, xpos, ypos, room_short] }` — index 0 is `map_id`, index 1 is `xpos`, index 2 is `ypos`, index 3 is the short room name.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `ui/svg-renderer.js` | Create | SvgRenderer class — all SVG-specific rendering, zoom, pan, keyboard, tooltips, library overlay |
| `ui/png-renderer.js` | Create | PngRenderer class + pure `findNearestRoom` export — PNG loading, canvas overlay dots, click-to-room |
| `ui/mapper.js` | Modify | Coordinator only: state, panel events, renderer lifecycle, conditional UI wiring |
| `scripts/png-renderer.test.mjs` | Create | Unit tests for `findNearestRoom` pure function |
| `plugin.toml` | Modify | Add `[settings.map_style]` enum |
| `src/main.lua` | Modify | Post `map_style` on ready; handle live change in `settings.on` |

---

## Renderer Interface

Both renderers implement this contract. The coordinator depends only on this interface.

```js
class SvgRenderer /* or PngRenderer */ {
  supportsZoom:    boolean  // true for SVG, false for PNG
  supportsFilters: boolean  // true for SVG, false for PNG

  constructor($container, data, callbacks, savedZoom)
  // $container: <div class="map-container">
  // data: { rooms, maps, terrain } — rooms format: { id: [map_id, xpos, ypos, short] }
  // callbacks: { onRoomClick(roomId, name), onMapLoaded(mapId), onPersistZoom(mapId, w) }
  // savedZoom: shared Map<mapId, viewBoxW> — SVG renderer reads/writes, PNG ignores

  async load(mapId, centerX, centerY)   // mount and display map; call onMapLoaded(mapId) at end
  applyState(state)                     // state: { current, target, routeRoomIds, darkMode, libraryOverlay }
  handleResize()                        // noop for SVG; canvas resize for PNG
  destroy()                             // remove DOM + event listeners; stop animations

  // Optional — SVG only; coordinator calls with ?. so PngRenderer can omit these:
  centerOn(x, y)
  zoomIn()
  zoomOut()
  pan(dir)                  // dir: 'n' | 's' | 'e' | 'w'
  zoom(dir)                 // dir: 'in' | 'out'
  grabFocus()
  releaseFocus()
  findRoomByLabel(name, mapId)          // returns { mapId, x, y, short } or null
  applyLibraryPosition(x, y)           // highlight lib room + center
}
```

---

### Task 1: Feature branch + PNG asset copy

**Files:**
- Create: `ui/maps/*.png` (65 files copied from `claude_resources/quow_cowbar/maps/`)

**Interfaces:**
- Produces: feature branch `feat/png-svg-map-style`; all PNG map files in `ui/maps/`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/png-svg-map-style
```

Expected: "Switched to a new branch 'feat/png-svg-map-style'"

- [ ] **Step 2: Copy PNG files**

Copy all PNGs from the reference directory except `layout_turtle.png` (a UI sprite, not a map) and `discwhole.png` (already present):

```bash
for f in claude_resources/quow_cowbar/maps/*.png; do
  name=$(basename "$f")
  if [ "$name" != "layout_turtle.png" ] && [ "$name" != "discwhole.png" ]; then
    cp "$f" ui/maps/"$name"
  fi
done
```

- [ ] **Step 3: Verify count**

```bash
ls ui/maps/*.png | wc -l
```

Expected: `66` (65 copied + 1 existing `discwhole.png`)

- [ ] **Step 4: Run tests to verify no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add ui/maps/*.png
git commit -m "feat(png-maps): copy Quow PNG map assets to ui/maps"
```

---

### Task 2: SvgRenderer class (`ui/svg-renderer.js`)

**Files:**
- Create: `ui/svg-renderer.js`
- Modify: `ui/mapper.js` (add import; no other changes yet)

**Interfaces:**
- Produces: `SvgRenderer` class (full interface above) exported from `ui/svg-renderer.js`
- The constructor wires all event listeners; `destroy()` removes them.
- `load()` calls `callbacks.onMapLoaded(mapId)` after mount.
- `applyState()` accepts `{ current, target, routeRoomIds, darkMode, libraryOverlay }`.

- [ ] **Step 1: Run tests to confirm baseline**

```bash
npm test
```

Expected: all pass. This is your baseline — if they fail after you write the class, you introduced a regression.

- [ ] **Step 2: Create `ui/svg-renderer.js`**

The class is extracted from `mapper.js`. All SVG-specific state becomes private fields. Event listeners are stored as bound methods so `destroy()` can remove them.

```js
import { upperToGround, groundToUppers } from "./data/room-stacks.js";

const ROOM_TYPE_LABELS = {
  shop: 'General shop', weapon: 'Weapon shop', armour: 'Armour shop',
  clothes: 'Clothing shop', food: 'Food shop', access: 'Accessories shop',
  bank: 'Bank', changer: 'Money changer', mission: 'Mission office',
  post: 'Post office', lang: 'Language school', temple: 'Temple',
  crafts: 'Crafts shop', house: 'Player house', club: 'Player club',
  pshop: 'Player shop', tshop: 'Travelling shop', talker: 'Talker shop',
  tavern: 'Tavern / Restaurant', pub: 'Pub / Bar',
};

const ORB_RADIUS = {
  "tiny speck": 3, "small point": 5, "moderately-sized ball": 7,
  "large orb": 9, "substantial sphere": 12,
};

const ZOOM_FACTOR = 1.3;
const TARGET_PX   = 30;

function computeRoomUnit(svgEl) {
  const pts = [];
  for (const el of svgEl.querySelectorAll('.room')) {
    if (el.tagName.toLowerCase() === 'circle') {
      pts.push([+el.getAttribute('cx'), +el.getAttribute('cy')]);
    } else {
      const x = +el.getAttribute('x'), w = +el.getAttribute('width');
      pts.push([x + w / 2, +el.getAttribute('y') + w / 2]);
    }
  }
  if (pts.length < 2) return null;
  pts.sort((a, b) => a[0] - b[0]);
  const dists = [];
  for (let i = 0; i < pts.length; i++) {
    let best = Infinity;
    for (let j = i - 1; j >= 0 && pts[i][0] - pts[j][0] < best; j--) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < best) best = d;
    }
    for (let j = i + 1; j < pts.length && pts[j][0] - pts[i][0] < best; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < best) best = d;
    }
    if (best < Infinity) dists.push(best);
  }
  dists.sort((a, b) => a - b);
  return dists[Math.floor(dists.length / 2)];
}

function ensureWarpDefs(svgEl) {
  if (svgEl.querySelector('#warp-arrow')) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML =
    '<marker id="warp-arrow" viewBox="0 0 6 6" markerWidth="6.48" markerHeight="6.48"' +
    ' refX="6" refY="3" orient="auto-start-reverse" markerUnits="userSpaceOnUse">' +
    '<path d="M0,0 L6,3 L0,6 Z" fill="#a855f7"/></marker>';
  svgEl.prepend(defs);
}

// WeakMaps for overlay element tracking — module-level so they survive across load() calls.
const _origParent  = new WeakMap();
const _origNextSib = new WeakMap();

function _ensureOverlay(svg, id) {
  let g = svg.querySelector(`#${id}`);
  if (!g) {
    g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.id = id;
    svg.appendChild(g);
  }
  return g;
}

function _lift(el, overlay) {
  if (!el) return;
  if (!_origParent.has(el)) {
    _origParent.set(el, el.parentNode);
    _origNextSib.set(el, el.nextSibling);
  }
  overlay.appendChild(el);
}

function _restoreOverlay(overlay) {
  for (const el of [...overlay.children].reverse()) {
    const p   = _origParent.get(el);
    const sib = _origNextSib.get(el);
    if (p) {
      if (sib && sib.parentNode === p) p.insertBefore(el, sib);
      else p.appendChild(el);
    }
    _origParent.delete(el);
    _origNextSib.delete(el);
  }
}

export class SvgRenderer {
  supportsZoom    = true;
  supportsFilters = true;

  #container;
  #data;
  #callbacks;
  #savedZoom;

  #svg            = null;
  #displayedMapId = null;
  #viewBox        = { x: 0, y: 0, w: 0, h: 0 };
  #drag           = null;
  #pendingClick   = null;
  #loadGeneration = 0;
  #tshopAnim      = null;
  #tshopCanvas    = null;
  #currentStackGround = null;
  #roomUnits      = new Map();
  #mapFocused     = false;

  // Bound event handler references for removeEventListener
  #onWheel;
  #onPointerdown;
  #onPointermove;
  #onPointerup;
  #onPointercancel;
  #onContainerClick;
  #onKeydown;
  #onBlur;

  constructor($container, data, callbacks, savedZoom) {
    this.#container  = $container;
    this.#data       = data;
    this.#callbacks  = callbacks;
    this.#savedZoom  = savedZoom;

    this.#onWheel          = this.#handleWheel.bind(this);
    this.#onPointerdown    = this.#handlePointerdown.bind(this);
    this.#onPointermove    = this.#handlePointermove.bind(this);
    this.#onPointerup      = this.#handlePointerup.bind(this);
    this.#onPointercancel  = this.#handlePointercancel.bind(this);
    this.#onContainerClick = this.#handleContainerClick.bind(this);
    this.#onKeydown        = this.#handleKeydown.bind(this);
    this.#onBlur           = this.releaseFocus.bind(this);

    $container.addEventListener("wheel",        this.#onWheel, { passive: false });
    $container.addEventListener("pointerdown",  this.#onPointerdown);
    $container.addEventListener("pointermove",  this.#onPointermove);
    $container.addEventListener("pointerup",    this.#onPointerup);
    $container.addEventListener("pointercancel",this.#onPointercancel);
    $container.addEventListener("click",        this.#onContainerClick);
    window.addEventListener("keydown",          this.#onKeydown);
    window.addEventListener("blur",             this.#onBlur);
  }

  async load(mapId, centerX, centerY) {
    const meta = this.#data.maps[mapId];
    if (!meta) return;
    const gen = ++this.#loadGeneration;
    const { default: svgText } = await import(`./maps/${meta.file.replace(/\.\w+$/, ".js")}`);
    if (gen !== this.#loadGeneration) return;

    this.#stopTshopAnim();
    this.#svg = null;
    this.#currentStackGround = null;
    // Remove previous renderer content, preserve coordinator-owned overlays
    for (const child of [...this.#container.children]) {
      if (!child.classList.contains("lspace-overlay") &&
          !child.classList.contains("special-screen") &&
          !child.classList.contains("tooltip")) {
        child.remove();
      }
    }

    const wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;";
    wrap.innerHTML = svgText;
    this.#svg = wrap.querySelector("svg");
    ensureWarpDefs(this.#svg);
    const anchor = this.#container.querySelector(".lspace-overlay, .special-screen");
    this.#container.insertBefore(wrap, anchor);

    if (mapId === 53) this.#startTshopAnim();
    if (!this.#roomUnits.has(mapId)) {
      const unit = computeRoomUnit(this.#svg);
      if (unit) this.#roomUnits.set(mapId, unit);
    }

    if (this.#displayedMapId !== null && this.#viewBox.w > 0) {
      this.#persistZoom(this.#displayedMapId, this.#viewBox.w);
    }

    this.#displayedMapId = mapId;
    this.#resetZoom(mapId);
    if (this.#savedZoom.has(mapId)) {
      const ratio = this.#viewBox.h / this.#viewBox.w;
      this.#viewBox.w = this.#savedZoom.get(mapId);
      this.#viewBox.h = this.#viewBox.w * ratio;
    }

    this.centerOn(centerX, centerY);
    this.#wireTooltip();

    for (const [groundId, uppers] of Object.entries(groundToUppers)) {
      if (!this.#svg.querySelector(`#room-${CSS.escape(groundId)}`)) continue;
      for (const upperId of uppers) this.#setStackRoomVisible(upperId, false);
    }

    this.#callbacks.onMapLoaded(mapId);
  }

  applyState({ current, target, routeRoomIds, darkMode, libraryOverlay }) {
    if (!this.#svg) return;

    if (this.#displayedMapId === 99) {
      const dot = this.#svg.querySelector('#world-player');
      if (dot) {
        if (current) {
          dot.setAttribute('cx', current.x);
          dot.setAttribute('cy', current.y);
          dot.style.display = '';
        } else {
          dot.style.display = 'none';
        }
      }
      return;
    }

    const routeOv = this.#svg.querySelector("#sg-route-overlay");
    const posOv   = this.#svg.querySelector("#sg-pos-overlay");
    if (routeOv) _restoreOverlay(routeOv);
    if (posOv)   _restoreOverlay(posOv);

    this.#svg.querySelectorAll(".current, .target, .route").forEach(el => {
      el.classList.remove("current", "target", "route");
    });

    this.#updateStackVisibility(current?.roomId ?? null);

    const routeOverlay = _ensureOverlay(this.#svg, "sg-route-overlay");
    const posOverlay   = _ensureOverlay(this.#svg, "sg-pos-overlay");
    posOverlay.classList.toggle("dark", darkMode);

    for (let i = 0; i < routeRoomIds.length - 1; i++) {
      const [a, b] = [routeRoomIds[i], routeRoomIds[i + 1]].sort();
      const edge = this.#svg.querySelector(`#edge-${CSS.escape(a)}-${CSS.escape(b)}`);
      if (edge) { edge.classList.add("route"); _lift(edge, routeOverlay); }
    }
    for (const id of routeRoomIds) {
      const el = this.#svg.querySelector(`#room-${CSS.escape(id)}`);
      if (el) {
        el.classList.add("route");
        const sib1 = el.nextElementSibling;
        _lift(el, routeOverlay);
        if (sib1?.classList.contains("room-type-label")) _lift(sib1, routeOverlay);
        const stairEl = this.#svg.querySelector(`#stair-${CSS.escape(id)}`);
        if (stairEl) _lift(stairEl, routeOverlay);
      }
    }

    const primary = target ?? current;
    if (primary?.roomId) {
      const el = this.#svg.querySelector(`#room-${CSS.escape(primary.roomId)}`);
      if (el) {
        el.classList.add("target");
        const sib1 = el.nextElementSibling;
        _lift(el, posOverlay);
        if (sib1?.classList.contains("room-type-label")) _lift(sib1, posOverlay);
        const stairEl = this.#svg.querySelector(`#stair-${CSS.escape(primary.roomId)}`);
        if (stairEl) _lift(stairEl, posOverlay);
      }
    }

    if (target && current?.roomId && current.roomId !== target.roomId) {
      const el = this.#svg.querySelector(`#room-${CSS.escape(current.roomId)}`);
      if (el) {
        el.classList.add("current");
        const sib1 = el.nextElementSibling;
        _lift(el, posOverlay);
        if (sib1?.classList.contains("room-type-label")) _lift(sib1, posOverlay);
        const stairEl = this.#svg.querySelector(`#stair-${CSS.escape(current.roomId)}`);
        if (stairEl) _lift(stairEl, posOverlay);
      }
    }

    if (this.#displayedMapId === 47 && current?.mapId === 47) {
      this.#applyLibraryOverlay(current, libraryOverlay);
    }
  }

  handleResize() { /* SVG viewBox handles this automatically */ }

  destroy() {
    this.#stopTshopAnim();
    this.#container.removeEventListener("wheel",         this.#onWheel);
    this.#container.removeEventListener("pointerdown",   this.#onPointerdown);
    this.#container.removeEventListener("pointermove",   this.#onPointermove);
    this.#container.removeEventListener("pointerup",     this.#onPointerup);
    this.#container.removeEventListener("pointercancel", this.#onPointercancel);
    this.#container.removeEventListener("click",         this.#onContainerClick);
    window.removeEventListener("keydown", this.#onKeydown);
    window.removeEventListener("blur",    this.#onBlur);
    if (this.#mapFocused) panel.captureKeys(false);
    this.#svg?.closest("div")?.remove();
    this.#svg = null;
  }

  centerOn(x, y) {
    this.#viewBox.x = x - this.#viewBox.w / 2;
    this.#viewBox.y = y - this.#viewBox.h / 2;
    this.#applyViewBox();
  }

  zoomIn() {
    this.#viewBox.w /= ZOOM_FACTOR; this.#viewBox.h /= ZOOM_FACTOR; this.#applyViewBox();
  }

  zoomOut() {
    this.#viewBox.w *= ZOOM_FACTOR; this.#viewBox.h *= ZOOM_FACTOR; this.#applyViewBox();
  }

  pan(dir) {
    if (!this.#svg) return;
    const step = 0.2;
    if      (dir === 'n') this.#viewBox.y -= this.#viewBox.h * step;
    else if (dir === 's') this.#viewBox.y += this.#viewBox.h * step;
    else if (dir === 'w') this.#viewBox.x -= this.#viewBox.w * step;
    else if (dir === 'e') this.#viewBox.x += this.#viewBox.w * step;
    this.#applyViewBox();
  }

  zoom(dir) {
    if (!this.#svg) return;
    const factor = dir === 'in' ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    const newW = this.#viewBox.w * factor, newH = this.#viewBox.h * factor;
    this.#viewBox.x += 0.5 * (this.#viewBox.w - newW);
    this.#viewBox.y += 0.5 * (this.#viewBox.h - newH);
    this.#viewBox.w  = newW; this.#viewBox.h  = newH;
    this.#applyViewBox();
  }

  grabFocus() {
    this.#mapFocused = true;
    panel.captureKeys(true);
    this.#container.classList.add("focused");
    this.#container.focus();
  }

  releaseFocus() {
    this.#mapFocused = false;
    panel.captureKeys(false);
    this.#container.classList.remove("focused");
  }

  findRoomByLabel(name, mapId) {
    if (!this.#svg || mapId !== this.#displayedMapId) return null;
    const el = this.#svg.querySelector(`[data-label="${CSS.escape(name)}"]`);
    if (!el) return null;
    const cx = el.getAttribute('cx');
    const x  = cx !== null
      ? parseFloat(cx)
      : parseFloat(el.getAttribute('x') ?? 0) + parseFloat(el.getAttribute('width') ?? 0) / 2;
    const cy = el.getAttribute('cy');
    const y  = cy !== null
      ? parseFloat(cy)
      : parseFloat(el.getAttribute('y') ?? 0) + parseFloat(el.getAttribute('height') ?? 0) / 2;
    if (!isNaN(x) && !isNaN(y)) return { mapId, x, y, short: name };
    return null;
  }

  applyLibraryPosition(x, y) {
    if (!this.#svg) return;
    this.#svg.querySelector(".room.current")?.classList.remove("current");
    this.#svg.querySelector(`#room-lib-${x}-${y}`)?.classList.add("current");
    this.centerOn(x, y);
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  #applyViewBox() {
    if (!this.#svg) return;
    this.#svg.setAttribute("viewBox",
      `${this.#viewBox.x} ${this.#viewBox.y} ${this.#viewBox.w} ${this.#viewBox.h}`);
  }

  #defaultZoomW(mapId) {
    const meta = this.#data.maps[mapId];
    if (!meta) return 1;
    if (mapId === 47) return 280;
    if (mapId === 99) return meta.maxX / 2;
    const unit = this.#roomUnits.get(mapId);
    if (unit) return this.#container.clientWidth * unit / TARGET_PX;
    return meta.maxX / 4;
  }

  #resetZoom(mapId) {
    const ratio     = this.#container.clientHeight / Math.max(this.#container.clientWidth, 1);
    this.#viewBox.w = this.#defaultZoomW(mapId);
    this.#viewBox.h = this.#viewBox.w * ratio;
  }

  #persistZoom(mapId, w) {
    this.#savedZoom.set(mapId, w);
    this.#callbacks.onPersistZoom(mapId, w);
  }

  #setStackRoomVisible(id, visible) {
    const d = visible ? '' : 'none';
    const roomEl = this.#svg.querySelector(`#room-${CSS.escape(id)}`);
    if (roomEl) {
      roomEl.style.display = d;
      const sib = roomEl.nextElementSibling;
      if (sib?.classList.contains('room-type-label')) sib.style.display = d;
    }
    const stairEl = this.#svg.querySelector(`#stair-${CSS.escape(id)}`);
    if (stairEl) stairEl.style.display = d;
  }

  #updateStackVisibility(roomId) {
    if (!this.#svg) return;
    if (this.#currentStackGround) {
      this.#setStackRoomVisible(this.#currentStackGround, true);
      for (const u of groundToUppers[this.#currentStackGround] ?? [])
        this.#setStackRoomVisible(u, false);
      this.#currentStackGround = null;
    }
    if (!roomId) return;
    const ground = upperToGround[roomId];
    if (ground) {
      this.#setStackRoomVisible(ground, false);
      this.#setStackRoomVisible(roomId, true);
      this.#currentStackGround = ground;
    }
  }

  #wireTooltip() {
    if (!this.#svg) return;
    this.#svg.addEventListener("pointermove", (e) => {
      const roomEl    = e.target.closest(".room");
      const label     = roomEl?.dataset.label ?? "";
      const typeKey   = [...(roomEl?.classList ?? [])].map(c => c.startsWith("room-") ? c.slice(5) : null).find(k => k && ROOM_TYPE_LABELS[k]);
      const typeLabel = typeKey ? ROOM_TYPE_LABELS[typeKey] : null;
      if (label || typeLabel) {
        const spec = {};
        if (label)     spec.title = label;
        if (typeLabel) spec.body  = typeLabel;
        panel.tooltip.show({ x: e.clientX, y: e.clientY, width: 0, height: 0 }, spec);
      } else {
        panel.tooltip.hide();
      }
    });
    this.#svg.addEventListener("pointerleave", () => { panel.tooltip.hide(); });
  }

  #applyLibraryOverlay(current, libraryOverlay) {
    const cx = current.x, cy = current.y, half = 15;
    const distEl = this.#svg.querySelector("#lib-distortion");
    const orbEl  = this.#svg.querySelector("#lib-orb");
    const arrEl  = this.#svg.querySelector("#lib-arrow");
    if (!distEl || !orbEl || !arrEl) return;
    if (libraryOverlay?.distortion) {
      const dir = libraryOverlay.distortion;
      const bw = 20, bh = 3;
      const [x, y, w, h] =
        dir === 'n' ? [cx - bw/2, cy - half - bh, bw, bh] :
        dir === 's' ? [cx - bw/2, cy + half,       bw, bh] :
        dir === 'e' ? [cx + half, cy - bw/2,        bh, bw] :
                      [cx - half - bh, cy - bw/2,   bh, bw];
      distEl.setAttribute("x", x); distEl.setAttribute("y", y);
      distEl.setAttribute("width", w); distEl.setAttribute("height", h);
      distEl.setAttribute("visibility", "visible");
    } else {
      distEl.setAttribute("visibility", "hidden");
    }
    if (libraryOverlay?.orb) {
      orbEl.setAttribute("cx", cx); orbEl.setAttribute("cy", cy);
      orbEl.setAttribute("r",  ORB_RADIUS[libraryOverlay.orb] ?? 7);
      orbEl.setAttribute("visibility", "visible");
    } else {
      orbEl.setAttribute("visibility", "hidden");
    }
    if (libraryOverlay?.facing) {
      const f = libraryOverlay.facing, r = 12, w = 5;
      const d =
        f === 'n' ? `M ${cx-w} ${cy-r+w} L ${cx} ${cy-r} L ${cx+w} ${cy-r+w}` :
        f === 's' ? `M ${cx-w} ${cy+r-w} L ${cx} ${cy+r} L ${cx+w} ${cy+r-w}` :
        f === 'e' ? `M ${cx+r-w} ${cy-w} L ${cx+r} ${cy} L ${cx+r-w} ${cy+w}` :
                    `M ${cx-r+w} ${cy-w} L ${cx-r} ${cy} L ${cx-r+w} ${cy+w}`;
      arrEl.setAttribute("d", d);
      arrEl.setAttribute("visibility", "visible");
    } else {
      arrEl.setAttribute("visibility", "hidden");
    }
  }

  #startTshopAnim() {
    this.#stopTshopAnim();
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;";
    document.body.appendChild(canvas);
    this.#tshopCanvas = canvas;
    const particles = [];
    const ctx = canvas.getContext("2d");
    const HS_MAX = 80, HS_SPAWN = 0.35, HS_ACCEL = 1.015;
    const frame = () => {
      if (!canvas.isConnected) { this.#tshopAnim = null; this.#tshopCanvas = null; return; }
      this.#tshopAnim = requestAnimationFrame(frame);
      const cw = window.innerWidth, ch = window.innerHeight;
      if (!cw || !ch) return;
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      ctx.clearRect(0, 0, cw, ch);
      const ocx = cw / 2, ocy = ch / 2;
      const maxDist = Math.max(
        Math.hypot(ocx, ocy), Math.hypot(cw - ocx, ocy),
        Math.hypot(ocx, ch - ocy), Math.hypot(cw - ocx, ch - ocy)
      ) * 1.05;
      const fadeDist = maxDist * 0.75;
      const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#ffffff";
      if (particles.length < HS_MAX && Math.random() < HS_SPAWN) {
        particles.push({ angle: Math.random() * Math.PI * 2, dist: 0, speed: 0.5 + Math.random() * 0.8 });
      }
      ctx.strokeStyle = fg; ctx.lineCap = "round";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const prev = p.dist;
        p.speed *= HS_ACCEL; p.dist += p.speed;
        if (p.dist >= maxDist) { particles.splice(i, 1); continue; }
        const opacity = p.dist < 15 ? p.dist / 15
          : p.dist > fadeDist ? 1 - (p.dist - fadeDist) / (maxDist - fadeDist) : 1;
        const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
        ctx.globalAlpha = opacity * 0.75;
        ctx.lineWidth   = Math.max(0.5, p.speed * 0.15);
        ctx.beginPath();
        ctx.moveTo(ocx + cos * prev,   ocy + sin * prev);
        ctx.lineTo(ocx + cos * p.dist, ocy + sin * p.dist);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    this.#tshopAnim = requestAnimationFrame(frame);
  }

  #stopTshopAnim() {
    if (this.#tshopAnim === null) return;
    cancelAnimationFrame(this.#tshopAnim);
    this.#tshopAnim = null;
    if (this.#tshopCanvas) { this.#tshopCanvas.remove(); this.#tshopCanvas = null; }
  }

  // ─── Event handlers ──────────────────────────────────────────────────────

  #handleWheel(e) {
    if (!this.#svg) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const newW = this.#viewBox.w * factor, newH = this.#viewBox.h * factor;
    this.#viewBox.x += 0.5 * (this.#viewBox.w - newW);
    this.#viewBox.y += 0.5 * (this.#viewBox.h - newH);
    this.#viewBox.w  = newW; this.#viewBox.h  = newH;
    this.#applyViewBox();
  }

  #handlePointerdown(e) {
    if (!this.#svg) return;
    const roomEl = e.target.closest(".room");
    if (e.button === 1) {
      e.preventDefault();
      this.#drag = { screenX: e.clientX, screenY: e.clientY, vbX: this.#viewBox.x, vbY: this.#viewBox.y };
      this.#container.setPointerCapture(e.pointerId);
    } else if (e.button === 0 && !roomEl) {
      this.#drag = { screenX: e.clientX, screenY: e.clientY, vbX: this.#viewBox.x, vbY: this.#viewBox.y };
      this.#container.setPointerCapture(e.pointerId);
    } else if (e.button === 0 && roomEl && this.#displayedMapId !== 99) {
      this.#pendingClick = { el: roomEl, startX: e.clientX, startY: e.clientY };
      this.#container.setPointerCapture(e.pointerId);
    }
  }

  #handlePointermove(e) {
    if (this.#drag) {
      const rect = this.#container.getBoundingClientRect();
      this.#viewBox.x = this.#drag.vbX - (e.clientX - this.#drag.screenX) / rect.width  * this.#viewBox.w;
      this.#viewBox.y = this.#drag.vbY - (e.clientY - this.#drag.screenY) / rect.height * this.#viewBox.h;
      this.#applyViewBox();
    } else if (this.#pendingClick) {
      const dx = e.clientX - this.#pendingClick.startX;
      const dy = e.clientY - this.#pendingClick.startY;
      if (Math.hypot(dx, dy) > 4) this.#pendingClick = null;
    }
  }

  #handlePointerup() {
    if (this.#pendingClick) {
      const el = this.#pendingClick.el;
      const roomId = el.id.slice(5);
      const name   = el.dataset.label ?? "";
      this.#callbacks.onRoomClick(roomId, name);
    }
    this.#drag = null;
    this.#pendingClick = null;
  }

  #handlePointercancel() {
    this.#drag = null;
    this.#pendingClick = null;
  }

  #handleContainerClick() {
    if (!this.#mapFocused) this.grabFocus();
  }

  #handleKeydown(e) {
    if (!this.#mapFocused || !this.#svg) return;
    switch (e.key) {
      case "ArrowUp":    this.#viewBox.y -= this.#viewBox.h * 0.2; this.#applyViewBox(); break;
      case "ArrowDown":  this.#viewBox.y += this.#viewBox.h * 0.2; this.#applyViewBox(); break;
      case "ArrowLeft":  this.#viewBox.x -= this.#viewBox.w * 0.2; this.#applyViewBox(); break;
      case "ArrowRight": this.#viewBox.x += this.#viewBox.w * 0.2; this.#applyViewBox(); break;
      case "+": case "=": { const nw = this.#viewBox.w / ZOOM_FACTOR, nh = this.#viewBox.h / ZOOM_FACTOR;
        this.#viewBox.x += 0.5 * (this.#viewBox.w - nw); this.#viewBox.y += 0.5 * (this.#viewBox.h - nh);
        this.#viewBox.w = nw; this.#viewBox.h = nh; this.#applyViewBox(); break; }
      case "-": { const nw = this.#viewBox.w * ZOOM_FACTOR, nh = this.#viewBox.h * ZOOM_FACTOR;
        this.#viewBox.x += 0.5 * (this.#viewBox.w - nw); this.#viewBox.y += 0.5 * (this.#viewBox.h - nh);
        this.#viewBox.w = nw; this.#viewBox.h = nh; this.#applyViewBox(); break; }
      case "0": {
        // handled by coordinator via keyboard_zoom_reset event — nothing here
        break; }
      case "Escape": this.releaseFocus(); break;
      default: return;
    }
    e.preventDefault();
  }
}
```

> **Note on keyboard `0` key:** The original code calls `centerOnRoom(target ?? current)` for key `0`. Since center-on requires the coordinator's state (current/target), the SVG renderer cannot do this alone. Options: (a) expose a `centerOnState(current, target)` method, or (b) have the coordinator handle key `0` by calling `activeRenderer.centerOn(...)`. The simplest fix: keep key `0` in the SVG renderer's keydown handler but add a `zoomReset(current, target)` method instead:

Add to `#handleKeydown`:
```js
case "0": {
  if (this.#callbacks.onZoomReset) {
    this.#callbacks.onZoomReset();  // coordinator calls centerOn with current pos
  }
  break;
}
```

Add to callbacks interface: `onZoomReset()` — coordinator wires this to `activeRenderer.centerOn(pos.x, pos.y)` where pos is `target ?? current`.

Or even simpler: pass a `getPos` function in callbacks:

Actually the cleanest: add `onZoomReset` to callbacks. The coordinator provides:
```js
onZoomReset: () => {
  const pos = target ?? current;
  if (pos && pos.mapId === displayedMapId) activeRenderer.centerOn(pos.x, pos.y);
}
```

Add `onZoomReset` to the `callbacks` argument. Add `this.#callbacks.onZoomReset?.()` in case `0`.

- [ ] **Step 3: Add the `onZoomReset` callback to the interface**

Update the constructor's callbacks type comment and key-`0` handler in `#handleKeydown`:
```js
case "0": {
  this.#callbacks.onZoomReset?.();
  break;
}
```

- [ ] **Step 4: Add `import { SvgRenderer } from './svg-renderer.js';` to `ui/mapper.js`**

Add after the existing imports — no other changes yet:
```js
import { SvgRenderer } from "./svg-renderer.js";
```

- [ ] **Step 5: Run tests to verify no regressions**

```bash
npm test
```

Expected: all tests pass. (The import is unused at this point — that's fine. Vitest tests don't load browser modules.)

- [ ] **Step 6: Commit**

```bash
git add ui/svg-renderer.js ui/mapper.js
git commit -m "feat(svg-renderer): extract SvgRenderer class from mapper.js"
```

---

### Task 3: PngRenderer class + tests (`ui/png-renderer.js`)

**Files:**
- Create: `ui/png-renderer.js`
- Create: `scripts/png-renderer.test.mjs`

**Interfaces:**
- Consumes: `data.rooms` format `{ id: [map_id, xpos, ypos, short] }`, `data.maps` format `{ mapId: { file, name, ... } }`
- Produces: named export `findNearestRoom(rooms, mapId, px, py)` → `string | null`; default export `PngRenderer` class (full interface)

- [ ] **Step 1: Write the failing tests**

Create `scripts/png-renderer.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { findNearestRoom } from '../ui/png-renderer.js';

// rooms format: { id: [map_id, xpos, ypos, short] }
const ROOMS = {
  'room-a': [1, 100, 100, 'Room A'],
  'room-b': [1, 200, 200, 'Room B'],
  'room-c': [2, 100, 100, 'Room C on map 2'],
};

describe('findNearestRoom', () => {
  it('returns the nearest room on the correct map', () => {
    expect(findNearestRoom(ROOMS, 1, 100, 100)).toBe('room-a');
    expect(findNearestRoom(ROOMS, 1, 200, 200)).toBe('room-b');
  });

  it('ignores rooms on other maps', () => {
    expect(findNearestRoom(ROOMS, 2, 100, 100)).toBe('room-c');
    // room-c is on map 2; map 1 click at same coords → room-a
    expect(findNearestRoom(ROOMS, 1, 100, 100)).toBe('room-a');
  });

  it('returns null when nearest room exceeds click threshold', () => {
    const sparse = { 'r1': [1, 100, 100, 'R1'] };
    // distance = sqrt(100^2 + 100^2) ≈ 141px, well beyond 20px threshold
    expect(findNearestRoom(sparse, 1, 200, 200)).toBeNull();
  });

  it('returns null when no rooms exist for the given map', () => {
    expect(findNearestRoom(ROOMS, 99, 100, 100)).toBeNull();
  });

  it('returns the closer of two nearby rooms', () => {
    const rooms = {
      'r1': [1, 100, 100, 'R1'],
      'r2': [1, 110, 100, 'R2'],
    };
    expect(findNearestRoom(rooms, 1, 108, 100)).toBe('r2');  // 2px vs 8px
    expect(findNearestRoom(rooms, 1, 102, 100)).toBe('r1');  // 2px vs 8px
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:js
```

Expected: fails with "Cannot find module '../ui/png-renderer.js'"

- [ ] **Step 3: Create `ui/png-renderer.js`**

```js
const PNG_CLICK_THRESHOLD = 20;  // px — max distance to nearest room for a click to register

export function findNearestRoom(rooms, mapId, px, py) {
  let bestId = null, bestDist = Infinity;
  for (const [id, room] of Object.entries(rooms)) {
    if (room[0] !== mapId) continue;
    const d = Math.hypot(px - room[1], py - room[2]);
    if (d < bestDist) { bestDist = d; bestId = id; }
  }
  return bestDist <= PNG_CLICK_THRESHOLD ? bestId : null;
}

export class PngRenderer {
  supportsZoom    = false;
  supportsFilters = false;

  #container;
  #data;
  #callbacks;

  #img       = null;
  #canvas    = null;
  #wrap      = null;
  #mapId     = null;
  #lastState = null;

  #pendingClick = null;
  #onPointerdown;
  #onPointermove;
  #onPointerup;
  #onPointercancel;

  constructor($container, data, callbacks) {
    this.#container = $container;
    this.#data      = data;
    this.#callbacks = callbacks;

    this.#onPointerdown   = this.#handlePointerdown.bind(this);
    this.#onPointermove   = this.#handlePointermove.bind(this);
    this.#onPointerup     = this.#handlePointerup.bind(this);
    this.#onPointercancel = this.#handlePointercancel.bind(this);
  }

  async load(mapId, _centerX, _centerY) {
    const meta = this.#data.maps[mapId];
    if (!meta) return;

    // Remove previous content (preserves coordinator-owned overlays)
    this.#img = null; this.#canvas = null;
    if (this.#wrap) {
      this.#wrap.removeEventListener("pointerdown",   this.#onPointerdown);
      this.#wrap.removeEventListener("pointermove",   this.#onPointermove);
      this.#wrap.removeEventListener("pointerup",     this.#onPointerup);
      this.#wrap.removeEventListener("pointercancel", this.#onPointercancel);
      this.#wrap.remove();
      this.#wrap = null;
    }

    this.#mapId = mapId;

    const img = document.createElement("img");
    img.className = "png-map-img";
    img.style.cssText = "display:block;max-width:100%;max-height:100%;object-fit:contain;";
    img.src = `ui/maps/${meta.file}`;

    const canvas = document.createElement("canvas");
    canvas.className = "png-map-canvas";
    canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;";

    const wrap = document.createElement("div");
    wrap.className = "png-map-wrap";
    wrap.style.cssText = "position:relative;display:inline-block;";
    wrap.appendChild(img);
    wrap.appendChild(canvas);

    this.#img    = img;
    this.#canvas = canvas;
    this.#wrap   = wrap;

    wrap.addEventListener("pointerdown",   this.#onPointerdown);
    wrap.addEventListener("pointermove",   this.#onPointermove);
    wrap.addEventListener("pointerup",     this.#onPointerup);
    wrap.addEventListener("pointercancel", this.#onPointercancel);

    const anchor = this.#container.querySelector(".lspace-overlay, .special-screen");
    this.#container.insertBefore(wrap, anchor);

    await new Promise((resolve, reject) => {
      img.onload  = resolve;
      img.onerror = () => reject(new Error(`Failed to load PNG: ${img.src}`));
    });

    this.#callbacks.onMapLoaded(mapId);
  }

  applyState(state) {
    this.#lastState = state;
    this.#drawState(state);
  }

  handleResize() {
    if (this.#lastState) this.#drawState(this.#lastState);
  }

  destroy() {
    if (!this.#wrap) return;
    this.#wrap.removeEventListener("pointerdown",   this.#onPointerdown);
    this.#wrap.removeEventListener("pointermove",   this.#onPointermove);
    this.#wrap.removeEventListener("pointerup",     this.#onPointerup);
    this.#wrap.removeEventListener("pointercancel", this.#onPointercancel);
    this.#wrap.remove();
    this.#wrap = null; this.#img = null; this.#canvas = null;
  }

  // No-op methods to satisfy the interface when coordinator calls these unconditionally:
  centerOn()            {}
  zoomIn()              {}
  zoomOut()             {}
  pan()                 {}
  zoom()                {}
  grabFocus()           {}
  releaseFocus()        {}

  // ─── Private helpers ─────────────────────────────────────────────────────

  #drawState({ current, target, routeRoomIds }) {
    if (!this.#img || !this.#canvas) return;
    const w = this.#img.clientWidth, h = this.#img.clientHeight;
    if (!w || !h) return;
    if (this.#canvas.width !== w)  this.#canvas.width  = w;
    if (this.#canvas.height !== h) this.#canvas.height = h;

    const scaleX = w / this.#img.naturalWidth;
    const scaleY = h / this.#img.naturalHeight;
    const toCanvasX = (px) => px * scaleX;
    const toCanvasY = (py) => py * scaleY;

    const ctx = this.#canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    const rooms = this.#data.rooms;
    const mapId = this.#mapId;

    // Route rooms — blue circles
    for (const id of routeRoomIds) {
      const room = rooms[id];
      if (!room || room[0] !== mapId) continue;
      ctx.beginPath();
      ctx.arc(toCanvasX(room[1]), toCanvasY(room[2]), 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(74, 159, 212, 0.8)";
      ctx.fill();
    }

    // Ghost position (when prediction active and different from confirmed)
    if (target && current?.roomId && current.roomId !== target.roomId) {
      const room = rooms[current.roomId];
      if (room && room[0] === mapId) {
        ctx.beginPath();
        ctx.arc(toCanvasX(room[1]), toCanvasY(room[2]), 7, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(136, 136, 136, 0.6)";
        ctx.fill();
      }
    }

    // Player position — yellow dot with white ring
    const primary = target ?? current;
    const primaryRoom = primary?.roomId ? rooms[primary.roomId] : null;
    if (primary && !primary.roomId) {
      // Position by x/y coords (no roomId, e.g. library or name-based fallback)
      ctx.beginPath();
      ctx.arc(toCanvasX(primary.x), toCanvasY(primary.y), 8, 0, Math.PI * 2);
      ctx.fillStyle = "#e0e040";
      ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      ctx.stroke();
    } else if (primaryRoom && primaryRoom[0] === mapId) {
      ctx.beginPath();
      ctx.arc(toCanvasX(primaryRoom[1]), toCanvasY(primaryRoom[2]), 8, 0, Math.PI * 2);
      ctx.fillStyle = "#e0e040";
      ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  #handlePointerdown(e) {
    if (e.button !== 0) return;
    this.#pendingClick = { startX: e.clientX, startY: e.clientY };
    this.#wrap.setPointerCapture(e.pointerId);
  }

  #handlePointermove(e) {
    if (!this.#pendingClick) return;
    const dx = e.clientX - this.#pendingClick.startX;
    const dy = e.clientY - this.#pendingClick.startY;
    if (Math.hypot(dx, dy) > 4) this.#pendingClick = null;
  }

  #handlePointerup(e) {
    if (this.#pendingClick && this.#img) {
      const rect = this.#img.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (this.#img.naturalWidth  / rect.width);
      const py = (e.clientY - rect.top)  * (this.#img.naturalHeight / rect.height);
      const roomId = findNearestRoom(this.#data.rooms, this.#mapId, px, py);
      if (roomId) {
        const room = this.#data.rooms[roomId];
        this.#callbacks.onRoomClick(roomId, room?.[3] ?? "");
      }
    }
    this.#pendingClick = null;
  }

  #handlePointercancel() {
    this.#pendingClick = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:js
```

Expected: all tests pass including the new `png-renderer` tests.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Add import to `ui/mapper.js`**

```js
import { PngRenderer } from "./png-renderer.js";
```

- [ ] **Step 7: Commit**

```bash
git add ui/png-renderer.js scripts/png-renderer.test.mjs ui/mapper.js
git commit -m "feat(png-renderer): PngRenderer class + findNearestRoom tests"
```

---

### Task 4: Coordinator refactor (`ui/mapper.js`)

**Files:**
- Modify: `ui/mapper.js` — replace with coordinator-only code; delegate all rendering to `activeRenderer`

**Interfaces:**
- Consumes: `SvgRenderer` from `./svg-renderer.js`, `PngRenderer` from `./png-renderer.js`
- Produces: slim coordinator; all existing `panel.on(...)` semantics preserved exactly
- New handler: `panel.on("map_style", ...)` triggers `switchRenderer(style)`

- [ ] **Step 1: Run tests to confirm baseline**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 2: Rewrite `ui/mapper.js`**

Replace the entire file with the refactored coordinator. Every `panel.on(...)` handler must preserve exactly the same semantic behaviour — compare carefully with the original.

```js
import { rooms, maps, terrain } from "./data/rooms.js";
import customRooms from "./data/room-custom.js";
import { resolveRoom } from "./lookup.js";
import { mapDidChange, headerText } from "./render.js";
import { SvgRenderer } from "./svg-renderer.js";
import { PngRenderer }  from "./png-renderer.js";

const data = { rooms: { ...rooms, ...customRooms }, maps, terrain };

// ─── DOM refs ─────────────────────────────────────────────────────────────
const $mapName      = document.querySelector(".map-name");
const $container    = document.querySelector(".map-container");
const $lspace       = document.querySelector(".lspace-overlay");
const $special      = document.querySelector(".special-screen");
const $specialTitle = $special.querySelector(".special-title");
const $specialSub   = $special.querySelector(".special-sub");
const $zoomIn       = document.querySelector(".zoom-in");
const $zoomOut      = document.querySelector(".zoom-out");
const $footer       = document.querySelector(".route-footer");
const $routeDest    = document.querySelector(".route-dest");
const $routeWalk    = document.querySelector(".route-walk");
const $routeClear   = document.querySelector(".route-clear");

// ─── Filters ──────────────────────────────────────────────────────────────
function applyStreetsState(visible) {
  document.documentElement.classList.toggle('streets-hidden', !visible);
}
applyStreetsState(true);

function applyStairsState(visible) {
  document.documentElement.classList.toggle('stairs-hidden', !visible);
}
applyStairsState(true);

// ─── Special screens ──────────────────────────────────────────────────────
const SPECIAL_SCREENS = {
  unknown:   { title: "Unknown Location",  sub: "No map data for this room." },
  darkness:  { title: "Darkness",          sub: "You cannot see a thing."    },
  labyrinth: { title: "Labyrinth",         sub: "The passages twist and turn." },
  mines:     { title: "Mines",             sub: ""                            },
  rat_farm:  { title: "Rat Farm",          sub: ""                            },
};

function showSpecialScreen(name) {
  const info = SPECIAL_SCREENS[name] ?? { title: name, sub: "" };
  $specialTitle.textContent = info.title;
  $specialSub.textContent   = info.sub;
  $specialSub.hidden        = !info.sub;
  $special.hidden = false;
}

function hideSpecialScreen() {
  $special.hidden = true;
}

// ─── L-space animation ────────────────────────────────────────────────────
const LSPACE_COLORS = ["#cc44ff", "#00d2ff", "#4ade80", "#ff9f43", "#ff6b6b", "#ffd32a", "#ffffff"];
const lspaceState = { x: -1, y: -1, vx: 1.5, vy: 1.1, colorIdx: 0 };
let lspaceAnim = null;

function startLSpaceAnim() {
  if (lspaceAnim !== null) return;
  const badge = $lspace.querySelector(".lspace-badge");
  const s = lspaceState;
  badge.style.color = LSPACE_COLORS[s.colorIdx];
  function step() {
    const cw = $lspace.clientWidth, ch = $lspace.clientHeight;
    const bw = badge.offsetWidth,   bh = badge.offsetHeight;
    if (s.x < 0) { s.x = (cw - bw) / 2; s.y = (ch - bh) / 2; }
    s.x += s.vx; s.y += s.vy;
    let hitX = false, hitY = false;
    if (s.x <= 0)          { s.x = 0;       s.vx =  Math.abs(s.vx); hitX = true; }
    if (s.x + bw >= cw)    { s.x = cw - bw; s.vx = -Math.abs(s.vx); hitX = true; }
    if (s.y <= 0)          { s.y = 0;       s.vy =  Math.abs(s.vy); hitY = true; }
    if (s.y + bh >= ch)    { s.y = ch - bh; s.vy = -Math.abs(s.vy); hitY = true; }
    if (hitX && hitY) {
      s.colorIdx = (s.colorIdx + 1 + Math.floor(Math.random() * (LSPACE_COLORS.length - 1))) % LSPACE_COLORS.length;
      badge.style.color = LSPACE_COLORS[s.colorIdx];
    }
    badge.style.transform = `translate(${s.x}px, ${s.y}px)`;
    lspaceAnim = requestAnimationFrame(step);
  }
  lspaceAnim = requestAnimationFrame(step);
}

function stopLSpaceAnim() {
  if (lspaceAnim === null) return;
  cancelAnimationFrame(lspaceAnim);
  lspaceAnim = null;
}

// ─── Coordinator state ────────────────────────────────────────────────────
let current        = null;
let target         = null;
let routeRoomIds   = [];
let libraryOverlay = null;
let lastKnownMapId = null;
let displayedMapId = null;
let darkMode       = false;
let walkActive     = false;
const savedZoom    = new Map();

function getState() {
  return { current, target, routeRoomIds, darkMode, libraryOverlay };
}

// ─── Renderer lifecycle ───────────────────────────────────────────────────
let activeRenderer = null;
let contextMenuController = null;

const callbacks = {
  onRoomClick:   (id, name) => panel.post("room_click", { id, name }),
  onMapLoaded:   (mapId) => {
    target = null;  // clear prediction on successful map load
    $footer.hidden = mapId === 99;
    updateHeader();
    const meta = data.maps[mapId];
    panel.post("map_changed", { name: meta.file.replace(/\.\w+$/, '') });
  },
  onPersistZoom: (mapId, w) => panel.post("save_zoom", { mapId, w }),
  onZoomReset:   () => {
    const pos = target ?? current;
    if (pos && pos.mapId === displayedMapId) activeRenderer?.centerOn?.(pos.x, pos.y);
  },
};

function switchRenderer(style) {
  activeRenderer?.destroy();
  const Cls = style === 'png' ? PngRenderer : SvgRenderer;
  activeRenderer = new Cls($container, data, callbacks, savedZoom);
  rewireZoom();
  rewireContextMenu();
}

async function loadMap(mapId, x, y) {
  if (!activeRenderer || mapId == null) return;
  displayedMapId = mapId;
  try {
    await activeRenderer.load(mapId, x, y);
  } catch (e) {
    console.error("[mapper] map load failed:", e);
    $mapName.textContent = "Map load failed";
  }
}

// ─── Zoom buttons ─────────────────────────────────────────────────────────
$zoomIn.addEventListener("click",  () => activeRenderer?.zoomIn?.());
$zoomOut.addEventListener("click", () => activeRenderer?.zoomOut?.());

function rewireZoom() {
  const supported = activeRenderer?.supportsZoom ?? false;
  $zoomIn.hidden  = !supported;
  $zoomOut.hidden = !supported;
}

// ─── Context menu ─────────────────────────────────────────────────────────
function rewireContextMenu() {
  contextMenuController?.abort();
  contextMenuController = null;
  if (!(panel.menu && typeof panel.menu.show === "function")) return;
  if (!activeRenderer?.supportsFilters) return;
  contextMenuController = new AbortController();
  document.addEventListener("contextmenu", (e) => {
    const isWorld  = displayedMapId === 99;
    const streetsOn = !document.documentElement.classList.contains('streets-hidden');
    const stairsOn  = !document.documentElement.classList.contains('stairs-hidden');
    const items = [{ header: true, label: "Map" }];
    if (!isWorld) {
      items.push(
        { label: "Street names", checked: streetsOn, onClick: () => {
            applyStreetsState(!streetsOn);
            panel.post("save_filters", { streets: !streetsOn, stairs: stairsOn });
        }},
        { label: "Stairs", checked: stairsOn, onClick: () => {
            applyStairsState(!stairsOn);
            panel.post("save_filters", { streets: streetsOn, stairs: !stairsOn });
        }},
      );
    }
    panel.menu.show(e, items);
  }, { signal: contextMenuController.signal });
}

// ─── Footer ───────────────────────────────────────────────────────────────
$routeWalk.addEventListener("click",  () => panel.post("walk_request",  {}));
$routeClear.addEventListener("click", () => panel.post("clear_request", {}));

$footer.addEventListener("pointerenter", () => {
  const text = $routeDest.textContent;
  if (!text) return;
  const r = $footer.getBoundingClientRect();
  panel.tooltip.show({ x: r.left, y: r.top, width: r.width, height: r.height }, { title: text });
});
$footer.addEventListener("pointerleave", () => panel.tooltip.hide());

// ─── Header ───────────────────────────────────────────────────────────────
function updateHeader() {
  const inLSpace  = current === null && lastKnownMapId === 47;
  const inUnknown = current === null && !inLSpace && $special.hidden;
  $lspace.hidden = !inLSpace;
  if (inLSpace)  startLSpaceAnim(); else stopLSpaceAnim();
  if (inLSpace)   { hideSpecialScreen(); $mapName.textContent = "L-space"; return; }
  if (inUnknown)  { showSpecialScreen("unknown"); $mapName.textContent = ""; return; }
  if (current !== null) hideSpecialScreen();
  if (current?.mapId === 47) {
    const thaums = Math.floor((((4850 - current.y) - 10) / 30) * 5);
    $mapName.textContent = `UU Library — ${thaums} thaums`;
  } else {
    $mapName.textContent = headerText(data.maps, current);
  }
}

// ─── Route ────────────────────────────────────────────────────────────────
function clearRoute() {
  walkActive    = false;
  routeRoomIds  = [];
  activeRenderer?.applyState(getState());
  $routeDest.textContent = '';
  $routeWalk.hidden  = true;
  $routeClear.hidden = true;
  $routeWalk.disabled  = false;
  $routeClear.disabled = false;
}

// ─── Panel event handlers ─────────────────────────────────────────────────
panel.on("grab_focus",    () => activeRenderer?.grabFocus?.());
panel.on("release_focus", () => activeRenderer?.releaseFocus?.());
panel.on("pan",  (frame) => activeRenderer?.pan?.(frame.dir));
panel.on("zoom", (frame) => activeRenderer?.zoom?.(frame.dir));

panel.on("map_style", async (frame) => {
  const style = frame.style ?? 'svg';
  switchRenderer(style);
  if (displayedMapId != null) {
    const x = current?.x ?? data.maps[displayedMapId]?.defaultX;
    const y = current?.y ?? data.maps[displayedMapId]?.defaultY;
    await loadMap(displayedMapId, x, y);
    activeRenderer?.applyState(getState());
  }
});

panel.on("zoom_data", (frame) => {
  for (const [k, v] of Object.entries(frame)) savedZoom.set(Number(k), v);
});

panel.on("filters_data", (frame) => {
  applyStreetsState(frame.streets !== false);
  applyStairsState(frame.stairs  !== false);
});

panel.on("room_dark", () => { darkMode = true; activeRenderer?.applyState(getState()); });

panel.on("room_info", async (frame) => {
  const wasInDark = darkMode;
  darkMode = false;
  if (wasInDark) target = null;
  let next = resolveRoom(data, frame);
  if (next === null && frame.name) {
    next = activeRenderer?.findRoomByLabel?.(frame.name, displayedMapId) ?? null;
  }
  if (current?.mapId === 47 && (next === null || next.mapId === 47)) return;
  if (target !== null && frame.identifier != null && frame.identifier === target.roomId) {
    target = null;
  }
  if (next?.mapId !== displayedMapId) {
    if (target?.mapId === displayedMapId) {
      // Proactive load already triggered — don't reload the old map
    } else if (next !== null) {
      try {
        await loadMap(next.mapId, next.x, next.y);
      } catch (e) {
        console.error("[mapper] loadMap failed:", e);
        $mapName.textContent = "Map load failed";
        return;
      }
    }
  } else if (next !== null) {
    if (!target) activeRenderer?.centerOn?.(next.x, next.y);
  }
  if (next !== null) {
    lastKnownMapId = next.mapId;
    next.roomId = frame.identifier ?? null;
  }
  if (!walkActive && current !== null && routeRoomIds.length > 0 &&
      current.roomId != null && next?.roomId != null &&
      next.roomId !== current.roomId) {
    clearRoute();
  }
  current = next;
  activeRenderer?.applyState(getState());
  updateHeader();
});

panel.on("route_set", (frame) => {
  routeRoomIds = Array.isArray(frame.rooms) ? frame.rooms : [];
  activeRenderer?.applyState(getState());
  $routeWalk.disabled  = false;
  $routeClear.disabled = false;
  if (frame.destination) {
    const s = frame.steps ?? Math.max(0, routeRoomIds.length - 1);
    $routeDest.textContent = `→ ${frame.destination} (${s} move${s === 1 ? '' : 's'})`;
    $routeWalk.hidden  = false;
    $routeClear.hidden = false;
  } else {
    $routeDest.textContent = '';
    $routeWalk.hidden  = true;
    $routeClear.hidden = true;
  }
});

panel.on("walk_active", () => {
  walkActive = true;
  $routeWalk.disabled  = true;
  $routeClear.disabled = true;
});

panel.on("route_clear", clearRoute);

panel.on("target_move", async (frame) => {
  const next = resolveRoom(data, frame);
  if (next !== null) next.roomId = frame.identifier ?? null;
  if (next === null) { target = null; activeRenderer?.applyState(getState()); return; }

  target = next;

  if (next.mapId !== displayedMapId) {
    await loadMap(next.mapId, next.x, next.y);
    // onMapLoaded has cleared target; restore it if GMCP hasn't confirmed arrival yet
    if (next.mapId !== 99 && current?.mapId !== next.mapId) target = next;
  } else {
    activeRenderer?.centerOn?.(next.x, next.y);
  }
  activeRenderer?.applyState(getState());
});

panel.on("target_clear", (frame) => {
  target = null;
  if (frame.snap && current && current.mapId === displayedMapId) {
    activeRenderer?.centerOn?.(current.x, current.y);
  }
  activeRenderer?.applyState(getState());
});

panel.on("library_overlay", (frame) => {
  libraryOverlay = frame;
  activeRenderer?.applyState(getState());
});

panel.on("library_position", async (frame) => {
  const next = { mapId: 47, x: frame.x, y: frame.y, short: null, roomId: null };
  if (mapDidChange(current, next)) {
    await loadMap(47, frame.x, frame.y);
  }
  lastKnownMapId = 47;
  current = next;
  activeRenderer?.applyLibraryPosition?.(frame.x, frame.y);
  activeRenderer?.applyState(getState());
  updateHeader();
});

panel.on("lspace", () => {
  lastKnownMapId = 47;
  current = null;
  target  = null;
  updateHeader();
});

panel.on("special_screen", (frame) => {
  current = null;
  stopLSpaceAnim();
  $lspace.hidden = true;
  showSpecialScreen(frame.name);
  $mapName.textContent = $specialTitle.textContent;
});

panel.post("ready", {});
```

- [ ] **Step 3: Run tests to verify no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add ui/mapper.js
git commit -m "feat(coordinator): refactor mapper.js to renderer-agnostic coordinator"
```

---

### Task 5: Settings — `plugin.toml` + `src/main.lua`

**Files:**
- Modify: `plugin.toml` — add `[settings.map_style]`
- Modify: `src/main.lua` — post `map_style` on ready; handle live change

**Interfaces:**
- Consumes: `panel.on("map_style", ...)` already wired in Task 4
- Produces: user-visible setting in the Mallard plugin settings panel; live renderer switching

- [ ] **Step 1: Add the setting to `plugin.toml`**

Add after the existing `[settings.walk_sound]` block:

```toml
[settings.map_style]
type        = "enum"
default     = "svg"
label       = "Map style"
description = "SVG vector maps or classic pixel art PNG maps from Quow's Cow Bar."
choices = [
  { value = "svg", label = "SVG (vector)"           },
  { value = "png", label = "PNG (classic pixel art)" },
]
```

- [ ] **Step 2: Post `map_style` on ready in `src/main.lua`**

In the `panel:on_message("ready", ...)` handler (around line 191), add after the existing `filters_data` post:

```lua
panel:post("map_style", { style = settings.get('map_style') or 'svg' })
```

The full handler after the change:
```lua
panel:on_message("ready", function()
  local zoom = storage.get('zoom')
  if type(zoom) == 'table' then panel:post('zoom_data', zoom) end
  local filters = storage.get('filters')
  if type(filters) == 'table' then panel:post('filters_data', filters) end
  panel:post("map_style", { style = settings.get('map_style') or 'svg' })
  if lib_in_lspace then
    ...
```

- [ ] **Step 3: Handle live setting changes in `src/main.lua`**

The `settings.on("change", ...)` handler at line ~535 currently does nothing. Replace it:

```lua
settings.on("change", function(key, new_val, _old)
  if key == 'map_style' then
    panel:post("map_style", { style = new_val })
  end
end)
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugin.toml src/main.lua
git commit -m "feat(settings): add map_style setting for SVG/PNG toggle"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Feature branch | Task 1 |
| Copy PNG assets | Task 1 |
| SvgRenderer with identical SVG behaviour | Task 2 |
| PngRenderer with canvas overlay | Task 3 |
| Click-to-room for PNG | Task 3 |
| `findNearestRoom` unit tests | Task 3 |
| Coordinator refactor | Task 4 |
| Conditional zoom UI (hide in PNG mode) | Task 4 |
| Conditional context menu (skip in PNG mode) | Task 4 |
| `map_style` panel event → `switchRenderer` | Task 4 |
| `plugin.toml` setting | Task 5 |
| Lua: post on ready + live change | Task 5 |

**Room data format** — the spec document incorrectly says `[cellSize, xpos, ypos, type]`. The actual `rooms.js` format (verified from `build-db.mjs`) is `[map_id, xpos, ypos, room_short]`. All code in this plan uses the correct indices.

**`onZoomReset` callback** — added to handle the `0` key in SVG renderer (center on current/target). Spec didn't mention this but it's required to preserve existing keyboard nav behaviour.

**`target = null` in `onMapLoaded`** — in the original `loadSvgMap`, target is cleared after the async import resolves. In this plan it's cleared in the `onMapLoaded` callback for the same timing guarantee.
