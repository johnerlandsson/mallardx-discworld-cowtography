# Room Type Indicators & In-Room Annotations — Design Spec

## Overview

Two related features:

1. **Room type indicators** — automated coloured fills with a letter inside room shapes to convey room purpose (shop, bank, player-owned, etc.) inspired by Quow's cowbar map conventions.
2. **In-room Inkscape annotations** — a new preserved SVG layer and workflow for placing hand-crafted text inside room circles/squares in Inkscape.

---

## 1. Global stroke change

All rooms get `stroke-width: 0.5` (down from the current `1.62`). This applies to both plain rooms and typed rooms.

**File:** `ui/mapper.css`

```css
/* was stroke-width: 1.62 */
.room { fill: var(--bg); stroke: var(--fg); stroke-width: 0.5; }
```

---

## 2. Room type categories

Fifteen types in four colour groups. Letter fill is always `#eaeaea` (all type fills are dark).

| Letter | CSS class | Fill colour | Group | Detection |
|--------|-----------|-------------|-------|-----------|
| S | `.room-shop` | `#1c5c3a` dark green | Shop | Auto — shop_items, no sub-type match |
| W | `.room-weapon` | `#1c5c3a` | Shop | Auto — item_name keyword |
| A | `.room-armour` | `#1c5c3a` | Shop | Auto — item_name keyword |
| C | `.room-clothes` | `#1c5c3a` | Shop | Auto — item_name keyword |
| F | `.room-food` | `#1c5c3a` | Shop | Auto — item_name keyword |
| X | `.room-access` | `#1c5c3a` | Shop | Auto — item_name keyword |
| $ | `.room-bank` | `#5c3000` dark orange | Service | Manual JSON |
| ! | `.room-mission` | `#5c3000` | Service | Manual JSON |
| O | `.room-post` | `#5c3000` | Service | Manual JSON |
| L | `.room-lang` | `#5c3000` | Service | Manual JSON |
| K | `.room-crafts` | `#1a4a28` dark green | Special | Manual JSON |
| H | `.room-house` | `#3d1e08` brown | Player | Manual JSON |
| G | `.room-club` | `#1a1a4a` navy | Player | Manual JSON |
| P | `.room-pshop` | `#3a0838` magenta | Player | Manual JSON |
| T | `.room-tshop` | `#080808` near-black | Special | Manual JSON |

---

## 3. CSS additions

**File:** `ui/mapper.css`

```css
.room-type-label {
  font-family: "Noto Sans", sans-serif;
  font-size: 4.5px;
  font-weight: bold;
  fill: #eaeaea;
  pointer-events: none;
}

.room-shop, .room-weapon, .room-armour,
.room-clothes, .room-food, .room-access  { fill: #1c5c3a; }
.room-bank, .room-mission,
.room-post, .room-lang                   { fill: #5c3000; }
.room-crafts                             { fill: #1a4a28; }
.room-house                              { fill: #3d1e08; }
.room-club                               { fill: #1a1a4a; }
.room-pshop                              { fill: #3a0838; }
.room-tshop                              { fill: #080808; }
```

Also update the `FONT_STYLE_BLOCK` in `scripts/sync-svg-js.mjs` to include `.room-type-label`.

---

## 4. Auto-detection (build-svg.mjs)

### DB query

```sql
SELECT si.room_id, si.item_name
FROM shop_items si
JOIN rooms r ON si.room_id = r.room_id
WHERE r.map_id = ?
```

### Sub-type keyword matching (case-insensitive substring, applied to `item_name`)

| Type | Keywords |
|------|----------|
| weapon | sword, axe, dagger, crossbow, bolt, spear, mace, flail, whip, lance |
| armour | armour, armor, shield, helm, mail, chainmail, breastplate, gauntlet |
| clothes | coat, cloak, robe, gown, jacket, dress, shirt, trouser, skirt, shoe, boot, hat, wig |
| food | cake, pie, bread, meat, ale, beer, wine, cheese, soup, stew |
| access | ring, bracelet, necklace, earring, gem, jewel, brooch, pendant |

**Per-room resolution:** count keyword matches per sub-type across all items sold in that room. Highest count wins. Ties → generic `shop` (S). A room in `shop_items` but with zero keyword matches also becomes generic `shop`.

### Manual override

