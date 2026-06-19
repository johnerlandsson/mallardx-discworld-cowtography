# Map Data Configuration Guide

Configuration for room appearance. These files live in `ui/data/` and are read by `npm run build:svg` each time you rebuild the maps. Changes take effect on the next rebuild — no Inkscape work required.

---

## room-types.json

**File:** `ui/data/room-types.json`

Overrides or supplements the auto-detected room type for specific rooms. Use it for types that cannot be auto-detected (`mission`, `post`, `lang`, `crafts`, `tshop`), or to correct a mis-classified room.

**Format:**

```json
{
  "<room_id>": "<type>"
}
```

**Finding a room ID:** Open the generated SVG in a text editor and search for the room's short name (it's in the `data-label` attribute). The element's `id` attribute is `room-<room_id>`, so strip the `room-` prefix.

**Valid types and how each is detected:**

| Type | Letter | Colour | Detection |
|------|--------|--------|-----------|
| `shop` | S | dark green | Auto — `shop_items` table, no sub-type keyword match or tie |
| `weapon` | W | dark green | Auto — `shop_items` item name keywords |
| `armour` | A | dark green | Auto — `shop_items` item name keywords |
| `clothes` | C | dark green | Auto — `shop_items` item name keywords |
| `food` | F | dark green | Auto — `shop_items` item name keywords |
| `access` | X | dark green | Auto — `shop_items` item name keywords |
| `bank` | $ | dark orange | Auto — `room_short` matches `%Bing%bank%` or `%Coop%bank%` |
| `house` | H | brown | Auto — `room_short` is `[player house]` |
| `pshop` | P | magenta | Auto — `room_short` is `[player shop]` |
| `club` | G | navy | Auto — `room_short` is `[player club]` |
| `mission` | ! | dark orange | Manual only |
| `post` | O | dark orange | Manual only |
| `lang` | L | dark orange | Manual only |
| `crafts` | K | dark green (muted) | Manual only |
| `tshop` | T | near-black | Manual only |
| `temple` | R | dark purple | Manual only |

**Priority:** `shop_items` keywords → `room_short` patterns → `room-types.json` (always wins).

**Example:**

```json
{
  "bf24b19be09309ecb42f26836b36eaaf9246c49c": "mission",
  "a1c3e5f7b9d2e4f6a8c0e2f4b6d8e0f2a4c6e8f0": "post"
}
```

---

## room-compact.json

**File:** `ui/data/room-compact.json`

Marks rooms that should render at half size — `r=2` circle (down from `r=4`) or `4×4` rect (down from `8×8`). Use this for tight corridors, narrow alleys, and other areas where full-size room shapes crowd or overlap.

Compact rooms are slightly transparent (`opacity: 0.7`) to further reduce visual weight.

**Format:**

```json
["<room_id>", "<room_id>", ...]
```

**Finding a room ID:** Same as for `room-types.json` — search the SVG for the room's `data-label`, then read the `id` attribute and strip the `room-` prefix.

**Example:**

```json
[
  "a3f1c2d4e5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c0",
  "1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c"
]
```

**Notes:**

- Compact rooms can still have a type (from `room-types.json`) — the type letter will render at the same position but inside the smaller shape. In practice, tight corridors rarely have shops, so this combination is uncommon.
- Compact rooms still show stair indicators if the room has vertical exits.
- Rebuild with `npm run build:svg && npm run sync:svg` after editing.

---

## room-green.json

**File:** `ui/data/room-green.json`

Marks rooms that are in a green/natural area (parks, forests, countryside). Green rooms render with a dark green fill and green stroke (`.room.green`); exits between two green rooms get a muted green stroke (`.exit-green`).

**Format:**

```json
["<room_id>", "<room_id>", ...]
```

**Finding room IDs:** Same as `room-compact.json` — search the SVG for the room's `data-label`, read the `id` attribute, strip the `room-` prefix. Or use `dbid` in-game.

**Notes:**

- An exit only gets `.exit-green` colouring when **both** endpoints are in `room-green.json`.
- Green rooms can still carry a type from `room-types.json`.
- Rebuild with `npm run build:svg && npm run sync:svg` after editing.

---

## room-water.json

**File:** `ui/data/room-water.json`

Marks rooms that are on or near water (rivers, docks, boats). Water rooms render with a dark blue fill and blue stroke (`.room.water`); exits between two water rooms get a blue stroke (`.exit-water`).

