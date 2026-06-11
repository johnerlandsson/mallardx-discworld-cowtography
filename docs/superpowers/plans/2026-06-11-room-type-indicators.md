# Room Type Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add coloured fills with type letters to rooms (shops, banks, player-owned, etc.) via DB auto-detection and manual JSON config, plus a new preserved SVG layer for hand-crafted in-room annotations in Inkscape.

**Architecture:** CSS classes drive room fill colours; `build-svg.mjs` generates type class + `<text>` element per room using item-name keyword heuristics from `shop_items` and overrides from `ui/data/room-types.json`; a new `layer-room-labels` layer is added between `layer-rooms` and `layer-labels` and is preserved across rebuilds.

**Tech Stack:** JavaScript ESM (`build-svg.mjs`), better-sqlite3, vitest (existing test suite), CSS.

---

## File map

| File | Change |
|------|--------|
| `ui/mapper.css` | Stroke 0.5, add 15 fill classes + `.room-type-label` |
| `scripts/sync-svg-js.mjs` | Add `.room-type-label` to `FONT_STYLE_BLOCK` selector |
| `scripts/sync-svg-js.test.mjs` | New test for `.room-type-label` |
| `ui/data/room-types.json` | New file — empty `{}` |
| `scripts/build-svg.mjs` | `SHOP_KEYWORDS`, `TYPE_LETTERS`, `queryShopTypes`, extend `roomElement`, layer in templates, migration in update functions, wire in `buildOneSvg` |
| `scripts/build-svg.test.mjs` | Extend `makeDb`, new tests for `queryShopTypes`, `roomElement` type, layer order, wire-through |
| `docs/annotation-guide.md` | New section on `layer-room-labels` |

---

## Task 1: CSS — stroke, fill classes, room-type-label

**Files:**
- Modify: `ui/mapper.css:63`
- Modify: `ui/mapper.css:69` (insert after stair-symbol rule)

- [ ] **Step 1: Change stroke-width on `.room` from 1.62 to 0.5**

In `ui/mapper.css` line 63, change:
```css
.room         { fill: var(--bg); stroke: var(--fg); stroke-width: 1.62; }
```
to:
```css
.room         { fill: var(--bg); stroke: var(--fg); stroke-width: 0.5; }
```

- [ ] **Step 2: Add `.room-type-label` and fill classes after the `.stair-symbol` rule (line 69)**

Insert immediately after `.stair-symbol { fill: var(--fg); pointer-events: none; }`:
```css
.room-type-label { font-family: "Noto Sans", sans-serif; font-size: 4.5px; font-weight: bold; fill: #eaeaea; pointer-events: none; }

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

- [ ] **Step 3: Commit**

```bash
git add ui/mapper.css
git commit -m "style(rooms): stroke-width 0.5, add room type fill classes"
```

---

## Task 2: FONT_STYLE_BLOCK — add .room-type-label selector

**Files:**
- Modify: `scripts/sync-svg-js.mjs:6-12`
- Modify: `scripts/sync-svg-js.test.mjs`

CSS classes used in SVG type labels need Noto Sans when rendered in Inkscape previews. The `FONT_STYLE_BLOCK` is injected into every SVG by `sync:svg`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/sync-svg-js.test.mjs` inside the existing `describe('injectFontStyle', ...)` block:
```javascript
it('includes room-type-label in font fix selector', () => {
  expect(FONT_STYLE_BLOCK).toContain('.room-type-label')
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:js 2>&1 | grep -A3 'room-type-label'
```
Expected: FAIL — `AssertionError: expected ... to contain '.room-type-label'`

- [ ] **Step 3: Update `FONT_STYLE_BLOCK` in `scripts/sync-svg-js.mjs`**

Change the selector list from:
```javascript
export const FONT_STYLE_BLOCK = `<style id="inkscape-font-fix">
text, .map-label, .map-label-muted, .map-label-accent,
.lib-table, .lib-gap-label, .lib-book-label,
.lib-row-num, .lib-book-list {
  font-family: "Noto Sans", sans-serif;
}
</style>`
```
to:
```javascript
export const FONT_STYLE_BLOCK = `<style id="inkscape-font-fix">
text, .map-label, .map-label-muted, .map-label-accent,
.lib-table, .lib-gap-label, .lib-book-label,
.lib-row-num, .lib-book-list, .room-type-label {
  font-family: "Noto Sans", sans-serif;
}
</style>`
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm run test:js 2>&1 | grep -E 'room-type-label|FAIL|PASS'
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-svg-js.mjs scripts/sync-svg-js.test.mjs
git commit -m "feat(sync-svg): add room-type-label to inkscape font fix selector"
```