**File:** `ui/data/room-types.json`

```json
{
  "<room_id>": "<type-string>"
}
```

Ships as `{}`. Populated by hand as new areas are annotated. Valid type strings: `shop`, `weapon`, `armour`, `clothes`, `food`, `access`, `bank`, `mission`, `post`, `lang`, `crafts`, `house`, `club`, `pshop`, `tshop`.

Manual overrides take precedence over keyword heuristics.

### Implementation in build-svg.mjs

New function `getShopTypes(db, mapId, manualOverrides)`:
- Returns `Map<roomId, typeString>`
- Runs the query above, applies keyword heuristics, then merges manual overrides

`roomElement(room, exitDirs, type)` gains optional `type` param:
- When present: adds `room-<type>` class to room shape element
- Adds a `<text class="room-type-label">` element immediately after the shape (inline in `layer-rooms`, so it renders on top of the fill)

### SVG output per typed room

Outdoor (circle):
```svg
<circle id="room-XXXX" class="room outdoor room-weapon" cx="100" cy="100" r="4"/>
<text class="room-type-label" x="100" y="100" text-anchor="middle" dominant-baseline="central">W</text>
```

Indoor (rect, centered at cx/cy):
```svg
<rect id="room-XXXX" class="room indoor room-bank" x="96" y="96" width="8" height="8"/>
<text class="room-type-label" x="100" y="100" text-anchor="middle" dominant-baseline="central">$</text>
```

---

## 5. New `layer-room-labels` SVG layer

### Why

Current layer order in generated SVGs:
```
layer-artwork      → renders first (behind everything) — correct, used for background art e.g. am_uu.svg library floorplan
layer-exits        → generated exit lines
layer-rooms        → generated room shapes
layer-labels       → generated map text labels
```

`layer-artwork` renders behind rooms, so Inkscape elements placed there are obscured by room fills. Placing in-room annotation text in `layer-artwork` does not work.

### Solution

Add a new `layer-room-labels` layer after `layer-rooms`:

```
layer-artwork       (preserved — background illustrations)
layer-exits         (generated)
layer-rooms         (generated)
layer-room-labels   (NEW — preserved — hand-crafted in-room annotations)
layer-labels        (generated)
```

Elements in `layer-room-labels` render on top of room fills (correct) and under map text labels (acceptable).

### Changes required

**`scripts/build-svg.mjs`:**
- Add `<g id="layer-room-labels"></g>` to SVG template between `layer-rooms` and `layer-labels`
- Add preserve-regex alongside the existing `layer-artwork` preserve, so re-running `build:svg` keeps hand-crafted content

**`scripts/sync-svg-js.mjs`:**
- Extract and preserve `layer-room-labels` content in the JS module (same mechanism as `layer-artwork`)
- When injecting back, restore `layer-room-labels` content

---

## 6. Annotation guide additions

**File:** `docs/annotation-guide.md`

Add a new section: **Placing custom annotations inside room shapes**.

Contents:
- Identify the correct layer: `layer-room-labels` (renders on top of rooms, preserved across `build:svg` runs)
- How to find a room's center coordinates: open the generated SVG in a text editor, search for the room's `id` attribute to find `cx`/`cy` (circle) or compute center from `x`/`y`/`width`/`height` (rect)
- Recommended text element attributes:
  - `text-anchor="middle"` `dominant-baseline="central"` — centers the glyph on the coordinates
  - `font-size="4.5"` — fits inside r=4 circle; use `4` for rects if needed
  - `font-weight="bold"`
  - `fill="#eaeaea"` for typed rooms (dark fill); use `fill="var(--fg)"` or class `.map-label` for untyped plain rooms
  - Optional: `class="room-type-label"` applies all of the above via CSS
- Note: in Inkscape, place the text element in the `layer-room-labels` layer. If the layer doesn't appear yet, run `npm run build:svg` once to regenerate the SVG with the new layer.

---

## 7. Scope boundaries

**Not in scope:**
- Changing room radius (stays at r=4)
- Adding a map legend / key UI
- Any per-player customisation of type colours
- Retroactively annotating all existing maps with manual types — this is done incrementally as maps are edited

**Deferred:**
- Light-theme legibility of type fill colours (all fills are dark and readable on the dark theme; light theme support can be added later via CSS variables if needed)
