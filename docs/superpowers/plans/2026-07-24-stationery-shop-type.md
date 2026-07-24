# Stationery Shop Room Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new auto-detected `stationery` room type (letter `Q`, dark green) for shops selling ≥2 of {writing paper, quill, colour book, stick of chalk}, following the existing shop-subtype auto-detection pattern in `scripts/build-svg.mjs`.

**Architecture:** Extend the existing `classifyShopItems` winner-take-all classifier with a new, separately-computed `stationery` candidate that only enters the competition when ≥2 of 4 distinct item categories are matched (using precise phrase/word-boundary regexes chosen to avoid known collisions in the item corpus). Wire the new type into rendering (`TYPE_LETTERS`, `ROOM_TYPE_LABELS`, CSS) and docs, then regenerate all map SVGs.

**Tech Stack:** Node.js (ESM), `better-sqlite3`, Vitest.

## Global Constraints

- Letter `Q` and the `stationery` key are exact — used verbatim across `scripts/build-svg.mjs`, `ui/svg-renderer.js`, `ui/mapper.css`, `docs/map-data-guide.md`, and tests. Don't rename.
- Colour: dark green (`#1c5c3a`), grouped with the existing `.room-shop, .room-weapon, .room-armour, .room-clothes, .room-food, .room-access, .room-furniture, .room-talker` CSS selector in `ui/mapper.css`.
- The 4 category matchers (paper / quill / chalk / book) must use the exact regexes below — they were validated against the live 8875-row `shop_items` corpus in `claude_resources/quow_cowbar/maps/_quowmap_database.db` to confirm no false-positive collisions. Do not loosen them to plain substring matches on "book", "paper", or "chalk" alone.
- A room only becomes a `stationery` *candidate* when ≥2 distinct categories matched; it still competes on raw item count against `weapon`/`armour`/`clothes`/`food`/`access` in the existing winner-take-all logic (highest count wins, ties fall back to `shop`).
- Full spec: `docs/superpowers/specs/2026-07-24-stationery-shop-type-design.md`.

---

## Pre-flight check

The working tree currently has **pre-existing, unrelated uncommitted changes** to `ui/data/room-types.json`, `ui/maps/am.js`, and `ui/maps/am.svg` — in-progress manual room-type tagging (shop/tavern/food/clothes/furniture) that predates this feature. `npm run build:svg` regenerates *all* map SVGs from current data, so if these are left uncommitted, Task 2's rebuild commit will bundle them together with the stationery changes.

- [ ] **Step 1: Check status and commit pending work separately**

```bash
git status --short
```

If `ui/data/room-types.json` / `ui/maps/am.js` / `ui/maps/am.svg` show as modified, commit that pending classification work on its own first, before starting Task 1, so the stationery feature commits stay focused:

```bash
git add ui/data/room-types.json ui/maps/am.js ui/maps/am.svg
git commit -m "chore(maps): continue manual room-type classification"
```

If `git status --short` is clean (someone already committed it), skip this — nothing else to do here.

---

### Task 1: Stationery detection logic

**Files:**
- Modify: `scripts/build-svg.mjs` (add category matchers, extend `classifyShopItems`, add `TYPE_LETTERS.stationery`, add `roomElement`/`TYPE_LETTERS` test coverage)
- Test: `scripts/build-svg.test.mjs`

**Interfaces:**
- Produces: `TYPE_LETTERS.stationery === 'Q'` (consumed by `ui/svg-renderer.js` and any code reading `TYPE_LETTERS`)
- Produces: `queryShopTypes(db, mapId, overrides)` now may return `'stationery'` for a room ID (consumed by `scripts/sync-svg-js.mjs` and the SVG build pipeline downstream — no signature change, same `Map<roomId, string>` return type as before)

- [ ] **Step 1: Write failing tests for stationery classification**

