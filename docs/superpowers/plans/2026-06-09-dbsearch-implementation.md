# Discworld DB Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `mallardx-discworld-dbsearch` Mallard plugin — two MUD commands (`dbsearch`, `dbroute`) that search Quow's Discworld map database and create a speedwalk alias to any result.

**Architecture:** A Node build script reads the mapper plugin's SQLite DB and writes five Lua data tables into `src/data/`. Two pure Lua modules (`search.lua`, `pathfind.lua`) contain all testable logic. `main.lua` wires GMCP tracking and two `mud.alias` handlers that call those modules and display results via `mud.note()`.

**Tech Stack:** Node.js (ESM), `better-sqlite3`, `vitest`, Lua 5.x (for running tests outside Mallard sandbox), Mallard Lua plugin API.

---

## File Map

| File | Purpose |
|------|---------|
| `plugin.toml` | Manifest — permissions, world match |
| `README.md` | User-facing docs, install steps, update workflow |
| `package.json` | Build tooling and npm scripts |
| `vitest.config.js` | Vitest config |
| `scripts/build-db.mjs` | SQLite → Lua table generator (exported functions + CLI) |
| `scripts/build-db.test.mjs` | Vitest tests for all generator functions |
| `src/main.lua` | GMCP tracking, alias registration, display logic |
| `src/search.lua` | Pure search functions (no Mallard API, testable with stock Lua) |
| `src/pathfind.lua` | BFS pathfinding adapted from Quow (no Mallard API, testable) |
| `src/data/rooms.lua` | Generated: `room_id → room_short` |
| `src/data/items.lua` | Generated: array of shop items with location |
| `src/data/npcs.lua` | Generated: array of NPCs with location |
| `src/data/npc_items.lua` | Generated: array of NPC-carried items with NPC and location |
| `src/data/exits.lua` | Generated: `room_id → { neighbor_id → direction }` |
| `tests/search_test.lua` | Lua assert-based tests for `src/search.lua` |
| `tests/pathfind_test.lua` | Lua assert-based tests for `src/pathfind.lua` |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `plugin.toml`
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `src/data/.gitkeep`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Create plugin.toml**

```toml
id                  = "net.mallard.discworld-dbsearch"
name                = "Discworld DB Search"
version             = "0.1.0"
description         = "Search Quow's Discworld map database for rooms, items, shops and NPCs, and speedwalk to any result. Requires mallardx-discworld-mapper."
language            = "lua"
entry               = "src/main.lua"
mallard_api_version = "1.0"
minimum_app_version = "0.6.0"
authors             = ["Wizard Quack"]
license             = "MIT"

[worlds]
match = ["discworld.starturtle.net:*"]

[permissions]
sends       = true
gmcp_access = ["room.info"]

[gmcp]
advertise = ["room.info"]
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "mallardx-discworld-dbsearch",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run && lua tests/search_test.lua && lua tests/pathfind_test.lua",
    "test:js": "vitest run",
    "test:lua": "lua tests/search_test.lua && lua tests/pathfind_test.lua",
    "build:data": "node scripts/build-db.mjs",
    "pack": "zip -r discworld-dbsearch-0.1.0.mallardx plugin.toml README.md src/ ui/"
  },
  "devDependencies": {
    "better-sqlite3": "^11.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create vitest.config.js**

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.mjs'],
  },
})
```

- [ ] **Step 4: Create placeholder directories**

```bash
mkdir -p src/data tests
touch src/data/.gitkeep tests/.gitkeep
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, `package-lock.json` written.

- [ ] **Step 6: Commit**

```bash
git add plugin.toml package.json package-lock.json vitest.config.js src/data/.gitkeep tests/.gitkeep
git commit -m "feat: project scaffolding — plugin.toml, package.json, vitest config"
```

---

## Task 2: Build Script — Foundation and Rooms Generator

**Files:**
- Create: `scripts/build-db.mjs`
- Create: `scripts/build-db.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/build-db.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { generateRoomsLua } from './build-db.mjs'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      map_id INTEGER NOT NULL,
      xpos INTEGER NOT NULL,
      ypos INTEGER NOT NULL,
      room_short TEXT NOT NULL,
      room_type TEXT NOT NULL
    )
  `)
  return db
}

describe('generateRoomsLua', () => {
  it('returns a Lua table mapping room_id to room_short', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('abc123','1','100','200','The Drum','inside')").run()
    const lua = generateRoomsLua(db)
    expect(lua).toContain("['abc123'] = 'The Drum'")
  })

  it('escapes single quotes in room names', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1','1','0','0',\"Assassin's Guild\",'inside')").run()
    const lua = generateRoomsLua(db)
    expect(lua).toContain("Assassin\\'s Guild")
  })

  it('starts with auto-generated comment and return {', () => {
    const db = makeDb()
    const lua = generateRoomsLua(db)
    expect(lua).toMatch(/^-- Auto-generated/)
    expect(lua).toContain('return {')
  })

  it('ends with }', () => {
    const db = makeDb()
    const lua = generateRoomsLua(db)
    expect(lua.trim()).toMatch(/\}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/build-db.test.mjs
```

