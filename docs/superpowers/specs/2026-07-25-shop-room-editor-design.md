# Shop room type editor tool — design

## Purpose

A standalone HTML tool for manually reviewing and overriding room types for
every shop room in the game, with the item listing shown alongside so the
decision can be made without alt-tabbing to query the DB. Solves the current
workflow gap: setting a `room-types.json` override today requires manually
finding a room ID in a generated SVG and hand-editing JSON with no visibility
into why the auto-classifier picked what it picked.

This is the first tool in a new `tools/` directory, intended to hold future
one-off curation/reporting tools alongside this one.

## Scope

Covers exactly the rooms with at least one `shop_items` row — 1,130 rooms
across the whole world (all maps), independent of what type they're currently
classified as. Rooms that are shop-like but have no `shop_items` entry (e.g.
`pshop`, `tshop`, `bank`, `changer`, `mission`, `talker`) are out of scope for
this tool — nothing to list, and no reason to review them here.

## Architecture

**New files:**

| File | Purpose |
|---|---|
| `tools/shop-room-editor/generate.mjs` | Node generator script |
| `tools/shop-room-editor/output.html` | Generated, self-contained tool (committed) |

**npm script:** `"tool:shop-rooms": "node tools/shop-room-editor/generate.mjs"` added to `package.json`.

### Generation (`generate.mjs`)

Follows the same conventions as `scripts/build-svg.mjs` / `scripts/build-db.mjs`:

- Default DB path `claude_resources/quow_cowbar/maps/_quowmap_database.db`, overridable with `--db <path>`.
- Output path defaults to `tools/shop-room-editor/output.html`, overridable with `--out <path>`.

Steps:

1. Open the DB with `better-sqlite3`.
2. Read `maps` from `ui/data/rooms.js` (for map ID → display name).
3. Read and parse `ui/data/room-types.json` (also keep the raw file text, to preserve existing formatting/key order for the download step).
4. Import `queryShopTypes` and `TYPE_LETTERS` from `../../scripts/build-svg.mjs`. Call `queryShopTypes` once per `map_id` present in `maps`, passing the relevant slice of the parsed `room-types.json` as `overrides` — exactly like `build-svg.mjs` does. This produces each room's **effective type** (auto-detected, with any existing manual override already applied) using the real classification logic, so the tool can never drift out of sync with what the actual map build does. `TYPE_LETTERS` is embedded into the output payload as-is (see step 7) so the page's type badges and override `<select>` options are also sourced from the real table, not a second hand-maintained copy.
5. Query `shop_items` for every room that has at least one row:
   ```sql
   SELECT si.room_id, si.item_name, si.sale_price, r.room_short, r.map_id
   FROM shop_items si
   JOIN rooms r ON si.room_id = r.room_id
   ```
   Group by `room_id`, sort each room's items alphabetically by `item_name` (case-insensitive).
6. Assemble one JS array of room records:
   ```js
   {
     room_id: string,
     room_short: string,
     map_id: number,
     map_name: string,
     items: [{ name: string, price: string }],   // alphabetical
     effectiveType: string,                       // from queryShopTypes
     hasOverride: boolean,                         // room_id in parsed room-types.json
     overrideType: string | null,                  // parsed room-types.json[room_id], if present
   }
   ```
   Sort the array by `map_name`, then `room_short`.
7. Render `output.html` from a template: embed the room array, `TYPE_LETTERS`, and the raw `room-types.json` text as JSON inside a `<script type="application/json">` block, plus the static CSS/JS shell (written once, not templated).

### Why reuse `queryShopTypes`

`scripts/build-svg.mjs` already exports `queryShopTypes(db, mapId, overrides)`, which
implements the full precedence chain (`room-types.json` → name-keyword rules →
`shop_items` keyword classification → name-pattern rules). Reusing it directly
means the tool's "effective type" badge is always identical to what the next
`npm run build:svg` would actually render — no second implementation of the
classification rules to keep in sync.

## Output tool UI (`output.html`)

Static after generation: inline CSS/JS only, no network requests, opens
directly from the filesystem in any browser.

### Layout