---

## Task 3: Create room-types.json

**Files:**
- Create: `ui/data/room-types.json`

- [ ] **Step 1: Create the empty config file**

```bash
echo '{}' > ui/data/room-types.json
```

- [ ] **Step 2: Verify contents**

```bash
cat ui/data/room-types.json
```
Expected output: `{}`

- [ ] **Step 3: Commit**

```bash
git add ui/data/room-types.json
git commit -m "feat(maps): add empty room-types.json manual override config"
```

---

## Task 4: queryShopTypes — DB query + keyword heuristic

**Files:**
- Modify: `scripts/build-svg.mjs` (add constants + function)
- Modify: `scripts/build-svg.test.mjs` (extend makeDb, add tests)

`queryShopTypes(db, mapId, overrides)` returns a `Map<roomId, typeString>` by querying `shop_items`, classifying items by keyword, and merging manual overrides.

- [ ] **Step 1: Extend `makeDb()` in `scripts/build-svg.test.mjs` to include `shop_items`**

The `makeDb()` function at the top of the test file currently creates `rooms` and `room_exits` tables. Update it to also create `shop_items`:

```javascript
function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      map_id  INTEGER NOT NULL,
      xpos    INTEGER NOT NULL,
      ypos    INTEGER NOT NULL,
      room_short TEXT NOT NULL
    );
    CREATE TABLE room_exits (
      room_id    TEXT NOT NULL,
      connect_id TEXT NOT NULL,
      exit       TEXT NOT NULL,
      guessed    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE shop_items (
      room_id    TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      sale_price TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (room_id, item_name)
    );
  `)
  return db
}
```

Also add `queryShopTypes` to the import at line 3:
```javascript
import { queryRooms, queryExits, queryStairRooms, edgeId, roomElement, stairSymbol, exitElement, buildNewSvg, updateExistingSvg, buildLibrarySvg, buildLibraryLabelsContent, buildLibraryRowNumbers, buildLibraryBookList, buildLibraryExitsContent, queryShopTypes } from './build-svg.mjs'
```

- [ ] **Step 2: Write failing tests for `queryShopTypes`**

Add a new `describe` block at the end of `scripts/build-svg.test.mjs`:
```javascript
describe('queryShopTypes', () => {
  it('returns empty map when no rooms have shop items on this map', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Room')").run()
    expect(queryShopTypes(db, 1).size).toBe(0)
  })

  it('classifies a room with majority weapon items as weapon', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'long sword', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'short sword', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'dagger', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('weapon')
  })

  it('classifies a room with no matching keywords as generic shop', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'mystery item', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('shop')
  })

  it('picks majority type: three food items beat one armour item', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Bakery')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'apple pie', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'chocolate cake', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'beef stew', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'metal helm', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('food')
  })

  it('returns shop on a tie between two sub-types', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Mixed')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'long sword', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'metal helm', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('shop')
  })

  it('manual override wins over keyword heuristic', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Sword Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'long sword', '')").run()
    expect(queryShopTypes(db, 1, { 'r1': 'bank' }).get('r1')).toBe('bank')
  })

  it('override applies to rooms not in shop_items', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Bank')").run()
    expect(queryShopTypes(db, 1, { 'r1': 'bank' }).get('r1')).toBe('bank')
  })

  it('does not include rooms from other maps', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Map1 Room')").run()
    db.prepare("INSERT INTO rooms VALUES ('r2', 2, 0, 0, 'Map2 Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r2', 'long sword', '')").run()
    expect(queryShopTypes(db, 1).has('r2')).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm run test:js 2>&1 | grep -E 'queryShopTypes|FAIL'
```
Expected: multiple FAILs with `queryShopTypes is not a function`.

- [ ] **Step 4: Implement `SHOP_KEYWORDS`, `TYPE_LETTERS`, and `queryShopTypes` in `scripts/build-svg.mjs`**

After the `BOTH_DIRS` constant definition (around line 31) and before the `// ─── DB queries ─` section header, insert a new section:

```javascript
// ─── Room type data ──────────────────────────────────────────────────────────

export const SHOP_KEYWORDS = {
  weapon:  ['sword', 'axe', 'dagger', 'crossbow', 'bolt', 'spear', 'mace', 'flail', 'whip', 'lance'],
  armour:  ['armour', 'armor', 'shield', 'helm', 'mail', 'chainmail', 'breastplate', 'gauntlet'],
  clothes: ['coat', 'cloak', 'robe', 'gown', 'jacket', 'dress', 'shirt', 'trouser', 'skirt', 'shoe', 'boot', 'hat', 'wig'],
  food:    ['cake', 'pie', 'bread', 'meat', 'ale', 'beer', 'wine', 'cheese', 'soup', 'stew'],
  access:  ['ring', 'bracelet', 'necklace', 'earring', 'gem', 'jewel', 'brooch', 'pendant'],
}

export const TYPE_LETTERS = {
  shop: 'S', weapon: 'W', armour: 'A', clothes: 'C', food: 'F', access: 'X',
  bank: '$', mission: '!', post: 'O', lang: 'L',
  crafts: 'K', house: 'H', club: 'G', pshop: 'P', tshop: 'T',
}

function classifyShopItems(items) {
  const counts = {}
  for (const item of items) {
    const lower = item.toLowerCase()
    for (const [type, keywords] of Object.entries(SHOP_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        counts[type] = (counts[type] ?? 0) + 1
        break
      }
    }
  }
  let winner = 'shop'
  let best = 0
  for (const [type, count] of Object.entries(counts)) {
    if (count > best) { best = count; winner = type }
  }
  return winner
}

export function queryShopTypes(db, mapId, overrides = {}) {
  const rows = db.prepare(`
    SELECT si.room_id, si.item_name
    FROM shop_items si
    JOIN rooms r ON si.room_id = r.room_id
    WHERE r.map_id = ?
  `).all(mapId)

  const roomItems = new Map()
  for (const { room_id, item_name } of rows) {
    if (!roomItems.has(room_id)) roomItems.set(room_id, [])
    roomItems.get(room_id).push(item_name)
  }

  const result = new Map()
  for (const [roomId, items] of roomItems) {
    result.set(roomId, classifyShopItems(items))
  }
  for (const [roomId, type] of Object.entries(overrides)) {
    result.set(roomId, type)
  }
  return result
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm run test:js 2>&1 | grep -E 'queryShopTypes|failed|passed'
```
Expected: all 8 queryShopTypes tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs
git commit -m "feat(build-svg): queryShopTypes with keyword heuristics and manual overrides"
```

---

## Task 5: roomElement — type class and letter

**Files:**
- Modify: `scripts/build-svg.mjs:122-129`
- Modify: `scripts/build-svg.test.mjs`

`roomElement` gains an optional `type` parameter. When provided it appends `room-<type>` to the class list and adds a centered `<text class="room-type-label">` with the corresponding letter.

- [ ] **Step 1: Write failing tests**

Add a new `describe` block in `scripts/build-svg.test.mjs` after the existing `roomElement` tests. Also add `TYPE_LETTERS` to the import at line 3:
```javascript
import { ..., queryShopTypes, TYPE_LETTERS } from './build-svg.mjs'
```

Then add:
```javascript
describe('roomElement (with type)', () => {
  it('plain room is unchanged when type is null', () => {
    const el = roomElement('r1', 10, 20, 'Room', false, null, null)
    expect(el).toContain('class="room outdoor"')
    expect(el).not.toContain('room-')
    expect(el).not.toContain('<text')
  })

  it('outdoor typed room has type class and centered letter', () => {
    const el = roomElement('r1', 10, 20, 'Armoury', false, null, 'weapon')
    expect(el).toContain('class="room outdoor room-weapon"')
    expect(el).toContain('<text class="room-type-label"')
    expect(el).toContain('x="10"')
    expect(el).toContain('y="20"')
    expect(el).toContain('text-anchor="middle"')
    expect(el).toContain('dominant-baseline="central"')
    expect(el).toContain('>W<')
  })

  it('indoor typed room has type class and centered letter', () => {
    const el = roomElement('r1', 50, 75, 'Inn', true, null, 'food')
    expect(el).toContain('class="room indoor room-food"')
    expect(el).toContain('<text class="room-type-label"')
    expect(el).toContain('x="50"')
    expect(el).toContain('y="75"')
    expect(el).toContain('>F<')
  })

  it('room with both stair and type contains stair polygon and type label', () => {
    const el = roomElement('r1', 10, 20, 'Bank', false, { hasUp: false, hasDown: true }, 'bank')
    expect(el).toContain('<polygon')
    expect(el).toContain('<text class="room-type-label"')
    expect(el).toContain('>$<')
  })

  it('TYPE_LETTERS covers all 15 types', () => {
    const expected = ['shop', 'weapon', 'armour', 'clothes', 'food', 'access',
                      'bank', 'mission', 'post', 'lang',
                      'crafts', 'house', 'club', 'pshop', 'tshop']
    for (const t of expected) {
      expect(TYPE_LETTERS[t]).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:js 2>&1 | grep -E 'roomElement \(with type\)|FAIL'
```
Expected: FAIL — existing `roomElement` does not accept a `type` param.

- [ ] **Step 3: Extend `roomElement` in `scripts/build-svg.mjs`**

Replace the existing `roomElement` function (lines 122-129):
```javascript
// stair: null | {hasUp, hasDown}
export function roomElement(id, x, y, short, isIndoor, stair = null) {
  const label = short ? ` data-label="${escapeXml(short)}"` : ''
  const shape = isIndoor
    ? `<rect id="room-${id}" class="room indoor"${label} x="${x - 4}" y="${y - 4}" width="8" height="8" rx="2"/>`
    : `<circle id="room-${id}" class="room outdoor"${label} cx="${x}" cy="${y}" r="4"/>`
  if (!stair) return shape
  return shape + stairSymbol(x, y, stair.hasUp, stair.hasDown)
}
```

with:
```javascript
// stair: null | {hasUp, hasDown}
// type: null | string (key of TYPE_LETTERS)
export function roomElement(id, x, y, short, isIndoor, stair = null, type = null) {
  const label     = short ? ` data-label="${escapeXml(short)}"` : ''
  const typeClass = type ? ` room-${type}` : ''
  const shape = isIndoor
    ? `<rect id="room-${id}" class="room indoor${typeClass}"${label} x="${x - 4}" y="${y - 4}" width="8" height="8" rx="2"/>`
    : `<circle id="room-${id}" class="room outdoor${typeClass}"${label} cx="${x}" cy="${y}" r="4"/>`
  const stairEl = stair ? stairSymbol(x, y, stair.hasUp, stair.hasDown) : ''
  const typeEl  = type  ? `<text class="room-type-label" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${TYPE_LETTERS[type]}</text>` : ''
  return shape + stairEl + typeEl
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:js 2>&1 | tail -5
```
Expected: all tests pass, no failures.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs
git commit -m "feat(build-svg): roomElement type class and letter support"
```

---

## Task 6: layer-room-labels in SVG templates and migration

**Files:**
- Modify: `scripts/build-svg.mjs` (`buildNewSvg`, `buildLibrarySvg`, `updateExistingSvg`, `updateLibrarySvg`)
- Modify: `scripts/build-svg.test.mjs` (update layer-order test, add migration tests)

`layer-room-labels` is a preserved layer between `layer-rooms` and `layer-labels`. New SVGs get it from the templates. Existing SVGs get it inserted automatically on the next `build:svg` run.

- [ ] **Step 1: Update the layer-order test in `buildNewSvg` describe block**

The existing test at line ~250 says `'has four layers in order: artwork, exits, rooms, labels'`. Change it to verify five layers:

```javascript
it('has five layers in order: artwork, exits, rooms, room-labels, labels', () => {
  const svg = buildNewSvg(mapMeta, rooms, exits, 7)
  const pos = id => svg.indexOf(`id="${id}"`)
  expect(pos('layer-artwork')).toBeLessThan(pos('layer-exits'))
  expect(pos('layer-exits')).toBeLessThan(pos('layer-rooms'))
  expect(pos('layer-rooms')).toBeLessThan(pos('layer-room-labels'))
  expect(pos('layer-room-labels')).toBeLessThan(pos('layer-labels'))
})
```

Also update the `buildLibrarySvg` test at line ~375 that says `'has all four layers'`:
```javascript
it('has all five layers in order', () => {
  const pos = id => svg.indexOf(`id="${id}"`)
  expect(svg).toContain('id="layer-artwork"')
  expect(svg).toContain('id="layer-exits"')
  expect(svg).toContain('id="layer-rooms"')
  expect(svg).toContain('id="layer-room-labels"')
  expect(svg).toContain('id="layer-labels"')
  expect(pos('layer-rooms')).toBeLessThan(pos('layer-room-labels'))
  expect(pos('layer-room-labels')).toBeLessThan(pos('layer-labels'))
})
```

Add two migration tests to the `updateExistingSvg` describe block:
```javascript
it('inserts layer-room-labels after layer-rooms when missing from existing SVG', () => {
  // Simulate old SVG without the new layer
  const oldSvg = makeSvg().replace('\n\n  <g id="layer-room-labels"></g>', '')
  const updated = updateExistingSvg(oldSvg, mapMeta, origRooms, origExits)
  const pos = id => updated.indexOf(`id="${id}"`)
  expect(pos('layer-room-labels')).toBeGreaterThan(pos('layer-rooms'))
  expect(pos('layer-room-labels')).toBeLessThan(pos('layer-labels'))
})

it('preserves existing layer-room-labels content on update', () => {
  const svg = makeSvg().replace(
    '<g id="layer-room-labels"></g>',
    '<g id="layer-room-labels"><text class="room-type-label" x="10" y="20">X</text></g>'
  )
  expect(updateExistingSvg(svg, mapMeta, origRooms, origExits)).toContain('>X<')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:js 2>&1 | grep -E 'layer-room-labels|four layers|five layers|FAIL' | head -10
```
Expected: failures on the layer tests.

- [ ] **Step 3: Add `layer-room-labels` to `buildNewSvg` template**

In `scripts/build-svg.mjs`, find `buildNewSvg` (line ~142). Insert the new layer between `layer-rooms` and `layer-labels`:

```javascript
  return `<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${mapMeta.maxX} ${mapMeta.maxY}"
     class="map-svg"
     data-map-id="${mapId}">

  <g id="layer-artwork"><!-- artwork --></g>

  <g id="layer-exits">
${exitLines}
  </g>

  <g id="layer-rooms">
${roomShapes}
  </g>

  <g id="layer-room-labels"></g>

  <g id="layer-labels"><!-- labels --></g>

</svg>`
```

- [ ] **Step 4: Add migration to `updateExistingSvg` and add `layer-room-labels` to `buildLibrarySvg`**

In `updateExistingSvg` (line ~168), add migration logic after the existing two `svg = svg.replace(...)` calls:
```javascript
  if (!svg.includes('id="layer-room-labels"')) {
    svg = svg.replace(
      /(\n  <g id="layer-labels">)/,
      `\n\n  <g id="layer-room-labels"></g>$1`
    )
  }
  return svg
```

In `buildLibrarySvg` (line ~365), add `layer-room-labels` between `layer-rooms` and `layer-labels`:
```javascript
  return `<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="${viewX} ${viewY} ${viewW} ${viewH}"
     class="map-svg"
     data-map-id="47">

  <g id="layer-artwork"><!-- artwork --></g>

  <g id="layer-exits">${exitsContent ? '\n' + exitsContent : ''}  </g>

  <g id="layer-rooms">
${buildLibraryRoomsContent(missingSet, gapsArray, booksArray)}
  </g>

  <g id="layer-room-labels"></g>

  <g id="layer-labels">
${allLabels}  </g>

</svg>`
```

In `updateLibrarySvg` (line ~389), after the existing three `svg = svg.replace(...)` calls, add:
```javascript
  if (!svg.includes('id="layer-room-labels"')) {
    svg = svg.replace(
      /(\n  <g id="layer-labels">)/,
      `\n\n  <g id="layer-room-labels"></g>$1`
    )
  }
  return svg
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm run test:js 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs
git commit -m "feat(build-svg): add layer-room-labels between rooms and labels"
```

---

## Task 7: Wire shopTypes through the build pipeline

**Files:**
- Modify: `scripts/build-svg.mjs` (`buildNewSvg`, `updateExistingSvg`, `buildOneSvg`)
- Modify: `scripts/build-svg.test.mjs`

Pass the `shopTypes` map from `buildOneSvg` through `buildNewSvg`/`updateExistingSvg` down to `roomElement`.

- [ ] **Step 1: Write failing integration tests**

Add to the `buildNewSvg` describe block:
```javascript
it('applies room type class and letter when shopTypes provided', () => {
  const shopTypes = new Map([['r1', 'weapon']])
  const svg = buildNewSvg(mapMeta, rooms, exits, 7, new Map(), shopTypes)
  expect(svg).toContain('class="room outdoor room-weapon"')
  expect(svg).toContain('<text class="room-type-label"')
  expect(svg).toContain('>W<')
})

it('plain room unchanged when not in shopTypes', () => {
  const shopTypes = new Map([['r1', 'weapon']])
  const svg = buildNewSvg(mapMeta, rooms, exits, 7, new Map(), shopTypes)
  // r2 is plain — verify its element has no type suffix
  expect(svg).toContain('id="room-r2" class="room outdoor"')
})
```

Add to the `updateExistingSvg` describe block:
```javascript
it('applies room type class and letter when shopTypes provided', () => {
  const shopTypes = new Map([['r1', 'food']])
  const updated = updateExistingSvg(makeSvg(), mapMeta, origRooms, origExits, new Map(), shopTypes)
  expect(updated).toContain('room-food')
  expect(updated).toContain('>F<')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:js 2>&1 | grep -E 'shopTypes provided|FAIL' | head -5
```
Expected: FAIL — `buildNewSvg` does not accept `shopTypes` yet.

- [ ] **Step 3: Update `buildNewSvg` and `updateExistingSvg` signatures**

In `scripts/build-svg.mjs`, update `buildNewSvg` signature and its `roomShapes` line:
```javascript
export function buildNewSvg(mapMeta, rooms, exits, mapId = '', stairRooms = new Map(), shopTypes = new Map()) {
  const isIndoor = !mapMeta.topLevel
  const exitLines  = exits.map(e => '    ' + exitElement(e.from, e.to, rooms, e.isVertical)).filter(Boolean).join('\n')
  const roomShapes = rooms.map(r => '    ' + roomElement(r.id, r.x, r.y, r.short, isIndoor, stairRooms.get(r.id) ?? null, shopTypes.get(r.id) ?? null)).join('\n')
  // rest of template unchanged
```

Update `updateExistingSvg` signature and its `roomShapes` line:
```javascript
export function updateExistingSvg(existingSvg, mapMeta, rooms, exits, stairRooms = new Map(), shopTypes = new Map()) {
  const isIndoor   = !mapMeta.topLevel
  const exitLines  = exits.map(e => '    ' + exitElement(e.from, e.to, rooms, e.isVertical)).filter(Boolean).join('\n')
  const roomShapes = rooms.map(r => '    ' + roomElement(r.id, r.x, r.y, r.short, isIndoor, stairRooms.get(r.id) ?? null, shopTypes.get(r.id) ?? null)).join('\n')
  // rest unchanged
```

- [ ] **Step 4: Wire `queryShopTypes` into `buildOneSvg`**

At the top of `build-svg.mjs` add `TYPES_CONFIG` alongside `LIB_CONFIG`:
```javascript
const TYPES_CONFIG  = path.join(REPO_ROOT, 'ui', 'data', 'room-types.json')
```

In `buildOneSvg`, after `queryStairRooms` and before the `let svg` declaration:
```javascript
  let typesOverrides = {}
  try { typesOverrides = JSON.parse(await fs.readFile(TYPES_CONFIG, 'utf8')) } catch {}
  const shopTypes = queryShopTypes(db, mapId, typesOverrides)
```

Then pass `shopTypes` to both builders:
```javascript
    svg = updateExistingSvg(existing, mapMeta, roomRows, exitRows, stairRooms, shopTypes)
  // ...
    svg = buildNewSvg(mapMeta, roomRows, exitRows, mapId, stairRooms, shopTypes)
```

- [ ] **Step 5: Run all tests**

```bash
npm run test:js 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs
git commit -m "feat(build-svg): wire shopTypes through build pipeline"
```

---

## Task 8: Update annotation guide

**Files:**
- Modify: `docs/annotation-guide.md`

- [ ] **Step 1: Add `layer-room-labels` to the Layers section**

In `docs/annotation-guide.md`, replace the existing **Layers** section:

```markdown
## Layers

Work only in **`layer-artwork`**. Other layers (rooms, exits, labels) are managed by the build script and will be overwritten on the next `build:svg` run. Use Inkscape's Layers panel (Layer → Layers…) to confirm you are on the correct layer before drawing.
```

with:

```markdown
## Layers

| Layer | Purpose | Preserved |
|---|---|---|
| `layer-artwork` | Background art, area fills, annotation boxes | ✓ |
| `layer-exits` | Exit lines — **do not edit** | generated |
| `layer-rooms` | Room shapes — **do not edit** | generated |
| `layer-room-labels` | In-room annotation text (see below) | ✓ |
| `layer-labels` | Map text labels, anno-boxes — **do not edit standard maps** | generated |

Work only in **`layer-artwork`** for background art and **`layer-room-labels`** for in-room annotations. Other layers are overwritten on every `build:svg` run.

## In-room annotations

You can place custom text (a letter, symbol, or short code) inside a room circle or square. These must go in **`layer-room-labels`** — this layer renders on top of room fills and is preserved across `build:svg` runs.

If `layer-room-labels` is not visible in Inkscape's layers panel, run `npm run build:svg` once to regenerate the SVG with the new layer.

### Finding the room center coordinates

Open the generated `.svg` in a text editor and search for the room's `id` attribute:

- **Outdoor circle:** `<circle id="room-XXXX" ... cx="100" cy="200" r="4"/>` → center is `(100, 200)`
- **Indoor rect:** `<rect id="room-XXXX" ... x="96" y="196" width="8" height="8"/>` → center is `x + 4, y + 4` = `(100, 200)`

The `data-label` attribute on room elements shows the room's short name, which can help you identify the right room.

### Text element attributes

Set these in the XML editor (Shift+Ctrl+X):

| Attribute | Value | Purpose |
|---|---|---|
| `class` | `room-type-label` | Noto Sans bold 4.5px, light fill |
| `text-anchor` | `middle` | Horizontal centering |
| `dominant-baseline` | `central` | Vertical centering |
| `x` | room center X | e.g. `100` |
| `y` | room center Y | e.g. `200` |

The `room-type-label` class sets `font-size: 4.5px; font-weight: bold; fill: #eaeaea`. For untyped (plain) rooms with the dark background, use `fill="var(--fg)"` instead of the class.

Do not override `font-family` in Inkscape — the class controls it.

### Workflow

1. Run `npm run build:svg` to ensure `layer-room-labels` exists in the SVG
2. Open the SVG in Inkscape — switch to the `layer-room-labels` layer
3. Draw a `<text>` element at the room center with the attributes above
4. Save in Inkscape
5. Run `npm run sync:svg` to update the `.js` module
6. Reload the plugin in Mallard
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

```bash
npm run test:js 2>&1 | tail -3
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add docs/annotation-guide.md
git commit -m "docs: add layer-room-labels workflow to annotation guide"
```

---

## Task 9: Rebuild all SVGs and sync

Run the full build pipeline to regenerate all SVG files with the new layer, stroke weight, and shop type indicators.

- [ ] **Step 1: Run `build:svg`**

```bash
npm run build:svg
```

Expected output: list of maps with room/exit counts, no errors. Each `.svg` file will gain `layer-room-labels`, stroke-width 0.5, and typed rooms where shop_items data exists.

- [ ] **Step 2: Run `sync:svg`**

```bash
npm run sync:svg
```

Expected output: `synced <file>.svg` for each map file.

- [ ] **Step 3: Commit all rebuilt SVGs**

```bash
git add ui/maps/
git commit -m "chore(maps): rebuild SVGs with room type indicators and layer-room-labels"
```
