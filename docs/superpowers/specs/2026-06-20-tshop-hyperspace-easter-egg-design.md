# Tshop Hyperspace Easter Egg — Design Spec

**Date:** 2026-06-20
**Status:** Approved

## Overview

Add an animated hyperspace starfield background to `tshop.svg` as a hidden easter egg for players who find the travelling shop. Stars streak outward from a central anchor point between the two rooms, giving the feeling of travelling through time and space. Rooms remain clearly visible on top of the effect.

## Context

`tshop.svg` (map ID 53) contains exactly two rooms:
- `04fd563a7f8d4ccfc83661bbec60971ac9aa72ca` — "front of a travelling shop" at `x=351, y=312`
- `7e727e52d2794b8c5261c5b5daf184231c0ecafe` — "small room containing the multiverse" at `x=384, y=287`

The map has a 750×600 viewBox but will be viewed zoomed in due to only having two rooms. The `layer-artwork` group is currently empty. The SVG is loaded via `innerHTML` in `mapper.js`, so CSS `@keyframes` in an inline `<style>` block work correctly.

## Approach

Pure SVG with CSS `@keyframes` — self-contained in `tshop.svg`, no changes to `mapper.js` or `mapper.css`.

## Structure

Two additions to `tshop.svg`:

**1. Style block** — added alongside the existing `inkscape-font-fix` style:
```xml
<style id="hs-anim">
  .hs-streak {
    stroke: var(--fg);
    stroke-linecap: round;
    stroke-dasharray: 220 220;
    animation: hs-fly 1.5s linear infinite;
  }
  @keyframes hs-fly {
    0%   { stroke-dashoffset: 220; opacity: 0; }
    8%   { opacity: 0.75; }
    80%  { opacity: 0.65; }
    100% { stroke-dashoffset: 0; opacity: 0; }
  }
</style>
```

**2. Hyperspace group** — inside `layer-artwork`:
```xml
<g id="layer-hyperspace">
  <!-- 36 line elements -->
</g>
```

## Geometry

- **Anchor:** `(371, 304)` — midpoint between the two rooms
- **Lines:** 36 total, one every 10° (0°–350°)
- **Length:** all exactly 220px — `x1/y1` at anchor, `x2/y2 = (371 + 220·cosθ, 304 + 220·sinθ)`
- **Stroke widths:** cycle through 0.4 / 0.7 / 1.1px across the 36 lines (simulates depth — thin = distant)

## Animation

The `stroke-dasharray: 220 220` + `stroke-dashoffset` approach draws each streak growing outward from the anchor:
- `stroke-dashoffset: 220` → dash offset places it past the line end → invisible
- `stroke-dashoffset: 0` → dash covers the full line from anchor to tip → fully visible

**Opacity envelope:** fades in fast (0→0.75 over first 8%), holds steady through most of the animation, fades out at the end (→0 at 100%).

**Stagger:** each line's `animation-delay = (i / 36) × 1.5s`, spreading all 36 lines uniformly across one full cycle so every animation phase is always represented simultaneously.

**Duration:** 1.5s, `linear`, `infinite`.

## Colour

`stroke: var(--fg)` on all streaks. No hardcoded colour — works on both light and dark themes.

## Layering

`layer-artwork` (and thus `layer-hyperspace`) renders before `layer-rooms` in SVG paint order, so streaks are naturally behind the room rectangles. No z-index or pointer-events changes needed.

## Files Changed

- `ui/maps/tshop.svg` — style block + hyperspace group in artwork layer
- `ui/maps/tshop.js` — regenerated via `sync:svg` script