Expected: FAIL — `Cannot find module './build-db.mjs'`

- [ ] **Step 3: Create build-db.mjs with escape helper and generateRoomsLua**

Create `scripts/build-db.mjs`:

```js
import { fileURLToPath } from 'url'
import { resolve, dirname, join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'

const HEADER = '-- Auto-generated by scripts/build-db.mjs. Do not edit by hand.\n'

function luaStr(s) {
  if (s == null) return "''"
  return "'" + String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/\0/g, '') + "'"
}

export function generateRoomsLua(db) {
  const rows = db.prepare('SELECT room_id, room_short FROM rooms').all()
  const lines = [HEADER + 'return {']
  for (const row of rows) {
    lines.push(`  [${luaStr(row.room_id)}] = ${luaStr(row.room_short)},`)
  }
  lines.push('}')
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run scripts/build-db.test.mjs
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-db.mjs scripts/build-db.test.mjs
git commit -m "feat: build script foundation — luaStr escape helper and generateRoomsLua"
```

---

## Task 3: Build Script — Items, NPCs, and NPC Items Generators

**Files:**
- Modify: `scripts/build-db.mjs` (add three generator functions)
- Modify: `scripts/build-db.test.mjs` (add tests for all three)

- [ ] **Step 1: Add failing tests for the three new generators**

Append to `scripts/build-db.test.mjs`:

```js
import { generateItemsLua, generateNpcsLua, generateNpcItemsLua } from './build-db.mjs'

function makeFullDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY, map_id INTEGER NOT NULL,
      xpos INTEGER NOT NULL, ypos INTEGER NOT NULL,
      room_short TEXT NOT NULL, room_type TEXT NOT NULL
    );
    CREATE TABLE shop_items (
      room_id TEXT NOT NULL, item_name TEXT NOT NULL, sale_price TEXT NOT NULL
    );
    CREATE TABLE npc_info (
      npc_id TEXT PRIMARY KEY, map_id INTEGER NOT NULL,
      npc_name TEXT NOT NULL, room_id TEXT NOT NULL
    );
    CREATE TABLE npc_items (
      npc_id TEXT NOT NULL, item_name TEXT NOT NULL, sale_price TEXT NOT NULL
    );
  `)
  db.prepare("INSERT INTO rooms VALUES ('r1',1,0,0,'weapon shop','inside')").run()
  db.prepare("INSERT INTO rooms VALUES ('r2',1,0,0,'market square','outside')").run()
  db.prepare("INSERT INTO shop_items VALUES ('r1','long sword','A\\$180')").run()
  db.prepare("INSERT INTO npc_info VALUES ('npc1',1,'city guard','r2')").run()
  db.prepare("INSERT INTO npc_items VALUES ('npc1','dagger','')").run()
  return db
}

describe('generateItemsLua', () => {
  it('includes item name, room_id, location and price', () => {
    const db = makeFullDb()
    const lua = generateItemsLua(db)
    expect(lua).toContain("name = 'long sword'")
    expect(lua).toContain("room_id = 'r1'")
    expect(lua).toContain("location = 'weapon shop'")
    expect(lua).toContain("price = 'A\\$180'")
  })

  it('is a valid Lua array literal', () => {
    const db = makeFullDb()
    const lua = generateItemsLua(db)
    expect(lua).toContain('return {')
    expect(lua.trim()).toMatch(/\}$/)
  })
})

describe('generateNpcsLua', () => {
  it('includes npc name, room_id and location', () => {
    const db = makeFullDb()
    const lua = generateNpcsLua(db)
    expect(lua).toContain("name = 'city guard'")
    expect(lua).toContain("room_id = 'r2'")
    expect(lua).toContain("location = 'market square'")
  })
})

