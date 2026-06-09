# Discworld DB Search

A [Mallard](https://mallard.vnsf.xyz) plugin for [Discworld MUD](https://discworld.starturtle.net/lpc/) that lets you search Quow's map database for rooms, shop items, NPC items and NPCs, then speedwalk to any result.

**Requires:** [mallardx-discworld-mapper](https://github.com/wizardquack/mallardx-discworld-mapper) — provides the map database.

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

Search is case-insensitive. Up to 30 results are shown.

```
dbsearch npc wizard
dbsearch item long sword
dbsearch room drum
dbsearch npcitem dagger
```

### `dbroute <number>`

Navigate to a result from the last `dbsearch`. Creates a `dbwalk` alias in Discworld's alias system with the full movement sequence.

```
dbroute 3
```

Then type `dbwalk` to begin walking.

> You must be in a room tracked by the mapper for routing to work.

---

## Installation

Install from the Mallard marketplace. Ensure **mallardx-discworld-mapper** is also installed and enabled.

---

## Updating the database

The search data is built from [Quow's Cow Bar and Minimap](https://quow.co.uk/minimap.php) database. When Quow releases an update, the mapper plugin will be updated with the new database. To regenerate this plugin's data files from an updated mapper:

```bash
npm install
npm run build:data -- --db /path/to/mallardx-discworld-mapper/maps/_quowmap_database.db
git add src/data/
git commit -m "chore: regenerate data from updated Quow DB"
```

Then publish a new release.

---

## Credits

Database content and pathfinding algorithm adapted from **[Quow's Cow Bar and Minimap](https://quow.co.uk/minimap.php)** plugin for MUSHClient by Quow. Used with gratitude.