- **Sticky top bar:**
  - Title ("Shop Room Type Editor")
  - Live search box — filters visible rooms by substring match (case-insensitive) against room name or any item name
  - "N changes pending" counter
  - "Download room-types.json" button
- **Body:** one collapsible `<details>` block per map, in the sorted order from generation, each labeled with the map name and a count of shop rooms in it (e.g. "Ankh-Morpork Docks (42 shops)"). Sections start expanded; the search box, when non-empty, force-expands any section containing a match and hides sections with none.

### Room card

Each room in a map section renders as a card with:

- **Header:** room name (`room_short`), a small colored badge showing the effective type's letter (looked up from the embedded `TYPE_LETTERS` payload), and the `room_id` in small monospace muted text.
- **Item list:** alphabetical, rendered in a `max-height: 200px; overflow-y: auto` box. If a room has more than 20 items, the box starts collapsed behind a "Show N items" toggle button; expanding swaps in the scrollable list.
- **Override controls:**
  - Checkbox, labeled "Manual override". Initial state = `hasOverride`.
  - `<select>` listing every key from the embedded `TYPE_LETTERS` payload (all valid room types, not just shop sub-types — a shop room can legitimately be reclassified as `crafts`, `furniture`, etc.). Initial value = `overrideType` if `hasOverride`, else `effectiveType`. Disabled unless the checkbox is checked.
  - Checking the box with no prior override pre-selects the current effective type (so accepting the auto-detected default as explicit is a single click).

### Change tracking & download

- Client-side JS keeps a `changes` map (`room_id → { type }` for set/updated overrides, or `room_id → null` for a room whose checkbox was unchecked despite having had a stored override) by diffing current control state against each room's original `hasOverride`/`overrideType`.
- The "N changes pending" counter reflects `changes.size` live.
- "Download room-types.json":
  1. Parses the raw original `room-types.json` text embedded at generation time into an object, preserving key order.
  2. For each entry in `changes`: if the value is a type string, set/overwrite that key (new keys appended at the end, existing keys updated in place); if `null`, delete the key.
  3. Re-serializes as pretty-printed JSON (2-space indent, trailing newline — matching the current file's formatting) and triggers a `Blob` download named `room-types.json`.
  4. Only keys touched by `changes` move or change — every other existing entry (temple, post, mission, bank, house, etc., and any shop entries left untouched) stays byte-for-byte in its original position, keeping the resulting `git diff` minimal.

## Files touched

| File | Change |
|---|---|
| `tools/shop-room-editor/generate.mjs` | New generator script |
| `tools/shop-room-editor/output.html` | New generated file (committed) |
| `package.json` | Add `tool:shop-rooms` script |
| `docs/map-data-guide.md` | Add a short section pointing to the new tool as the recommended way to set shop-room overrides |

## Testing plan

- `tools/shop-room-editor/generate.test.mjs`: unit tests against a small in-memory/fixture `better-sqlite3` DB (same pattern as `scripts/build-svg.test.mjs`) covering:
  - a room with `shop_items` rows is included; a room without any is excluded
  - `effectiveType` matches what `queryShopTypes` returns directly for the same fixture
  - `hasOverride`/`overrideType` correctly reflect a fixture `room-types.json` with and without an entry for a given room
  - items within a room are sorted alphabetically, case-insensitively
- Manual verification after generation: open `output.html` in a browser, confirm search filtering, the >20-item collapse toggle on a real large room, and that toggling overrides + downloading produces a JSON file whose unrelated keys are byte-identical to the source `room-types.json`.
- Run `npm test` before considering the work done, per project convention.

## Out of scope

- No changes to `scripts/build-svg.mjs`'s classification logic itself — this tool only consumes it.
- No in-browser direct file write (File System Access API) — download-and-manually-replace only, per the chosen save mechanism.
- No coverage of non-`shop_items` shop-like room types (`pshop`, `tshop`, `bank`, `changer`, `mission`, `talker`, etc.) — out of scope per the Scope section above.
- No auto-regeneration/watch mode — rerun `npm run tool:shop-rooms` manually after DB or `room-types.json` changes.
