# Gather Room Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new auto-detected room type, `gather`, for rooms whose `shop_items` are 100% foraged (`sale_price = 'gather'`) rather than purchased, replacing the narrow `room_short`-name heuristic (`SHOP_NAME_EXCLUDE`) that only approximated this today, and give it its own colour/letter in the rendered maps.

**Architecture:** `queryShopTypes` in `scripts/build-svg.mjs` gains `sale_price` to its `shop_items` query; a room whose items are all `sale_price = 'gather'` classifies directly as `gather`, bypassing keyword matching. The now-redundant `SHOP_NAME_EXCLUDE` name-based workaround is deleted. Rendering (letter, colour, label) is added the same way every other type was added. A one-off data cleanup removes 8 stale manual `room-types.json` overrides that predate this type, then all maps and the shop-room-editor tool are regenerated.

**Tech Stack:** Node.js (ESM `.mjs`), `better-sqlite3`, `vitest` — same stack as the rest of `scripts/`.

## Global Constraints

- No new npm dependencies.
- Detection is scoped to exactly `sale_price === 'gather'` — do not fold in `pick`/`search`/`trade` or any other non-monetary price value.
- A room qualifies for `gather` only when **100%** of its `shop_items` rows have `sale_price === 'gather'`. A room with even one non-`gather`-priced item must NOT classify as `gather` and must fall through to the existing `classifyShopItems` keyword logic unchanged.
- `gather` sits in the classification precedence at the same point `classifyShopItems`'s result used to be written — still overridable by `room-types.json` (always wins) and by the later pub/tavern name-match step, exactly like every other auto-detected type. Do not special-case `gather` around either of those.
- `SHOP_NAME_EXCLUDE` (the `garden`-in-name heuristic) is deleted entirely, not deprecated or left dormant.
- Colour: `#4a4a1a` (dark olive/moss). Letter: `N`.
- Run `npm test` (includes the Lua suite) before considering the work done.

---

### Task 1: Add the `gather` type — detection and rendering

**Files:**
- Modify: `scripts/build-svg.mjs`
- Modify: `ui/svg-renderer.js`
- Modify: `ui/mapper.css`
- Test: `scripts/build-svg.test.mjs`

**Interfaces:**
- Consumes: nothing new — works entirely within `queryShopTypes`'s existing signature `queryShopTypes(db, mapId, overrides = {})`.
- Produces: `TYPE_LETTERS.gather === 'N'` (already exported from `build-svg.mjs`, consumed by `roomElement`/`buildStairLayer`/downstream code and by `tools/shop-room-editor/generate.mjs` — no changes needed on the consumer side, they pick up new `TYPE_LETTERS` keys automatically). `queryShopTypes(...)` can now return `'gather'` as a value in its result Map, consumed by `buildNewSvg`/`updateExistingSvg` exactly like any other type string.

- [ ] **Step 1: Update the test file — remove obsolete garden tests, add gather tests**

In `scripts/build-svg.test.mjs`, find and **delete** these two tests (currently at lines 904-917, inside the `describe('queryShopTypes', ...)` block):

```js
  it('excludes garden rooms with harvestable items from shop detection', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'neat herb garden')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'some comfrey', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'some yarrow', '')").run()
    expect(queryShopTypes(db, 1).has('r1')).toBe(false)
  })

  it('keeps "garden shop" as a real shop despite garden in name', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'garden shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'rake', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('shop')
  })
```

These tested the `SHOP_NAME_EXCLUDE` heuristic being deleted in Step 3. The second test is also now redundant with the existing `'classifies a room with no matching keywords as generic shop'` test just above it in the same file (same assertion, no garden-specific behavior left to test).

In their place, insert these three tests (same `describe('queryShopTypes', ...)` block, same location):

```js
  it('classifies a room whose items are all gather-priced as gather', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'neat herb garden')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'some comfrey', 'gather')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'some yarrow', 'gather')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('gather')
  })

  it('does not classify a room as gather when only some items are gather-priced', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Mixed Stall')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'some cardamom', 'gather')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'clover', 'pick')").run()
    expect(queryShopTypes(db, 1).get('r1')).not.toBe('gather')
  })

  it('a room-types.json override wins over auto-detected gather', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'neat herb garden')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'some comfrey', 'gather')").run()
    expect(queryShopTypes(db, 1, { 'r1': 'food' }).get('r1')).toBe('food')
  })
```

