# Street Name Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `layer-streets` SVG group convention and a toggle button in the panel footer that shows/hides all street name labels across every map, with state persisted in `localStorage`.

**Architecture:** A CSS class `streets-hidden` on `:root` drives visibility via `#layer-streets { display:none }`. A button in the existing `.route-footer` toggles the class and writes `"0"`/`"1"` to `localStorage` key `"cowtography.streets"`. Because the class lives on `:root` it survives every SVG swap with no per-load code. JS reads the stored value on startup to restore the last state.

**Tech Stack:** Vanilla JS, CSS custom properties, `localStorage`, SVG groups.

## Global Constraints

- Button label: `streets` (plain text, lowercase)
- Button is the **first child** of `.route-footer` (left-aligned)
- Button class: `streets-toggle`
- `localStorage` key: `"cowtography.streets"`, values `"1"` (visible, default when absent) / `"0"` (hidden)
- Default state: **visible** (no class on `:root` when key is absent)
- CSS class on `:root`: `streets-hidden`
- SVG group id: `layer-streets`
- SVG group position: between `layer-rooms` and `layer-room-labels`
- No changes to any SVG files in this plan — the group is added manually by the author per-map
- Sync command after any SVG edit: `node scripts/sync-svg-js.mjs`
- No new test files — this is pure UI; verify visually in Mallard

---

### Task 1: Button HTML and CSS

Add the button to the footer and write all CSS — the static structure and styles, no JS behavior yet.

**Files:**
- Modify: `ui/mapper.html`
- Modify: `ui/mapper.css`

**Interfaces:**
- Produces: `.streets-toggle` button as first child of `.route-footer`; `:root.streets-hidden #layer-streets { display:none }` CSS rule

- [ ] **Step 1: Add button to `ui/mapper.html`**

Open `ui/mapper.html`. The current footer is:

```html
  <footer class="route-footer">
    <span class="route-dest"></span>
    <button class="route-walk" type="button" hidden>walk</button>
    <button class="route-clear" type="button" title="Clear route" hidden>✕</button>
  </footer>
```

Change it to:

```html
  <footer class="route-footer">
    <button class="streets-toggle" type="button">streets</button>
    <span class="route-dest"></span>
    <button class="route-walk" type="button" hidden>walk</button>
    <button class="route-clear" type="button" title="Clear route" hidden>✕</button>
  </footer>
```

- [ ] **Step 2: Add CSS to `ui/mapper.css`**

Append to the end of `ui/mapper.css`:

```css

/* ─── Street name layer ────────────────────────────────────────────────────── */
:root.streets-hidden #layer-streets { display: none; }

.streets-toggle {
  height: 18px;
  padding: 0 5px;
  background: color-mix(in srgb, var(--fg, #ddd) 20%, transparent);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  flex: 0 0 auto;
}
.streets-toggle:hover { background: color-mix(in srgb, var(--fg, #ddd) 30%, transparent); }
.streets-toggle.off   { background: color-mix(in srgb, var(--fg, #ddd) 10%, transparent); }
.streets-toggle.off:hover { background: color-mix(in srgb, var(--fg, #ddd) 20%, transparent); }
```

The button has no `.off` class by default (streets visible = active/elevated). When streets are hidden the JS will add `.off`.

- [ ] **Step 3: Verify visually**

Open `ui/mapper.html` in a browser (or reload in Mallard). Confirm:
- "streets" button appears at the left of the footer
- Button has a slightly elevated background (active state)
- Route text and walk/clear buttons are still right-aligned

- [ ] **Step 4: Commit**

```bash
git add ui/mapper.html ui/mapper.css
git commit -m "feat(streets): button HTML and CSS, layer-streets visibility rule"
```

---

### Task 2: JS wiring — localStorage init and click handler

Wire up the button: read `localStorage` on startup to restore state, and toggle the class + persist on each click.

**Files:**
- Modify: `ui/mapper.js`

**Interfaces:**
- Consumes: `.streets-toggle` button (Task 1), `streets-hidden` CSS class on `:root` (Task 1)

- [ ] **Step 1: Add DOM ref for the toggle button**

`ui/mapper.js` has a DOM refs block at lines 8–20:

```js
// ─── DOM refs ─────────────────────────────────────────────────────────────
const $mapName      = document.querySelector(".map-name");
const $container    = document.querySelector(".map-container");
const $lspace       = document.querySelector(".lspace-overlay");
const $special      = document.querySelector(".special-screen");
const $specialTitle = $special.querySelector(".special-title");
const $specialSub   = $special.querySelector(".special-sub");
const $zoomIn       = document.querySelector(".zoom-in");
const $zoomOut      = document.querySelector(".zoom-out");
const $footer     = document.querySelector(".route-footer");
const $routeDest  = document.querySelector(".route-dest");
const $routeWalk  = document.querySelector(".route-walk");
const $routeClear = document.querySelector(".route-clear");
```

Add one line after `$routeClear`:

```js
const $streetsToggle = document.querySelector(".streets-toggle");
```

- [ ] **Step 2: Add init function and wire click handler**

Find the `applyThemeClass` block (lines 24–32):

```js
function applyThemeClass() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const m  = bg.match(/^#([0-9a-f]{2})/i);
  document.documentElement.classList.toggle('light-bg', m ? parseInt(m[1], 16) >= 128 : false);
}
new MutationObserver(applyThemeClass).observe(
  document.documentElement, { attributes: true, attributeFilter: ['style'] }
);
applyThemeClass();
```

Add the streets init immediately after `applyThemeClass()`:

```js
function applyStreetsState(visible) {
  document.documentElement.classList.toggle('streets-hidden', !visible);
  $streetsToggle.classList.toggle('off', !visible);
}
const _streetsStored = localStorage.getItem('cowtography.streets');
applyStreetsState(_streetsStored !== '0');

$streetsToggle.addEventListener('click', () => {
  const nowVisible = document.documentElement.classList.contains('streets-hidden');
  applyStreetsState(nowVisible);
  localStorage.setItem('cowtography.streets', nowVisible ? '1' : '0');
});
```

`localStorage.getItem` returns `null` when the key is absent — the default branch `!== '0'` treats both `null` and `"1"` as visible. ✓

- [ ] **Step 3: Verify behavior in Mallard**

Load a map that has a `layer-streets` group with at least one `<text>` element (add one to any SVG temporarily for testing, run `node scripts/sync-svg-js.mjs`, then reload):

1. On first load (no localStorage entry): button appears elevated ("on"), street names visible.
2. Click button: button turns dim ("off"), street names disappear.
3. Reload plugin: button stays dim, street names still hidden (state restored from localStorage).
4. Click again: button elevated ("on"), street names reappear.
5. Navigate to another map: toggle state unchanged (class on `:root` persists).

- [ ] **Step 4: Commit**

```bash
git add ui/mapper.js
git commit -m "feat(streets): localStorage init and click handler for streets toggle"
```