describe('generateNpcItemsLua', () => {
  it('includes item name, npc name, room_id, location and price', () => {
    const db = makeFullDb()
    const lua = generateNpcItemsLua(db)
    expect(lua).toContain("name = 'dagger'")
    expect(lua).toContain("npc = 'city guard'")
    expect(lua).toContain("room_id = 'r2'")
    expect(lua).toContain("location = 'market square'")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/build-db.test.mjs
```

Expected: FAIL — `generateItemsLua is not a function` (and same for the others).

- [ ] **Step 3: Add the three generators to build-db.mjs**

Append to `scripts/build-db.mjs` (after `generateRoomsLua`):

```js
export function generateItemsLua(db) {
  const rows = db.prepare(`
    SELECT si.item_name, si.room_id, si.sale_price, r.room_short
    FROM shop_items si
    JOIN rooms r ON si.room_id = r.room_id
    ORDER BY si.item_name COLLATE NOCASE
  `).all()
  const lines = [HEADER + 'return {']
  for (const row of rows) {
    lines.push(`  { name = ${luaStr(row.item_name)}, room_id = ${luaStr(row.room_id)}, location = ${luaStr(row.room_short)}, price = ${luaStr(row.sale_price ?? '')} },`)
  }
  lines.push('}')
  return lines.join('\n')
}

export function generateNpcsLua(db) {
  const rows = db.prepare(`
    SELECT ni.npc_name, ni.room_id, r.room_short
    FROM npc_info ni
    JOIN rooms r ON ni.room_id = r.room_id
    ORDER BY ni.npc_name COLLATE NOCASE
  `).all()
  const lines = [HEADER + 'return {']
  for (const row of rows) {
    lines.push(`  { name = ${luaStr(row.npc_name)}, room_id = ${luaStr(row.room_id)}, location = ${luaStr(row.room_short)} },`)
  }
  lines.push('}')
  return lines.join('\n')
}

export function generateNpcItemsLua(db) {
  const rows = db.prepare(`
    SELECT nit.item_name, ni.npc_name, ni.room_id, r.room_short, nit.sale_price
    FROM npc_items nit
    JOIN npc_info ni ON nit.npc_id = ni.npc_id
    JOIN rooms r ON ni.room_id = r.room_id
    ORDER BY nit.item_name COLLATE NOCASE
  `).all()
  const lines = [HEADER + 'return {']
  for (const row of rows) {
    lines.push(`  { name = ${luaStr(row.item_name)}, npc = ${luaStr(row.npc_name)}, room_id = ${luaStr(row.room_id)}, location = ${luaStr(row.room_short)}, price = ${luaStr(row.sale_price ?? '')} },`)
  }
  lines.push('}')
  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/build-db.test.mjs
```

Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-db.mjs scripts/build-db.test.mjs
git commit -m "feat: build script — items, npcs, npc_items generators"
```

---

## Task 4: Build Script — Exits Generator

**Files:**
- Modify: `scripts/build-db.mjs` (add `generateExitsLua`)
- Modify: `scripts/build-db.test.mjs` (add exits tests)

- [ ] **Step 1: Add failing test**

Append to `scripts/build-db.test.mjs`:

```js
import { generateExitsLua } from './build-db.mjs'

function makeExitsDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE room_exits (
      room_id TEXT NOT NULL, connect_id TEXT NOT NULL,
      exit TEXT NOT NULL, guessed INTEGER NOT NULL
    )
  `)
  db.prepare("INSERT INTO room_exits VALUES ('r1','r2','n',0)").run()
  db.prepare("INSERT INTO room_exits VALUES ('r2','r1','s',0)").run()
  db.prepare("INSERT INTO room_exits VALUES ('r1','r3','e',0)").run()
  return db
}

describe('generateExitsLua', () => {
  it('groups exits by room_id into nested tables', () => {
    const db = makeExitsDb()
    const lua = generateExitsLua(db)
    expect(lua).toContain("['r1'] = {")
    expect(lua).toContain("['r2'] = 'n'")
    expect(lua).toContain("['r3'] = 'e'")
  })

  it('includes reverse direction from r2', () => {
    const db = makeExitsDb()
    const lua = generateExitsLua(db)
    expect(lua).toContain("['r2'] = {")
    expect(lua).toContain("['r1'] = 's'")
  })

  it('is a valid Lua table literal', () => {
    const db = makeExitsDb()
    const lua = generateExitsLua(db)
    expect(lua).toContain('return {')
    expect(lua.trim()).toMatch(/\}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/build-db.test.mjs
```

Expected: FAIL — `generateExitsLua is not a function`.

- [ ] **Step 3: Add generateExitsLua to build-db.mjs**

Append to `scripts/build-db.mjs`:

```js
export function generateExitsLua(db) {
  const rows = db.prepare('SELECT room_id, connect_id, exit FROM room_exits').all()

  const byRoom = new Map()
  for (const row of rows) {
    if (!byRoom.has(row.room_id)) byRoom.set(row.room_id, [])
    byRoom.get(row.room_id).push({ neighbor: row.connect_id, dir: row.exit })
  }

  const lines = [HEADER + 'return {']
  for (const [roomId, exits] of byRoom) {
    const parts = exits.map(e => `[${luaStr(e.neighbor)}] = ${luaStr(e.dir)}`).join(', ')
    lines.push(`  [${luaStr(roomId)}] = { ${parts} },`)
  }
  lines.push('}')
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run scripts/build-db.test.mjs
```

Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-db.mjs scripts/build-db.test.mjs
git commit -m "feat: build script — exits generator"
```

---

## Task 5: Build Script — CLI Entry Point

**Files:**
- Modify: `scripts/build-db.mjs` (add `main()` and CLI guard)

- [ ] **Step 1: Append CLI entry point to build-db.mjs**

```js
const DEFAULT_DB = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'mallardx-discworld-mapper', 'maps', '_quowmap_database.db'
)

async function main() {
  const args = process.argv.slice(2)
  const dbFlagIdx = args.indexOf('--db')
  const dbPath = dbFlagIdx !== -1
    ? resolve(args[dbFlagIdx + 1])
    : DEFAULT_DB

  console.log(`Reading DB: ${dbPath}`)
  const db = new Database(dbPath, { readonly: true })

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')
  mkdirSync(outDir, { recursive: true })

  const generators = [
    ['rooms.lua',     generateRoomsLua],
    ['items.lua',     generateItemsLua],
    ['npcs.lua',      generateNpcsLua],
    ['npc_items.lua', generateNpcItemsLua],
    ['exits.lua',     generateExitsLua],
  ]

  for (const [filename, gen] of generators) {
    const content = gen(db)
    writeFileSync(join(outDir, filename), content, 'utf8')
    console.log(`  ✓ src/data/${filename}`)
  }

  db.close()
  console.log('Done.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 2: Verify the CLI guard doesn't break tests**

```bash
npx vitest run scripts/build-db.test.mjs
```

Expected: PASS — all tests still pass (the `main()` block doesn't execute during import).

- [ ] **Step 3: Commit**

```bash
git add scripts/build-db.mjs
git commit -m "feat: build script — CLI entry point with --db flag"
```

---

## Task 6: Generate Data Files from Real Database

**Files:**
- Create: `src/data/rooms.lua`, `src/data/items.lua`, `src/data/npcs.lua`, `src/data/npc_items.lua`, `src/data/exits.lua`

- [ ] **Step 1: Run build script against the real DB**

The mapper's DB lives at `claude_resources/quow_cowbar/maps/_quowmap_database.db` relative to this project (it is excluded from git via `.gitignore` but present on disk during development):

```bash
npm run build:data -- --db claude_resources/quow_cowbar/maps/_quowmap_database.db
```

Expected output:
```
Reading DB: .../claude_resources/quow_cowbar/maps/_quowmap_database.db
  ✓ src/data/rooms.lua
  ✓ src/data/items.lua
  ✓ src/data/npcs.lua
  ✓ src/data/npc_items.lua
  ✓ src/data/exits.lua
Done.
```

- [ ] **Step 2: Verify generated files look correct**

```bash
wc -l src/data/rooms.lua src/data/items.lua src/data/npcs.lua src/data/npc_items.lua src/data/exits.lua
head -5 src/data/rooms.lua
head -5 src/data/items.lua
```

Expected: rooms ~18800 lines, items ~14800, npcs ~2930, npc_items ~18060, exits ~18780. First lines start with `-- Auto-generated` followed by `return {`.

- [ ] **Step 3: Spot-check a known room**

```bash
grep -i "Mended Drum" src/data/rooms.lua | head -3
grep -i "long sword" src/data/items.lua | head -3
grep -i "Ridcully" src/data/npcs.lua | head -3
```

Expected: at least one match for each.

- [ ] **Step 4: Remove the placeholder and commit generated files**

```bash
rm src/data/.gitkeep
git add src/data/
git commit -m "feat: generate Lua data tables from Quow's map database"
```

---

## Task 7: Search Module

**Files:**
- Create: `src/search.lua`
- Create: `tests/search_test.lua`

- [ ] **Step 1: Write the failing Lua test**

Create `tests/search_test.lua`:

```lua
-- Run from project root: lua tests/search_test.lua
package.path = './src/?.lua;' .. package.path

local search = require('search')

local passed = 0
local function test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    passed = passed + 1
    print('PASS: ' .. name)
  else
    print('FAIL: ' .. name .. ' — ' .. tostring(err))
    os.exit(1)
  end
end

-- ── search_rooms ─────────────────────────────────────────────────────────────
local rooms = {
  r1 = 'The Mended Drum',
  r2 = 'Broad Way',
  r3 = 'outside the drum',
}

test('room: finds case-insensitive match', function()
  local res = search.search_rooms(rooms, 'drum')
  assert(#res == 2, 'expected 2, got ' .. #res)
end)

test('room: returns zero results when no match', function()
  local res = search.search_rooms(rooms, 'zzznomatch')
  assert(#res == 0)
end)

test('room: result has room_id, name, location', function()
  local res = search.search_rooms(rooms, 'Broad')
  assert(#res == 1)
  assert(res[1].room_id == 'r2')
  assert(res[1].name == 'Broad Way')
  assert(res[1].location == 'Broad Way')
end)

test('room: capped at 30 results', function()
  local big = {}
  for i = 1, 50 do big['room' .. i] = 'test room ' .. i end
  local res = search.search_rooms(big, 'test')
  assert(#res == 30, 'expected 30, got ' .. #res)
end)

-- ── search_items ──────────────────────────────────────────────────────────────
local items = {
  { name = 'long sword',  room_id = 'r1', location = 'weapon shop', price = 'A$180' },
  { name = 'short sword', room_id = 'r2', location = 'armory',      price = 'A$90'  },
  { name = 'shield',      room_id = 'r3', location = 'armory',      price = 'A$50'  },
}

test('item: finds matches', function()
  local res = search.search_items(items, 'sword')
  assert(#res == 2, 'expected 2, got ' .. #res)
end)

test('item: case insensitive', function()
  local res = search.search_items(items, 'SWORD')
  assert(#res == 2)
end)

test('item: result has room_id, name, location, price', function()
  local res = search.search_items(items, 'shield')
  assert(#res == 1)
  assert(res[1].room_id == 'r3')
  assert(res[1].price == 'A$50')
end)

-- ── search_npcs ───────────────────────────────────────────────────────────────
local npcs = {
  { name = 'city guard',  room_id = 'r1', location = 'Market Square' },
  { name = 'court wizard', room_id = 'r2', location = 'Palace'       },
}

test('npc: finds match', function()
  local res = search.search_npcs(npcs, 'wizard')
  assert(#res == 1)
  assert(res[1].name == 'court wizard')
end)

-- ── search_npc_items ──────────────────────────────────────────────────────────
local npc_items = {
  { name = 'dagger', npc = 'city guard', room_id = 'r1', location = 'Market Square', price = '' },
  { name = 'staff',  npc = 'court wizard', room_id = 'r2', location = 'Palace',      price = '' },
}

test('npcitem: finds match', function()
  local res = search.search_npc_items(npc_items, 'dag')
  assert(#res == 1)
  assert(res[1].npc == 'city guard')
end)

print(string.format('\n%d tests passed.', passed))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
lua tests/search_test.lua
```

Expected: FAIL — `module 'search' not found`.

- [ ] **Step 3: Create src/search.lua**

```lua
-- src/search.lua
-- Pure search functions over Quow's Discworld map data tables.
-- Credit: data sourced from Quow's Cow Bar and Minimap — https://quow.co.uk/minimap.php

local M = {}
local MAX_RESULTS = 30

function M.search_rooms(rooms, query)
  local q = string.lower(query)
  local results = {}
  for room_id, room_short in pairs(rooms) do
    if string.find(string.lower(room_short), q, 1, true) then
      table.insert(results, { room_id = room_id, name = room_short, location = room_short })
      if #results >= MAX_RESULTS then break end
    end
  end
  return results
end

function M.search_items(items, query)
  local q = string.lower(query)
  local results = {}
  for _, item in ipairs(items) do
    if string.find(string.lower(item.name), q, 1, true) then
      table.insert(results, {
        room_id  = item.room_id,
        name     = item.name,
        location = item.location,
        price    = item.price,
      })
      if #results >= MAX_RESULTS then break end
    end
  end
  return results
end

function M.search_npcs(npcs, query)
  local q = string.lower(query)
  local results = {}
  for _, npc in ipairs(npcs) do
    if string.find(string.lower(npc.name), q, 1, true) then
      table.insert(results, {
        room_id  = npc.room_id,
        name     = npc.name,
        location = npc.location,
      })
      if #results >= MAX_RESULTS then break end
    end
  end
  return results
end

function M.search_npc_items(npc_items, query)
  local q = string.lower(query)
  local results = {}
  for _, item in ipairs(npc_items) do
    if string.find(string.lower(item.name), q, 1, true) then
      table.insert(results, {
        room_id  = item.room_id,
        name     = item.name,
        npc      = item.npc,
        location = item.location,
        price    = item.price,
      })
      if #results >= MAX_RESULTS then break end
    end
  end
  return results
end

return M
```

- [ ] **Step 4: Run test to verify it passes**

```bash
lua tests/search_test.lua
```

Expected:
```
PASS: room: finds case-insensitive match
...
10 tests passed.
```

- [ ] **Step 5: Commit**

```bash
git add src/search.lua tests/search_test.lua
git commit -m "feat: search module with case-insensitive room/item/npc/npc_item search"
```

---

## Task 8: Pathfinding Module

**Files:**
- Create: `src/pathfind.lua`
- Create: `tests/pathfind_test.lua`

- [ ] **Step 1: Write the failing Lua test**

Create `tests/pathfind_test.lua`:

```lua
-- Run from project root: lua tests/pathfind_test.lua
package.path = './src/?.lua;' .. package.path

local pathfind = require('pathfind')

local passed = 0
local function test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    passed = passed + 1
    print('PASS: ' .. name)
  else
    print('FAIL: ' .. name .. ' — ' .. tostring(err))
    os.exit(1)
  end
end

-- Simple graph: A -[n]-> B -[e]-> C
--                        B -[n]-> D
local exits = {
  A = { B = 'n' },
  B = { A = 's', C = 'e', D = 'n' },
  C = { B = 'w' },
  D = { B = 's' },
}

test('finds shortest path A to C', function()
  local path, steps = pathfind.find_path(exits, 'A', 'C')
  assert(path == 'n;e', 'expected "n;e" got "' .. tostring(path) .. '"')
  assert(steps == 2, 'expected 2 steps, got ' .. tostring(steps))
end)

test('finds path A to D', function()
  local path, steps = pathfind.find_path(exits, 'A', 'D')
  assert(path == 'n;n', 'expected "n;n" got "' .. tostring(path) .. '"')
  assert(steps == 2)
end)

test('returns nil when start == target', function()
  local path = pathfind.find_path(exits, 'A', 'A')
  assert(path == nil)
end)

test('returns nil for unreachable target', function()
  local exits2 = { A = { B = 'n' }, B = { A = 's' }, X = {} }
  local path = pathfind.find_path(exits2, 'A', 'X')
  assert(path == nil, 'expected nil, got ' .. tostring(path))
end)

test('returns nil when start not in exits', function()
  local path = pathfind.find_path(exits, 'Z', 'C')
  assert(path == nil)
end)

test('returns nil when target not in exits', function()
  local path = pathfind.find_path(exits, 'A', 'Z')
  assert(path == nil)
end)

test('returns nil for nil inputs', function()
  assert(pathfind.find_path(exits, nil, 'C') == nil)
  assert(pathfind.find_path(exits, 'A', nil) == nil)
end)

print(string.format('\n%d tests passed.', passed))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
lua tests/pathfind_test.lua
```

Expected: FAIL — `module 'pathfind' not found`.

- [ ] **Step 3: Create src/pathfind.lua**

```lua
-- src/pathfind.lua
-- BFS pathfinding adapted from Quow's Cow Bar and Minimap plugin.
-- Credit: Quow — https://quow.co.uk/minimap.php

local M = {}

-- find_path(exits, start_id, target_id)
-- exits: { [room_id] = { [neighbor_id] = direction, ... }, ... }
-- Returns path string (e.g. "n;e;s") and step count, or nil if unreachable.
function M.find_path(exits, start_id, target_id)
  if start_id == nil or target_id == nil then return nil end
  if start_id == target_id then return nil end
  if exits[start_id] == nil then return nil end
  if exits[target_id] == nil then return nil end

  local queue     = { start_id }      -- room_id indexed by queue position
  local id_to_idx = { [start_id] = 1 }
  local visited   = { [start_id] = true }
  local came_from = {}                 -- queue_idx -> { from_idx, direction }

  local next_i    = 1
  local total     = 1
  local depth     = 0
  local final_idx = 0
  local done      = false

  while not done do
    local prev_total = total
    for i = next_i, prev_total do
      if exits[queue[i]] then
        for neighbor, dir in pairs(exits[queue[i]]) do
          if not visited[neighbor] and final_idx == 0 then
            total = total + 1
            queue[total] = neighbor
            visited[neighbor] = true
            id_to_idx[neighbor] = total
            came_from[total] = { id_to_idx[queue[i]], dir }
            if queue[i] == target_id then
              done = true
              final_idx = i
            elseif neighbor == target_id then
              done = true
              final_idx = total
            end
          end
        end
      end
    end
    next_i = prev_total + 1
    if next_i > total then done = true end
    depth = depth + 1
    if depth > 500 then done = true; final_idx = 0 end
  end

  if final_idx == 0 then return nil end

  local path = {}
  local cur = final_idx
  while came_from[cur] do
    table.insert(path, 1, came_from[cur][2])
    cur = came_from[cur][1]
  end

  if #path == 0 then return nil end
  return table.concat(path, ';'), #path
end

return M
```

- [ ] **Step 4: Run test to verify it passes**

```bash
lua tests/pathfind_test.lua
```

Expected:
```
PASS: finds shortest path A to C
...
7 tests passed.
```

- [ ] **Step 5: Commit**

```bash
git add src/pathfind.lua tests/pathfind_test.lua
git commit -m "feat: BFS pathfinding module adapted from Quow's algorithm"
```

---

## Task 9: Main.lua — Foundation, GMCP Tracking, and dbsearch

**Files:**
- Create: `src/main.lua`

- [ ] **Step 1: Create src/main.lua with all wiring**

```lua
-- src/main.lua
-- Discworld DB Search — mallard plugin.
--
-- Commands:
--   dbsearch <type> <query>   type: room | item | npcitem | npc
--   dbroute <number>          route to result N, creates dbwalk alias in MUD
--
-- Data credit: Quow's Cow Bar and Minimap plugin — https://quow.co.uk/minimap.php

local search    = require('search')
local pathfind  = require('pathfind')
local rooms     = require('data.rooms')
local items     = require('data.items')
local npcs      = require('data.npcs')
local npc_items = require('data.npc_items')
local exits     = require('data.exits')

local last_results = {}
local current_room = nil

local C = {
  rule     = '#555555',
  header   = '#ffcc88',
  name     = '#ffffff',
  alt      = '#cccccc',
  location = '#88ccff',
  price    = '#aaffaa',
  err      = '#ff6666',
  ok       = '#aaffaa',
  muted    = '#888888',
}

local RULE = string.rep('─', 54)

local function note(text, colour)
  mud.note(text, { fg = colour or C.name })
end

-- ─── GMCP ────────────────────────────────────────────────────────────────────

gmcp.on('room.info', function(_, data)
  if type(data) == 'table' and data.identifier then
    current_room = data.identifier
  end
end)

-- ─── Display ─────────────────────────────────────────────────────────────────

local TYPE_LABELS = {
  room    = 'room',
  item    = 'item (shop)',
  npcitem = 'npc item',
  npc     = 'npc',
}

local function display_results(search_type, query, results)
  local count  = #results
  local suffix = count == 30 and '  (30 results — more may exist)' or
                 string.format('  (%d result%s)', count, count == 1 and '' or 's')
  note(string.format('  DB Search: %s — "%s"%s', TYPE_LABELS[search_type], query, suffix), C.header)
  note('  ' .. RULE, C.rule)

  for i, r in ipairs(results) do
    local colour = (i % 2 == 1) and C.name or C.alt
    local line
    if search_type == 'room' then
      line = string.format('  %2d.  %s', i, r.name)
    elseif search_type == 'item' then
      local price = (r.price ~= '') and ('   ' .. r.price) or ''
      line = string.format('  %2d.  %-40s [%s]%s', i, r.name, r.location, price)
    elseif search_type == 'npc' then
      line = string.format('  %2d.  %-40s [%s]', i, r.name, r.location)
    elseif search_type == 'npcitem' then
      local price = (r.price ~= '') and ('   ' .. r.price) or ''
      line = string.format('  %2d.  %-30s  via %-25s  [%s]%s', i, r.name, r.npc or '', r.location, price)
    end
    note(line, colour)
  end

  note('  ' .. RULE, C.rule)
  note('  Use  dbroute <number>  to navigate to a result.', C.muted)
end

-- ─── dbsearch ────────────────────────────────────────────────────────────────

mud.alias([[^dbsearch ([a-zA-Z]+)\s+(.+)$]], function(m)
  local search_type = string.lower(m[1])
  local query       = m[2]
  local results

  if search_type == 'room' then
    results = search.search_rooms(rooms, query)
  elseif search_type == 'item' then
    results = search.search_items(items, query)
  elseif search_type == 'npc' then
    results = search.search_npcs(npcs, query)
  elseif search_type == 'npcitem' then
    results = search.search_npc_items(npc_items, query)
  else
    note('  Unknown type "' .. search_type .. '". Valid types: room, item, npcitem, npc', C.err)
    return
  end

  last_results = results

  if #results == 0 then
    note(string.format('  No results for "%s" (type: %s).', query, search_type), C.muted)
    return
  end

  display_results(search_type, query, results)
end)

-- ─── dbroute ─────────────────────────────────────────────────────────────────

mud.alias([[^dbroute (\d+)$]], function(m)
  local n = tonumber(m[1])

  if #last_results == 0 then
    note('  No search results yet. Run dbsearch first.', C.err)
    return
  end
  if n < 1 or n > #last_results then
    note(string.format('  Result %d out of range (1–%d).', n, #last_results), C.err)
    return
  end
  if current_room == nil then
    note('  Current room unknown. Move through a mapped room first.', C.err)
    return
  end

  local target = last_results[n]

  if current_room == target.room_id then
    note('  You are already there.', C.ok)
    return
  end

  local path, steps = pathfind.find_path(exits, current_room, target.room_id)
  if path == nil then
    note('  Could not find a route. You may be in an untracked area, or the destination is unreachable.', C.err)
    return
  end

  mud.send('alias dbwalk ' .. path)
  note(string.format('  Route to "%s" — %d move%s.', target.location, steps, steps == 1 and '' or 's'), C.ok)
  note("  Alias 'dbwalk' created. Type 'dbwalk' to begin.", C.muted)

  if steps > 140 then
    note('  Warning: long route. Discworld clears movement queues after 5 minutes of idle time.', C.header)
  end
end)
```

- [ ] **Step 2: Run all tests to confirm nothing is broken**

```bash
npx vitest run && lua tests/search_test.lua && lua tests/pathfind_test.lua
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/main.lua
git commit -m "feat: main.lua — GMCP tracking, dbsearch and dbroute aliases"
```

---

## Task 10: README and Pack Script

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

```markdown
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
```

- [ ] **Step 2: Build the distributable package**

```bash
npm run pack
```

Expected: `discworld-dbsearch-0.1.0.mallardx` created in the project root.

- [ ] **Step 3: Verify the package contents**

```bash
unzip -l discworld-dbsearch-0.1.0.mallardx
```

Expected: `plugin.toml`, `README.md`, all `src/*.lua`, all `src/data/*.lua`, `ui/.gitkeep` — no `scripts/`, `tests/`, `node_modules/`, or `claude_resources/`.

- [ ] **Step 4: Commit README and add .mallardx to .gitignore**

The `.gitignore` already excludes `*.mallardx`. Commit the README:

```bash
git add README.md
git commit -m "docs: README with install, usage, and data update instructions"
```

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task |
|-----------------|------|
| `dbsearch room/item/npcitem/npc` alias | Task 9 |
| Case-insensitive search | Task 7 (`string.lower`) |
| 30-result cap | Task 7 (`MAX_RESULTS = 30`) |
| Numbered list output | Task 9 (`display_results`) |
| Instructions after results | Task 9 (`dbroute <number>` footer) |
| `dbroute <n>` creates `dbwalk` alias | Task 9 |
| BFS pathfinding | Task 8 |
| GMCP room tracking | Task 9 |
| Build script with `--db` flag | Task 5 |
| `npm run build:data` workflow | Task 1 |
| Credit to Quow | Tasks 7, 8, 9 (comments); Task 10 (README) |
| `plugin.toml` with correct permissions | Task 1 |
| Generated files committed | Task 6 |
| Distributable `.mallardx` package | Task 10 |

All requirements covered. No gaps.
