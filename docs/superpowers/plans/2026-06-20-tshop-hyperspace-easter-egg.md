# Tshop Hyperspace Easter Egg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CSS-animated hyperspace starfield background to `tshop.svg` that streaks outward from the center point between the two rooms.

**Architecture:** 36 SVG `<line>` elements in a dedicated `<g id="layer-hyperspace">` inside `layer-artwork`, animated entirely via CSS `@keyframes` in an inline `<style>` block. No JS changes. The SVG paint order keeps streaks behind rooms naturally.

**Tech Stack:** SVG, CSS `@keyframes`, `stroke-dasharray`/`stroke-dashoffset` animation. Sync via `npm run sync:svg`.

## Global Constraints

- All streaks use `stroke: var(--fg)` — no hardcoded colours
- `layer-hyperspace` group lives inside `layer-artwork`, which renders before `layer-rooms`
- No changes to `mapper.js`, `mapper.css`, or any file other than `tshop.svg` + its generated `tshop.js`
- Sync step is always `node scripts/sync-svg-js.mjs` (syncs all SVGs, not just tshop)

---

### Task 1: Add hyperspace animation to tshop.svg and sync

**Files:**
- Modify: `ui/maps/tshop.svg`
- Regenerate: `ui/maps/tshop.js` (via sync script — do not edit manually)

**How the animation works:**

Each streak is a `<line>` from anchor `(371, 304)` to an outer point 220px away at a given angle. `stroke-dasharray: 220 220` sets up a single dash equal to the line length. Animating `stroke-dashoffset` from `220` (dash pushed past the line end → invisible) down to `0` (dash covers the full line from anchor outward) draws the streak growing from center to tip. Negative `animation-delay` makes the animation appear already in progress when the map loads.

**Opacity envelope:** fades in fast (0→0.75 over first 8%), holds, fades out at end (→0 at 100%).

**Stroke widths cycle:** 0.4 / 0.7 / 1.1px across the 36 lines to simulate depth.

- [ ] **Step 1: Replace tshop.svg with the complete new content**

Write the following as the entire content of `ui/maps/tshop.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 750 600"
     class="map-svg"
     data-map-id="53">

  <style id="hs-anim">
    .hs-streak {
      stroke: var(--fg);
      stroke-linecap: round;
      stroke-dasharray: 220 220;
      fill: none;
      animation: hs-fly 1.5s linear infinite;
      animation-fill-mode: backwards;
    }
    @keyframes hs-fly {
      0%   { stroke-dashoffset: 220; opacity: 0; }
      8%   { opacity: 0.75; }
      80%  { opacity: 0.65; }
      100% { stroke-dashoffset: 0; opacity: 0; }
    }
  </style>

  <g id="layer-artwork">
    <g id="layer-hyperspace">
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:0s"      x1="371" y1="304" x2="591.0" y2="304.0"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-0.042s" x1="371" y1="304" x2="587.7" y2="342.2"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-0.083s" x1="371" y1="304" x2="577.7" y2="379.2"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-0.125s" x1="371" y1="304" x2="561.5" y2="414.0"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-0.167s" x1="371" y1="304" x2="539.5" y2="445.4"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-0.208s" x1="371" y1="304" x2="512.4" y2="472.5"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-0.25s"  x1="371" y1="304" x2="481.0" y2="494.5"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-0.292s" x1="371" y1="304" x2="446.2" y2="510.7"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-0.333s" x1="371" y1="304" x2="409.2" y2="520.7"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-0.375s" x1="371" y1="304" x2="371.0" y2="524.0"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-0.417s" x1="371" y1="304" x2="332.8" y2="520.7"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-0.458s" x1="371" y1="304" x2="295.8" y2="510.7"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-0.5s"   x1="371" y1="304" x2="261.0" y2="494.5"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-0.542s" x1="371" y1="304" x2="229.6" y2="472.5"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-0.583s" x1="371" y1="304" x2="202.5" y2="445.4"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-0.625s" x1="371" y1="304" x2="180.5" y2="414.0"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-0.667s" x1="371" y1="304" x2="164.3" y2="379.2"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-0.708s" x1="371" y1="304" x2="154.3" y2="342.2"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-0.75s"  x1="371" y1="304" x2="151.0" y2="304.0"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-0.792s" x1="371" y1="304" x2="154.3" y2="265.8"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-0.833s" x1="371" y1="304" x2="164.3" y2="228.8"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-0.875s" x1="371" y1="304" x2="180.5" y2="194.0"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-0.917s" x1="371" y1="304" x2="202.5" y2="162.6"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-0.958s" x1="371" y1="304" x2="229.6" y2="135.5"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-1s"     x1="371" y1="304" x2="261.0" y2="113.5"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-1.042s" x1="371" y1="304" x2="295.8" y2="97.3"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-1.083s" x1="371" y1="304" x2="332.8" y2="87.3"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-1.125s" x1="371" y1="304" x2="371.0" y2="84.0"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-1.167s" x1="371" y1="304" x2="409.2" y2="87.3"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-1.208s" x1="371" y1="304" x2="446.2" y2="97.3"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-1.25s"  x1="371" y1="304" x2="481.0" y2="113.5"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-1.292s" x1="371" y1="304" x2="512.4" y2="135.5"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-1.333s" x1="371" y1="304" x2="539.5" y2="162.6"/>
      <line class="hs-streak" stroke-width="0.4" style="animation-delay:-1.375s" x1="371" y1="304" x2="561.5" y2="194.0"/>
      <line class="hs-streak" stroke-width="0.7" style="animation-delay:-1.417s" x1="371" y1="304" x2="577.7" y2="228.8"/>
      <line class="hs-streak" stroke-width="1.1" style="animation-delay:-1.458s" x1="371" y1="304" x2="587.7" y2="265.8"/>
    </g>
  </g>

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

- [ ] **Step 2: Visually verify the SVG in a browser**

Open `ui/maps/tshop.svg` directly in a browser (Firefox or Chrome). You should see:
- 36 lines radiating outward from roughly the center of the canvas
- Each line animates from invisible at center → full streak → fade out, continuously looping
- All 36 streaks are staggered so the field looks active immediately on load, no ramp-up
- The two room rectangles (around coords 351,312 and 384,287) are visible on top of the streaks

If streaks are not visible, check that `var(--fg)` is resolving — in a plain SVG file outside Mallard, `--fg` may not be set. You can temporarily hardcode `stroke="#ffffff"` or `stroke="#000000"` to verify geometry, then revert.

- [ ] **Step 3: Sync to tshop.js**

```bash
node scripts/sync-svg-js.mjs
```

Expected output includes `synced  tshop.svg` in the list. The file `ui/maps/tshop.js` is regenerated.

- [ ] **Step 4: Commit**

```bash
git add ui/maps/tshop.svg ui/maps/tshop.js
git commit -m "feat(tshop): hyperspace starfield easter egg"
```
