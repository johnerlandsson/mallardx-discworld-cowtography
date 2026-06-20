# Tshop Hyperspace Easter Egg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a canvas-driven hyperspace particle animation behind the two rooms on the tshop map (map ID 53) — particles spawn at the centre between the rooms and race outward as accelerating dashes.

**Architecture:** A canvas element injected behind the SVG when map 53 loads, driven by `requestAnimationFrame` in `mapper.js`. Particles are drawn in canvas coordinates derived from the SVG's current `getScreenCTM()` transform, so they stay aligned through pan/zoom. The canvas self-terminates when it is disconnected from the DOM (map change).

**Tech Stack:** Canvas 2D API, `requestAnimationFrame`, `SVGElement.getScreenCTM()`, CSS `var(--fg)` read via `getComputedStyle`.

## Global Constraints

- Canvas uses `getComputedStyle(document.documentElement).getPropertyValue("--fg")` for stroke colour — no hardcoded colours
- Canvas sits at `position:absolute; inset:0; pointer-events:none; z-index:-1` inside the wrap div (z-index:-1 is required because `.map-svg` is `display:block`/non-positioned and would otherwise paint above a position:absolute canvas)
- No changes to any file except `mapper.js`, `tshop.svg`, and the generated `tshop.js`
- `tshop.svg` must be restored to a clean state (no CSS animation remnants from the previous attempt)
- Sync step is always `node scripts/sync-svg-js.mjs`

---

### Task 1: Revert tshop.svg to clean state and sync

**Files:**
- Modify: `ui/maps/tshop.svg`
- Regenerate: `ui/maps/tshop.js` (via sync script)

- [ ] **Step 1: Restore tshop.svg to its clean pre-animation state**

Write the following as the entire content of `ui/maps/tshop.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 750 600"
     class="map-svg"
     data-map-id="53">

  <g id="layer-artwork"><!-- artwork --></g>

  <g id="layer-exits">
    null
  </g>

  <g id="layer-rooms">
    <rect id="room-04fd563a7f8d4ccfc83661bbec60971ac9aa72ca" class="room indoor room-armour" data-label="front of a travelling shop" x="351" y="312" width="8" height="8" rx="2"/><text class="room-type-label" font-size="4.5" x="355" y="316" text-anchor="middle" dominant-baseline="central">A</text>
    <rect id="room-7e727e52d2794b8c5261c5b5daf184231c0ecafe" class="room indoor" data-label="small room containing the multiverse" x="384" y="287" width="8" height="8" rx="2"/><polygon class="stair-symbol" points="388,294 385.5,289 390.5,289"/>
  </g>


  <g id="layer-room-labels"></g>
  <g id="layer-labels"><!-- labels --></g>

</svg>
```

- [ ] **Step 2: Sync**

```bash
node scripts/sync-svg-js.mjs
```

Expected: `synced  tshop.svg` in output.

- [ ] **Step 3: Commit**

```bash
git add ui/maps/tshop.svg ui/maps/tshop.js
git commit -m "revert(tshop): remove CSS hyperspace attempt, restore clean svg"
```

---

### Task 2: Add canvas particle hyperspace animation to mapper.js

**Files:**
- Modify: `ui/mapper.js`

**How the particle system works:**

Each particle has `{ angle, dist, speed }` in SVG-user-unit space. Every frame:
- `speed *= HS_ACCEL` — exponential acceleration gives the hyperspace "rushing outward" feel
- `dist += speed` — move outward
- Trail drawn from prev position to current position using `getScreenCTM()` to convert SVG coords to canvas pixels
- Opacity fades in over first 15 SVG units, fades out from `HS_FADE_OUT` to `HS_MAX_DIST`
- `lineWidth = max(0.5, speed * ctm.a * 0.4)` — dashes get thicker as they accelerate
- Particle removed when `dist >= HS_MAX_DIST`

`getScreenCTM()` returns the SVG-user-units → screen-pixel matrix. Subtracting `canvas.getBoundingClientRect().left/top` converts to canvas-relative pixels.

The canvas self-terminates: if `!canvas.isConnected` at the top of the RAF callback, it sets `tshopAnim = null` and returns — no explicit cleanup call needed on map change, but `stopTshopAnim()` is also called from `clearContainer()` to cancel the RAF immediately rather than waiting for the next frame.