**Format:**

```json
["<room_id>", "<room_id>", ...]
```

**Finding room IDs:** Same as `room-compact.json` — search the SVG for the room's `data-label`, read the `id` attribute, strip the `room-` prefix. Or use `dbid` in-game.

**Notes:**

- An exit only gets `.exit-water` colouring when **both** endpoints are in `room-water.json`.
- Water rooms can still carry a type from `room-types.json`.
- Rebuild with `npm run build:svg && npm run sync:svg` after editing.

---

## room-danger.json

**File:** `ui/data/room-danger.json`

Marks rooms that are in a dangerous area. Danger rooms render with a dark red fill and red stroke (`.room.danger`); exits between two danger rooms get a darker red stroke (`.exit-danger`).

**Format:**

```json
["<room_id>", "<room_id>", ...]
```

**Finding room IDs:** Same as `room-compact.json` — search the SVG for the room's `data-label`, read the `id` attribute, strip the `room-` prefix. Alternatively, use the `dbid` alias in-game to print IDs as you walk the area.

**Example:**

```json
[
  "a3f1c2d4e5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c0",
  "1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c"
]
```

**Notes:**

- An exit only gets `.exit-danger` colouring when **both** endpoints are in `room-danger.json`.
- Danger rooms can still carry a type from `room-types.json` — the type letter renders inside the red room shape.
- For red warning text in hand-crafted SVG labels, use the `map-label-warning` CSS class (see annotation guide).
- Rebuild with `npm run build:svg && npm run sync:svg` after editing.

---

## exit-exclude.json

**File:** `ui/data/exit-exclude.json`

Prevents specific DB exits from being auto-generated in `layer-exits`. Use this when you have drawn a custom exit manually in `layer-artwork` and don't want the auto-generated straight line to also appear.

**Format:**

```json
["<exit_id>", "<exit_id>", ...]
```

Exit IDs have the form `edge-<roomA>-<roomB>` where the two room IDs are sorted alphabetically. The easiest way to find an exit ID is to open the generated SVG in a text editor and search for one of the two room IDs — the connected `<line>` elements nearby will have the ID you need.

**Example:**

```json
[
  "edge-3f14d1d1c945d44a4c02e1a9d2297cae6610bbf1-7b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c"
]
```

---

## exit-climb.json

**File:** `ui/data/exit-climb.json`

Marks specific exits as climbing or crawling passages. These exits render with a dash-dot stroke (`4 2 1 2`) in the same grey as regular exits (`.exit-climb`).

**Format:**

```json
["<exit_id>", "<exit_id>", ...]
```

Same edge-ID format as `exit-exclude.json` — `edge-<roomA>-<roomB>` with room IDs sorted alphabetically. Find the ID in the generated SVG by searching for either room ID.

**Notes:**

- Climb styling is suppressed when either room is also water, green, or danger — those type colours take precedence.
- Rebuild with `npm run build:svg && npm run sync:svg` after editing.

---

## Impassable exits (exit-nopass)

**No JSON file** — apply the `exit-nopass` CSS class manually in the SVG.

Marks exits that exist in the DB (and therefore appear as auto-generated lines) but cannot actually be traversed by the player. These render as sparse short dashes in the same grey as regular exits.

To mark an exit impassable, open the SVG in a text editor, find the `<line>` element in `layer-exits` with the matching `id`, and add `exit-nopass` to its `class` attribute alongside the existing `exit` class:

```svg
<line id="edge-abc…-def…" class="exit exit-nopass" x1="…" y1="…" x2="…" y2="…"/>
```

The class is preserved across `build:svg` runs because the build script replaces the entire `layer-exits` content — you will need to re-apply it after every rebuild. If that becomes tedious, consider adding the pair to `exit-exclude.json` instead and drawing a manual `exit-nopass` line in `layer-artwork`.

---

## Finding room IDs in-game

Use the `dbid` alias to print the current room's ID as you move around:

```
dbid          → Room ID echo ON  (prints ID on every room transition)
<move around>
dbid          → Room ID echo OFF
```

When echo is ON, the ID is also printed immediately for the room you are currently in, so you don't need to move first.

Copy the printed ID into the appropriate JSON file, then rebuild.

## Workflow

After editing either file:

```bash
npm run build:svg   # regenerates ui/maps/*.svg
npm run sync:svg    # updates ui/maps/*.js modules
```

Then reload the plugin in Mallard to see the changes.