Open `scripts/build-svg.test.mjs` and add these five tests inside the existing `describe('queryShopTypes', ...)` block (after the last existing `it(...)`, before the block's closing `})`):

```js
  it('classifies a room with writing paper and quill as stationery', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Stationers')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'piece of writing paper', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'quill', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('stationery')
  })

  it('classifies a room with a colour book and quill as stationery', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Legibles')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'blue leather-bound book', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'seagull feather quill', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('stationery')
  })

  it('does not classify a room with only one stationery category as stationery', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Card Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'quill', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('shop')
  })

  it('does not count a bookcase as a colour book (word-boundary collision check)', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Furniture Nook')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'quill', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'oak bookcase', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('shop')
  })

  it('stationery loses to a larger competing type', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Odd Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'quill', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'stick of chalk', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'long sword', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'short sword', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'dagger', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'battle axe', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'crossbow', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('weapon')
  })

  it('manual override wins over an auto-detected stationery classification', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Odd Little Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'piece of writing paper', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'quill', '')").run()
    expect(queryShopTypes(db, 1, { 'r1': 'temple' }).get('r1')).toBe('temple')
  })
```

Also add these two tests inside the existing `describe('roomElement (with type)', ...)` block (after the last existing `it(...)`, before its closing `})`):

```js
  it('stationery typed room has type class and Q letter', () => {
    const el = roomElement('r1', 10, 20, 'Stationers', false, 'stationery')
    expect(el).toContain('class="room outdoor room-stationery"')
    expect(el).toContain('>Q<')
  })

  it('TYPE_LETTERS includes stationery as Q', () => {
    expect(TYPE_LETTERS.stationery).toBe('Q')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/build-svg.test.mjs
```

Expected: 8 new failures. The `stationery`-classification tests fail because `queryShopTypes` returns `'shop'` instead of `'stationery'` (the "loses to a larger competing type" and "manual override wins" cases already return `'weapon'`/`'temple'` correctly today, since neither depends on stationery detection existing — those two may pass by coincidence; the rest must fail). The `roomElement`/`TYPE_LETTERS` tests fail because `TYPE_LETTERS.stationery` is `undefined`, so the rendered `<text>` glyph is empty/`undefined` instead of `Q`.

- [ ] **Step 3: Implement the matchers and extend `classifyShopItems`**

In `scripts/build-svg.mjs`, find this block:

```js
export const SHOP_KEYWORDS = {
  weapon:  ['sword', 'axe', 'dagger', 'crossbow', 'bolt', 'spear', 'mace', 'flail', 'whip', 'lance'],
  armour:  ['armour', 'armor', 'shield', 'helm', 'mail', 'chainmail', 'breastplate', 'gauntlet'],
  clothes: ['coat', 'cloak', 'robe', 'gown', 'jacket', 'dress', 'shirt', 'trouser', 'skirt', 'shoe', 'boot', 'hat', 'wig'],
  food:    ['cake', 'pie', 'bread', 'meat', 'ale', 'beer', 'wine', 'cheese', 'soup', 'stew'],
  access:  ['ring', 'bracelet', 'necklace', 'earring', 'gem', 'jewel', 'brooch', 'pendant'],
}

export const TYPE_LETTERS = {
  shop: 'S', weapon: 'W', armour: 'A', clothes: 'C', food: 'F', access: 'X',
  furniture: 'U',
  bank: '$', changer: '¢', mission: '!', post: 'O', lang: 'L', temple: 'R',
  crafts: 'K', house: 'H', club: 'G', pshop: 'P', tshop: 'T', talker: 'M',
  tavern: 'V',
  pub:    'B',
}
```

Replace it with:

```js
export const SHOP_KEYWORDS = {
  weapon:  ['sword', 'axe', 'dagger', 'crossbow', 'bolt', 'spear', 'mace', 'flail', 'whip', 'lance'],
  armour:  ['armour', 'armor', 'shield', 'helm', 'mail', 'chainmail', 'breastplate', 'gauntlet'],
  clothes: ['coat', 'cloak', 'robe', 'gown', 'jacket', 'dress', 'shirt', 'trouser', 'skirt', 'shoe', 'boot', 'hat', 'wig'],
  food:    ['cake', 'pie', 'bread', 'meat', 'ale', 'beer', 'wine', 'cheese', 'soup', 'stew'],
  access:  ['ring', 'bracelet', 'necklace', 'earring', 'gem', 'jewel', 'brooch', 'pendant'],
}

// `stationery` isn't a flat keyword list like the ones above — a room only
// qualifies once >=2 of these 4 categories are matched (see classifyShopItems
// below). Patterns are precise phrase/word-boundary matches, chosen against
// the live shop_items corpus to dodge collisions (wallpaper/sandpaper vs
// writing paper; bookcase/notebook/pattern book vs colour book) that made the
// `furniture` type manual-only.
const STATIONERY_COLOUR_RE = /\b(red|blue|green|yellow|purple|black|white|brown|grey|gray|pink|orange|silver|gold|violet|scarlet|crimson|indigo|turquoise|colour|color)\b/i

export const STATIONERY_CATEGORY_MATCHERS = {
  paper: (item) => /writing paper/i.test(item),
  quill: (item) => /\bquill/i.test(item),
  chalk: (item) => /stick of chalk/i.test(item),
  book:  (item) => /\bbook\b/i.test(item) && STATIONERY_COLOUR_RE.test(item),
}

export const TYPE_LETTERS = {
  shop: 'S', weapon: 'W', armour: 'A', clothes: 'C', food: 'F', access: 'X',
  furniture: 'U', stationery: 'Q',
  bank: '$', changer: '¢', mission: '!', post: 'O', lang: 'L', temple: 'R',
  crafts: 'K', house: 'H', club: 'G', pshop: 'P', tshop: 'T', talker: 'M',
  tavern: 'V',
  pub:    'B',
}
```

Then find `classifyShopItems`:

```js
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
    else if (count === best) { winner = 'shop' }
  }
  return winner
}
```

Replace it with:

```js
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

  const stationeryCats = new Set()
  let stationeryCount = 0
  for (const item of items) {
    for (const [category, matches] of Object.entries(STATIONERY_CATEGORY_MATCHERS)) {
      if (matches(item)) { stationeryCats.add(category); stationeryCount++; break }
    }
  }
  if (stationeryCats.size >= 2) counts.stationery = stationeryCount

  let winner = 'shop'
  let best = 0
  for (const [type, count] of Object.entries(counts)) {
    if (count > best) { best = count; winner = type }
    else if (count === best) { winner = 'shop' }
  }
  return winner
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/build-svg.test.mjs
```

Expected: all tests pass, including the 7 new ones.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs
git commit -m "feat(maps): add auto-detected stationery shop room type"
```

---

### Task 2: Wire rendering, docs, and regenerate maps

**Files:**
- Modify: `ui/svg-renderer.js:3-11`
- Modify: `ui/mapper.css:122-124`
- Modify: `docs/map-data-guide.md:23-48`
- Regenerate: `ui/maps/*.svg`, `ui/maps/*.js` (via build scripts)

**Interfaces:**
- Consumes: `TYPE_LETTERS.stationery` and `queryShopTypes` from Task 1 (already committed) — no new interfaces produced, this task is pure wiring + regeneration.

- [ ] **Step 1: Add the label**

In `ui/svg-renderer.js`, find:

```js
const ROOM_TYPE_LABELS = {
  shop: 'General shop', weapon: 'Weapon shop', armour: 'Armour shop',
  clothes: 'Clothing shop', food: 'Food shop', access: 'Accessories shop',
  bank: 'Bank', changer: 'Money changer', mission: 'Mission office',
  post: 'Post office', lang: 'Language school', temple: 'Temple',
  crafts: 'Crafts shop', house: 'Player house', club: 'Player club',
  pshop: 'Player shop', tshop: 'Travelling shop', talker: 'Talker shop',
  tavern: 'Tavern / Restaurant', pub: 'Pub / Bar',
};
```

Replace with:

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
};
```

- [ ] **Step 2: Add the CSS colour grouping**

In `ui/mapper.css`, find:

```css
.room-shop, .room-weapon, .room-armour,
.room-clothes, .room-food, .room-access,
.room-furniture, .room-talker            { fill: #1c5c3a; }
```

Replace with:

```css
.room-shop, .room-weapon, .room-armour,
.room-clothes, .room-food, .room-access,
.room-furniture, .room-talker, .room-stationery { fill: #1c5c3a; }
```

- [ ] **Step 3: Add the docs table row**

In `docs/map-data-guide.md`, find:

```
| `furniture` | U | dark green | Manual only |
| `tavern` | V | dark amber | Auto — `room_short` contains "tavern", "restaurant", "pizza", "pizzeria" |
```

Replace with:

```
| `furniture` | U | dark green | Manual only |
| `stationery` | Q | dark green | Auto — `shop_items`; needs ≥2 of {writing paper, quill, colour book, stick of chalk} |
| `tavern` | V | dark amber | Auto — `room_short` contains "tavern", "restaurant", "pizza", "pizzeria" |
```

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all JS (vitest) and Lua tests pass.

- [ ] **Step 5: Regenerate all maps**

```bash
npm run build:svg && npm run sync:svg
```

Expected: the command completes without errors and prints per-map regeneration output (or updates `ui/maps/*.svg` and `ui/maps/*.js` silently, depending on script verbosity — check `git status --short` afterward to confirm files changed).

- [ ] **Step 6: Spot-check a known qualifying room**

"Toomer Stationers" and "Felicity Avenue Stationers" were confirmed during design (both match `book`+`paper`+`quill`) to qualify as `stationery`. Confirm the rebuild picked them up:

```bash
grep -l 'data-label="Toomer Stationers"' ui/maps/*.svg
```

Take the filename it prints (e.g. `ui/maps/am.svg`) and check the matching room element has the new class and letter:

```bash
grep -B2 -A2 'data-label="Toomer Stationers"' ui/maps/am.svg
```

Expected: the `<rect>`/`<circle>`/`<polygon>` for that room has `room-stationery` in its `class` attribute, and the following `<text class="room-type-label">` contains `Q`. If "Toomer Stationers" isn't on map `am` in this DB snapshot, adjust the grep to whichever map file matched in the first command — the room should exist somewhere given it was found during design-time DB validation.

- [ ] **Step 7: Commit**

```bash
git add ui/svg-renderer.js ui/mapper.css docs/map-data-guide.md ui/maps
git commit -m "feat(maps): wire up stationery shop rendering and regenerate map SVGs"
```

---

## Definition of done

- `npm test` passes (vitest + Lua suites).
- `queryShopTypes` returns `'stationery'` for rooms with ≥2 matching categories, `'shop'` for rooms with only 1, the correct competing type when another type has a higher raw item count, and a `room-types.json` manual override still wins over auto-detected `stationery`.
- `TYPE_LETTERS.stationery === 'Q'`, `ROOM_TYPE_LABELS.stationery === 'Stationery shop'`, `.room-stationery` renders dark green (`#1c5c3a`).
- `docs/map-data-guide.md` documents the new type.
- All map SVGs regenerated and at least one real qualifying room (e.g. "Toomer Stationers") verified to render with the `Q` glyph.
