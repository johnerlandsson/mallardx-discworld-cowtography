# Discworld Cowtography

A [Mallard](https://mallard.vnsf.xyz) plugin for [Discworld MUD](https://discworld.starturtle.net/lpc/) combining a minimap panel with a searchable database of rooms, shop items, NPC items and NPCs — with GMCP-driven speedwalk to any result.

Map data from **[Quow's Cow Bar and Minimap](https://quow.co.uk/minimap.php)**.

---

## Map panel

The map panel opens automatically on the right side of the window. As you walk through the MUD it tracks your position and highlights it on the map. Zoom in and out with the `+` and `−` buttons. Hover over the map to see room names.

---

## Commands

Type `db` on its own to print a command reference in the MUD window.

### Searching

```
db <room name>           — search rooms by name
db npc <name>            — search NPCs by name
db npc {<area>} <name>   — search NPCs filtered by area name
db item <name>           — search items for sale in shops
db npcitem <name>        — search items carried or sold by NPCs
```

Search is case-insensitive. Up to 10 reachable results are shown, sorted by distance from your current room.

```
db drum
db npc wizard
db npc {AM} pawn
db item long sword
db npcitem dagger
```

### Routing and walking

After a search, pick a result by number to route there and start walking immediately:

```
db drum
  DB Search: room — "drum"  (3 results, nearest first)
   1.  The Drum  ...
   2.  ...
db 1
  Walking to "The Drum" — 12 moves.
```

```
db walk    — start or resume walking the current route
db clear   — cancel the current route
```

> You must be in a room tracked by the map data for routing and distance sorting to work.

---

## Installation

Install from the Mallard marketplace.

---

## Updating the database

The map and search data are built from [Quow's Cow Bar and Minimap](https://quow.co.uk/minimap.php). When Quow releases an update, regenerate all data files:

```bash
npm install
npm run build:data
git add src/data/ ui/data/ ui/maps/
git commit -m "chore: regenerate data from updated Quow DB"
```

This downloads `quow_cowbar.zip` directly from quow.co.uk, extracts the database and map images, and regenerates everything.

If you already have a local copy of the zip or the SQLite database:

```bash
npm run build:data -- --zip /path/to/quow_cowbar.zip
npm run build:data -- --db /path/to/_quowmap_database.db   # Lua tables only; no JS or PNGs
```

---

## Credits

Map data, database content and pathfinding algorithm adapted from **[Quow's Cow Bar and Minimap](https://quow.co.uk/minimap.php)** plugin for MUSHClient by Quow. Used with gratitude.
