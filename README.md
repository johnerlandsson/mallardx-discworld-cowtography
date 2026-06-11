# Discworld Cowtography

A [Mallard](https://mallard.vnsf.xyz) plugin for [Discworld MUD](https://discworld.starturtle.net/lpc/) combining a minimap panel with a searchable database of rooms, shop items, NPC items and NPCs — with GMCP-driven speedwalk to any result.

Map data from **[Quow's Cow Bar and Minimap](https://quow.co.uk/minimap.php)**.

---

## Map panel

The map panel opens automatically on the right side of the window. As you walk through the MUD it tracks your position and highlights it on the map. Zoom in and out with the `+` and `−` buttons. Hover over the map to see room names.

---

## Commands

### `dbsearch <type> <query>`

Search the database. `<type>` is one of:

| Type | Searches |
|------|----------|
| `room` | Room names |
| `item` | Items for sale in shops |
| `npcitem` | Items carried or sold by NPCs |
| `npc` | NPC names |

Search is case-insensitive. The 10 nearest reachable results are shown, sorted by distance from your current room.

```
dbsearch npc wizard
dbsearch item long sword
dbsearch room drum
dbsearch npcitem dagger
```

### `<number>`

After a `dbsearch`, type a bare number to route to that result and start walking immediately.

```
dbsearch room drum
3
  Walking to "The Drum" — 12 moves.
```

### `dbroute <number>`

Route to a result from the last `dbsearch` and display it on the map, without walking yet. Useful when you want to preview the route first.

```
dbroute 3
```

Then use `dbwalk` to start walking.

### `dbwalk`

Walk to the routed destination. Each room arrival sends the next move automatically and counts down the remaining distance.

```
dbwalk
  Walking to "The Drum" — 12 moves.
  10 moves remaining.
  9 moves remaining.
  ...
  Arrived at "The Drum".
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