The first test doubles as regression coverage for the `SHOP_NAME_EXCLUDE` removal: `'neat herb garden'` is the exact room name the deleted test used to special-case by name; it now must classify `gather` via the price-based rule instead.

Also add these two tests near the existing `TYPE_LETTERS`/`roomElement` tests (around line 344-352, same file, same style as the neighboring `stationery` tests):

```js
  it('gather typed room has type class and N letter', () => {
    const el = roomElement('r1', 10, 20, 'Herb Patch', false, 'gather')
    expect(el).toContain('class="room outdoor room-gather"')
    expect(el).toContain('>N<')
  })

  it('TYPE_LETTERS includes gather as N', () => {
    expect(TYPE_LETTERS.gather).toBe('N')
  })
```

- [ ] **Step 2: Run the test file to verify the new tests fail**

Run: `npx vitest run scripts/build-svg.test.mjs`
Expected: The 5 new tests FAIL (`gather` is not yet a valid classification or `TYPE_LETTERS` key; `roomElement` doesn't yet recognize `room-gather`). All previously-passing tests (minus the 2 deleted ones) still pass.

- [ ] **Step 3: Remove `SHOP_NAME_EXCLUDE` and implement gather detection in `queryShopTypes`**

In `scripts/build-svg.mjs`, delete this block entirely (currently lines 112-117):

```js
// Room names matching these patterns are excluded from shop auto-detection.
// Gardens contain harvestable items in shop_items but are not shops.
// Exception: names also containing 'shop' are kept (e.g. "garden shop").
const SHOP_NAME_EXCLUDE = [
  (name) => /garden/i.test(name) && !/shop/i.test(name),
]
```

Then replace the start of `queryShopTypes` (currently lines 119-137):

```js
export function queryShopTypes(db, mapId, overrides = {}) {
  const rows = db.prepare(`
    SELECT si.room_id, si.item_name, r.room_short
    FROM shop_items si
    JOIN rooms r ON si.room_id = r.room_id
    WHERE r.map_id = ?
  `).all(mapId)

  const roomItems = new Map()
  for (const { room_id, item_name, room_short } of rows) {
    if (SHOP_NAME_EXCLUDE.some(fn => fn(room_short ?? ''))) continue
    if (!roomItems.has(room_id)) roomItems.set(room_id, [])
    roomItems.get(room_id).push(item_name)
  }

  const result = new Map()
  for (const [roomId, items] of roomItems) {
    result.set(roomId, classifyShopItems(items))
  }
```

with:

```js
export function queryShopTypes(db, mapId, overrides = {}) {
  const rows = db.prepare(`
    SELECT si.room_id, si.item_name, si.sale_price
    FROM shop_items si
    JOIN rooms r ON si.room_id = r.room_id
    WHERE r.map_id = ?
  `).all(mapId)

  const roomItems = new Map()
  for (const { room_id, item_name, sale_price } of rows) {
    if (!roomItems.has(room_id)) roomItems.set(room_id, [])
    roomItems.get(room_id).push({ name: item_name, price: sale_price })
  }

  const result = new Map()
  for (const [roomId, items] of roomItems) {
    if (items.every(item => item.price === 'gather')) {
      result.set(roomId, 'gather')
    } else {
      result.set(roomId, classifyShopItems(items.map(item => item.name)))
    }
  }
```

Everything after this point in `queryShopTypes` (the `shortTypePatterns` loop, the tavern/pub name-match loop, the `overrides` loop) is unchanged — do not touch it.

Then add `gather: 'N'` to `TYPE_LETTERS` (currently lines 69-76):

```js
export const TYPE_LETTERS = {
  shop: 'S', weapon: 'W', armour: 'A', clothes: 'C', food: 'F', access: 'X',
  furniture: 'U', stationery: 'Q',
  bank: '$', changer: '¢', mission: '!', post: 'O', lang: 'L', temple: 'R',
  crafts: 'K', house: 'H', club: 'G', pshop: 'P', tshop: 'T', talker: 'M',
  tavern: 'V',
  pub:    'B',
  gather: 'N',
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx vitest run scripts/build-svg.test.mjs`
Expected: All tests PASS, including the 5 new ones.

- [ ] **Step 5: Add the label and CSS colour**

In `ui/svg-renderer.js`, add `gather: 'Gather spot',` to `ROOM_TYPE_LABELS` (currently lines 3-12):

```js
const ROOM_TYPE_LABELS = {
  shop: 'General shop', weapon: 'Weapon shop', armour: 'Armour shop',
  clothes: 'Clothing shop', food: 'Food shop', access: 'Accessories shop',
  stationery: 'Stationery shop',
  bank: 'Bank', changer: 'Money changer', mission: 'Mission office',
  post: 'Post office', lang: 'Language school', temple: 'Temple',
  crafts: 'Crafts shop', house: 'Player house', club: 'Player club',
  pshop: 'Player shop', tshop: 'Travelling shop', talker: 'Talker shop',
  tavern: 'Tavern / Restaurant', pub: 'Pub / Bar',
  gather: 'Gather spot',
};
```

In `ui/mapper.css`, add a new rule directly after the existing `.room-temple` rule (currently line 135, the last line of the type-colour block):

```css
.room-gather                             { fill: #4a4a1a; }
```

- [ ] **Step 6: Run the full JS test suite**

Run: `npx vitest run`
Expected: All tests pass (no regressions from the `SHOP_NAME_EXCLUDE` removal or the `queryShopTypes` query-shape change).

- [ ] **Step 7: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs ui/svg-renderer.js ui/mapper.css
git commit -m "feat(maps): add gather room type for foraged shop_items"
```

---

### Task 2: Data cleanup, full rebuild, and docs

**Files:**
- Modify: `ui/data/room-types.json`
- Modify: `docs/map-data-guide.md`
- Regenerate: `ui/maps/*.svg`, `ui/maps/*.js` (via `npm run build:svg && npm run sync:svg`)
- Regenerate: `tools/shop-room-editor/output.html` (via `npm run tool:shop-rooms`)

**Interfaces:**
- Consumes: `TYPE_LETTERS.gather` and the new `queryShopTypes` behavior from Task 1 (via `npm run build:svg`, which is the CLI that calls them — no direct code interface).
- Produces: nothing consumed by other tasks — this is the final integration step.

- [ ] **Step 1: Remove the 8 stale manual overrides**

These 8 rooms currently have a manual `room-types.json` override of `"food"`, set before the `gather` type existed. They are all pure-gather rooms per the design's data investigation and should fall through to the new auto-detection instead. Run this from the repo root — it includes a safety check that fails loudly if any of these entries no longer hold the expected `"food"` value (the file has had manual edits since this plan was written; do not skip the check):

```bash
node -e "
const fs = require('fs');
const path = 'ui/data/room-types.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const staleIds = [
  '209c1ff11b68db9a5eb8c90aa2457182ad96154e',
  '3368641e0c16fe09e2d3cbdebf4e9167edccdc1c',
  '521ce53ca1696d3352c501582a8585611688a6ed',
  '64ee40a06178cbddb80935725cb463e2e21770b5',
  '769a2166451cfa60708f488928661895533860b8',
  'c4fd237c530cb85ca41ed5e188531437c158c922',
  'd0d2db6636cc18e076b28460ef1e8752f8c9fbb3',
  'f7f2ca6da4f318aa73bd86816df00ac2eae66235',
];
let removed = 0;
for (const id of staleIds) {
  if (!(id in data)) { console.log('SKIP (already absent):', id); continue; }
  if (data[id] !== 'food') throw new Error('unexpected value for ' + id + ': ' + JSON.stringify(data[id]) + ' (expected \"food\") — stop and check this room manually before proceeding');
  delete data[id];
  removed++;
}
fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
console.log('removed', removed, 'stale overrides');
"
```

If the script throws, stop and report back — do not force the removal; a value other than `"food"` means someone already reclassified that room since this plan was written and it needs a human decision, not an automatic overwrite.

- [ ] **Step 2: Rebuild all maps**

```bash
npm run build:svg && npm run sync:svg
```

Expected: completes without errors. This will touch many `ui/maps/*.svg`/`*.js` files (any map containing a room whose classification changed — both the 8 cleaned-up rooms and any of the other ~42 gather rooms previously falling back to generic `shop` or excluded by the garden-name heuristic).

- [ ] **Step 3: Regenerate the shop room type editor**

```bash
npm run tool:shop-rooms
```

Expected: completes without errors, reports ~1,130 shop rooms (same room count as before — `gather` rooms are a reclassification of existing entries, not new rooms in scope for that tool: rooms whose only items are `gather`-priced were already inside the shop-room-editor's scope, since its scope is "any room with a `shop_items` row" — this is unaffected by this change).

Spot-check one of the 8 cleaned-up rooms picked up the new auto-detection with no manual override. The embedded data is one enormous single-line JSON blob, and this particular room ("conservatory", BP Estates) has 18 items — a naive `grep -o` with a fixed-size character window will silently find nothing once the object is longer than the window (this bit us while writing this plan). Use this instead, which finds the room's full object by locating the *next* `"room_id":` occurrence rather than guessing a length:

```bash
node -e "
const html = require('fs').readFileSync('tools/shop-room-editor/output.html', 'utf8');
const id = 'c4fd237c530cb85ca41ed5e188531437c158c922';
const idx = html.indexOf('\"room_id\":\"' + id + '\"');
if (idx === -1) { console.log('ROOM NOT FOUND'); process.exit(1); }
const nextObjStart = html.indexOf('\"room_id\":\"', idx + 1);
console.log(html.slice(idx, nextObjStart === -1 ? idx + 3000 : nextObjStart));
"
```

Expected: the printed room object contains `"effectiveType":"gather","hasOverride":false,"overrideType":null` (before this task runs, it currently shows `"effectiveType":"food","hasOverride":true,"overrideType":"food"` — the stale override this task removes).

- [ ] **Step 4: Update the docs**

In `docs/map-data-guide.md`, insert a new row directly after the `stationery` row (currently line 46, before the `tavern` row):

```markdown
| `gather` | N | dark olive/moss | Auto — `shop_items`; room qualifies when 100% of its items have `sale_price` = `"gather"` |
```

Update the "Priority" line (currently line 50):

Before:
```markdown
**Priority (highest to lowest):** `room-types.json` (always wins) → `room_short` name keywords (pub/tavern) → `shop_items` item keywords → `room_short` exact patterns (bank, house, pshop, club).
```

After:
```markdown
**Priority (highest to lowest):** `room-types.json` (always wins) → `room_short` name keywords (pub/tavern) → `shop_items` item keywords (gather-priced rooms classify as `gather` before any keyword matching) → `room_short` exact patterns (bank, house, pshop, club).
```

Add a new note paragraph directly after the existing tavern/pub note (currently line 54, before the blank line at line 55):

```markdown
>
> `gather` rooms have no purchasable items — every `shop_items` entry is foraged (harvestable herbs, roots, flowers). This replaces an earlier, less accurate `room_short`-name heuristic that only matched rooms with "garden" in the name.
```

- [ ] **Step 5: Run the full project test suite**

```bash
npm test
```

Expected: All JS (vitest) and Lua tests pass.

- [ ] **Step 6: Spot-check a real gather room**

Pick one of the previously-garden-excluded rooms and confirm it now renders correctly, e.g.:

```bash
grep -c 'room-gather' ui/maps/*.svg
```

Expected: a non-zero count in at least one map file. Open one matching SVG (or the corresponding `.js` module) and visually confirm a room renders with the `N` glyph — this is a machine-generated file, so a `grep` confirming both the `room-gather` class and an `N` type-label glyph near it is sufficient; a full visual check is optional but welcome if convenient.

- [ ] **Step 7: Commit**

```bash
git add ui/data/room-types.json ui/maps/ tools/shop-room-editor/output.html docs/map-data-guide.md
git commit -m "chore(maps): clean up stale gather overrides, rebuild maps, document gather type"
```