- [ ] **Step 1: Add state variable and constants after the existing `let lspaceAnim = null;` line**

In `ui/mapper.js`, find:
```js
let lspaceAnim     = null;  // requestAnimationFrame id for L-space bouncer
```

Add immediately after:
```js
let tshopAnim      = null;  // requestAnimationFrame id for tshop hyperspace canvas
```

- [ ] **Step 2: Add startTshopAnim and stopTshopAnim functions**

Find the `stopLSpaceAnim` function and add the two new functions immediately after it:

```js
function stopLSpaceAnim() {
  if (lspaceAnim === null) return;
  cancelAnimationFrame(lspaceAnim);
  lspaceAnim = null;
}
```

Add after the closing brace:

```js
function startTshopAnim(svgEl, wrapEl) {
  stopTshopAnim();
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:-1;";
  wrapEl.insertBefore(canvas, wrapEl.firstChild);
  const particles = [];
  const CX = 371, CY = 304;
  const HS_MAX = 80, HS_SPAWN = 0.35, HS_ACCEL = 1.015;
  const HS_FADE_OUT = 180, HS_MAX_DIST = 220;

  function frame() {
    if (!canvas.isConnected) { tshopAnim = null; return; }
    tshopAnim = requestAnimationFrame(frame);
    const cw = canvas.offsetWidth, ch = canvas.offsetHeight;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, cw, ch);
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return;
    const cr = canvas.getBoundingClientRect();
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#ffffff";
    if (particles.length < HS_MAX && Math.random() < HS_SPAWN) {
      particles.push({ angle: Math.random() * Math.PI * 2, dist: 0, speed: 0.15 + Math.random() * 0.25 });
    }
    ctx.strokeStyle = fg;
    ctx.lineCap = "round";
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const prev = p.dist;
      p.speed *= HS_ACCEL;
      p.dist  += p.speed;
      if (p.dist >= HS_MAX_DIST) { particles.splice(i, 1); continue; }
      const opacity = p.dist < 15
        ? p.dist / 15
        : p.dist > HS_FADE_OUT
          ? 1 - (p.dist - HS_FADE_OUT) / (HS_MAX_DIST - HS_FADE_OUT)
          : 1;
      const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
      ctx.globalAlpha = opacity * 0.75;
      ctx.lineWidth   = Math.max(0.5, p.speed * ctm.a * 0.4);
      ctx.beginPath();
      ctx.moveTo((CX + cos * prev)   * ctm.a + ctm.e - cr.left, (CY + sin * prev)   * ctm.d + ctm.f - cr.top);
      ctx.lineTo((CX + cos * p.dist) * ctm.a + ctm.e - cr.left, (CY + sin * p.dist) * ctm.d + ctm.f - cr.top);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  tshopAnim = requestAnimationFrame(frame);
}

function stopTshopAnim() {
  if (tshopAnim === null) return;
  cancelAnimationFrame(tshopAnim);
  tshopAnim = null;
}
```

- [ ] **Step 3: Call stopTshopAnim from clearContainer**

Find in `ui/mapper.js`:
```js
function clearContainer() {
  for (const child of [...$container.children]) {
```

Change to:
```js
function clearContainer() {
  stopTshopAnim();
  for (const child of [...$container.children]) {
```

- [ ] **Step 4: Start the animation when map 53 loads**

In `loadSvgMap`, find the line:
```js
  $container.insertBefore(wrap, $lspace);
```

Add immediately after:
```js
  if (mapId === 53) startTshopAnim(currentSvg, wrap);
```

- [ ] **Step 5: Verify visually**

Open `ui/maps/tshop.svg` in a browser — the rooms are visible but `--fg` won't resolve so the canvas will be blank. To verify the canvas is working, temporarily add `stroke="#000"` as fallback to `startTshopAnim` (change the `|| "#ffffff"` to `|| "#000000"`), load the tshop map in the Mallard plugin, and confirm you see particles radiating from the centre between the two rooms. Revert the fallback if you changed it.

If the Mallard plugin is not available, inspect the canvas element in devtools to confirm it is inserted before the SVG in the wrap div and has non-zero width/height.

- [ ] **Step 6: Commit**

```bash
git add ui/mapper.js
git commit -m "feat(tshop): canvas hyperspace particle animation"
```
