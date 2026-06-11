# Map Data Configuration Guide

Manual overrides for room appearance. These files live in `ui/data/` and are read by `npm run build:svg` each time you rebuild the maps. Changes take effect on the next rebuild — no Inkscape work required.

---

## room-types.json

**File:** `ui/data/room-types.json`

Assigns a room type to specific rooms, either to override the auto-detected shop sub-type or to annotate rooms that cannot be auto-detected (banks, missions, player houses, etc.).

**Format:**

```json
{
  "<room_id>": "<type>"
}
```

**Finding a room ID:** Open the generated SVG in a text editor and search for the room's short name (it's in the `data-label` attribute). The element's `id` attribute is `room-<room_id>`, so strip the `room-` prefix.

**Valid types:**

| Type | Letter | Colour | Notes |
|------|--------|--------|-------|
| `shop` | S | dark green | Generic shop — auto-detected, override if mis-classified |
| `weapon` | W | dark green | Weapon shop — auto-detected |
| `armour` | A | dark green | Armour shop — auto-detected |
| `clothes` | C | dark green | Clothes shop — auto-detected |
| `food` | F | dark green | Food / bar — auto-detected |
| `access` | X | dark green | Accessories shop — auto-detected |
| `bank` | $ | dark orange | Bank |
| `mission` | ! | dark orange | Mission board / guild office |
| `post` | O | dark orange | Post office |
| `lang` | L | dark orange | Language teacher |
| `crafts` | K | dark green (muted) | Crafting room / smithy |
| `house` | H | brown | Player-owned house |
| `club` | G | navy | Player-owned club or guild |
| `pshop` | P | magenta | Player-owned shop |
| `tshop` | T | near-black | Troll-dollar shop |

**Auto-detection:** Rooms in the `shop_items` database table are classified automatically by keyword matching on item names. Manual entries in this file always win over auto-detection.

**Example:**

```json
{
  "bf24b19be09309ecb42f26836b36eaaf9246c49c": "bank",
  "a1c3e5f7b9d2e4f6a8c0e2f4b6d8e0f2a4c6e8f0": "mission"
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
