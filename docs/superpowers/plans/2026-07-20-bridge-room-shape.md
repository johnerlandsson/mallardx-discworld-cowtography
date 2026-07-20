# Bridge Room Shape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give rooms that are the physical span of a named bridge (e.g. King's Bridge on `am.svg`) a third, distinct map shape — a regular octagon — instead of rendering as a plain outdoor circle.

**Architecture:** `scripts/build-svg.mjs` already generates one of two SVG shapes per room (`<circle>` for outdoor, `<rect>` for indoor) from a `roomElement()` function, driven by hand-maintained JSON override files for other room properties (`room-water.json`, `room-green.json`, `room-danger.json`). This plan adds a third shape branch (`<polygon>`, a regular octagon) driven by a new hand-maintained `ui/data/room-bridge.json`, a read-only helper script to suggest candidates for that file, and a one-line duck-typing fix in `ui/svg-renderer.js` so the room-spacing calculation used for zoom-fit doesn't break on the new shape.

**Tech Stack:** Node.js (ESM, `.mjs`), vitest, `better-sqlite3` (unrelated to this feature — only used by the existing DB-driven build), plain SVG/DOM in the browser-side renderer. No new dependencies.

## Global Constraints

- `ui/data/room-bridge.json` is **hand-maintained only** — no script in this plan ever writes to it after it's seeded in Task 5. This mirrors `room-water.json`/`room-green.json`/`room-danger.json`, which the build pipeline only ever reads.
- The octagon must use the *same* bounding-box sizing (`hw = compact ? 1.5 : large ? 8 : 4`) as circle/rect rooms so it inherits the existing compact/large size variants for free.
- No new CSS rules — shape alone is the signal requested; `.bridge` is a marker class with no corresponding style block, same as the existing unstyled `.outdoor`/`.indoor` marker classes.
- Design reference: `docs/superpowers/specs/2026-07-20-bridge-room-shape-design.md`.

---

### Task 1: Octagon shape in `roomElement()`

**Files:**
- Modify: `scripts/build-svg.mjs:385-404` (the `roomElement` doc comment + function)
- Test: `scripts/build-svg.test.mjs:1-3` (import line), new `describe` blocks appended after the existing `describe('roomElement (compact)', ...)` block (currently ending at line 375)

**Interfaces:**
- Produces: `octagonPoints(x, y, hw)` — new exported function, returns an SVG `points` attribute string (space-separated `"x,y"` pairs) for a regular 8-gon centered at `(x, y)`, inscribed in the `2*hw × 2*hw` bounding square.
- Produces: `roomElement(id, x, y, short, isIndoor, type, compact, water, green, danger, large, bridge, extraClass)` — same as today with one new `bridge = false` parameter inserted **before** `extraClass` (i.e. as the 12th positional argument). When `bridge` is true, a `<polygon>` is emitted instead of the circle/rect branch, and `isIndoor` is ignored for shape purposes. The polygon carries `cx`/`cy` attributes (harmless on `<polygon>`, needed by Task 3) in addition to `points`.

- [ ] **Step 1: Write the failing tests**

Add `octagonPoints` to the existing import at the top of `scripts/build-svg.test.mjs`:

```js
import { queryRooms, queryExits, queryStairRooms, edgeId, roomElement, stairSymbol, stairCornerSymbol, buildStairLayer, exitElement, buildNewSvg, updateExistingSvg, queryShopTypes, TYPE_LETTERS, isWaterRoom, buildStackData, octagonPoints } from './build-svg.mjs'
```

Append these new `describe` blocks after the `roomElement (compact)` block (after line 375):

```js
describe('octagonPoints', () => {
  it('returns 8 vertices, all within the 2*hw bounding square', () => {
    const pts = octagonPoints(10, 20, 4).split(' ').map(p => p.split(',').map(Number))
    expect(pts).toHaveLength(8)
    for (const [px, py] of pts) {
      expect(px).toBeGreaterThanOrEqual(10 - 4 - 1e-9)
      expect(px).toBeLessThanOrEqual(10 + 4 + 1e-9)
      expect(py).toBeGreaterThanOrEqual(20 - 4 - 1e-9)
      expect(py).toBeLessThanOrEqual(20 + 4 + 1e-9)
    }
  })

  it('touches all four sides of the bounding square (inscribed, not inset)', () => {
    const pts = octagonPoints(10, 20, 4).split(' ').map(p => p.split(',').map(Number))
    expect(pts.some(([, py]) => Math.abs(py - (20 - 4)) < 1e-9)).toBe(true)  // top
    expect(pts.some(([, py]) => Math.abs(py - (20 + 4)) < 1e-9)).toBe(true)  // bottom
    expect(pts.some(([px]) => Math.abs(px - (10 - 4)) < 1e-9)).toBe(true)    // left
    expect(pts.some(([px]) => Math.abs(px - (10 + 4)) < 1e-9)).toBe(true)    // right
  })

  it('produces 8 equal-length edges (a regular octagon)', () => {
    const pts = octagonPoints(0, 0, 4).split(' ').map(p => p.split(',').map(Number))
    const lengths = pts.map((p, i) => {
      const [x1, y1] = p
      const [x2, y2] = pts[(i + 1) % pts.length]
      return Math.hypot(x2 - x1, y2 - y1)
    })
    for (const len of lengths) expect(len).toBeCloseTo(lengths[0], 9)
  })
})

describe('roomElement (bridge)', () => {
  it('returns a polygon with bridge+outdoor classes for bridge=true', () => {
    const el = roomElement('br1', 100, 200, "King's Bridge", false, null, false, false, false, false, false, true)
    expect(el).toContain('<polygon')
    expect(el).toContain('id="room-br1"')
    expect(el).toContain('class="room bridge outdoor"')
    expect(el).toContain('cx="100"')
    expect(el).toContain('cy="200"')
    expect(el).toContain('points="')
    expect(el).toContain('data-label="King&#x27;s Bridge"')
  })

  it('bridge shape wins over isIndoor=true', () => {
    const el = roomElement('br2', 10, 20, 'Indoor Bridge Room', true, null, false, false, false, false, false, true)
    expect(el).toContain('<polygon')
    expect(el).not.toContain('<rect')
  })

  it('non-bridge room is unaffected (still circle, no bridge class)', () => {
    const el = roomElement('r1', 10, 20, 'Room', false, null, false, false, false, false, false, false)
    expect(el).toContain('<circle')
    expect(el).not.toContain('bridge')
  })

  it('compact bridge room fits the compact (hw=1.5) bounding box', () => {
    const el = roomElement('br3', 10, 20, 'Small Bridge', false, null, true, false, false, false, false, true)
    expect(el).toContain('class="room bridge outdoor room-compact"')
    const pts = el.match(/points="([^"]+)"/)[1].split(' ').map(p => p.split(',').map(Number))
    for (const [px, py] of pts) {
      expect(px).toBeGreaterThanOrEqual(10 - 1.5 - 1e-9)
      expect(px).toBeLessThanOrEqual(10 + 1.5 + 1e-9)
      expect(py).toBeGreaterThanOrEqual(20 - 1.5 - 1e-9)
      expect(py).toBeLessThanOrEqual(20 + 1.5 + 1e-9)
    }
  })

  it('large bridge room fits the large (hw=8) bounding box', () => {
    const el = roomElement('br4', 10, 20, 'Big Bridge', false, null, false, false, false, false, true, true)
    const pts = el.match(/points="([^"]+)"/)[1].split(' ').map(p => p.split(',').map(Number))
    for (const [px, py] of pts) {
      expect(px).toBeGreaterThanOrEqual(10 - 8 - 1e-9)
      expect(px).toBeLessThanOrEqual(10 + 8 + 1e-9)
      expect(py).toBeGreaterThanOrEqual(20 - 8 - 1e-9)
      expect(py).toBeLessThanOrEqual(20 + 8 + 1e-9)
    }
  })

  it('bridge room can still carry a type letter', () => {
    const el = roomElement('br5', 10, 20, 'Bridge Shop', false, 'shop', false, false, false, false, false, true)
    expect(el).toContain('class="room bridge outdoor room-shop"')
    expect(el).toContain('<text class="room-type-label"')
    expect(el).toContain('>S<')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/build-svg.test.mjs`
Expected: FAIL — `octagonPoints is not a function` / `bridge` tests show `<circle>` instead of `<polygon>` (since `roomElement` doesn't accept a `bridge` param yet, it falls through to the existing circle/rect branch).

- [ ] **Step 3: Implement `octagonPoints` and wire it into `roomElement`**

Replace lines 385-404 of `scripts/build-svg.mjs`:

```js
// Returns an SVG polygon "points" attribute string for a regular "stop sign"
// octagon centered at (x, y), inscribed in the same 2*hw × 2*hw bounding
// square used by indoor rect rooms — so it inherits the same compact/large
// size classes. t is the corner-cut length that makes all 8 edges equal.
export function octagonPoints(x, y, hw) {
  const t = hw * (2 - Math.SQRT2)
  return [
    [x - hw + t, y - hw],
    [x + hw - t, y - hw],
    [x + hw,     y - hw + t],
    [x + hw,     y + hw - t],
    [x + hw - t, y + hw],
    [x - hw + t, y + hw],
    [x - hw,     y + hw - t],
    [x - hw,     y - hw + t],
  ].map(([px, py]) => `${px},${py}`).join(' ')
}

// type: null | string (key of TYPE_LETTERS)
// compact: true → small room (r=1.5 circle, 3×3 rect/octagon)
// water: true → room is in a body of water
// green: true → room is a park or forest
// danger: true → room is in a dangerous area
// large: true → large room (r=8 circle, 16×16 rect/octagon)
// bridge: true → room is the physical span of a named bridge; always drawn
//   as an octagon regardless of isIndoor.
export function roomElement(id, x, y, short, isIndoor, type = null, compact = false, water = false, green = false, danger = false, large = false, bridge = false, extraClass = '') {
  const label       = short ? ` data-label="${escapeXml(short)}"` : ''
  const typeClass   = type   ? ` room-${type}`  : ''
  const sizeClass   = compact ? ' room-compact'  : ''
  const waterClass  = water   ? ' water'          : ''
  const greenClass  = green   ? ' green'          : ''
  const dangerClass = danger  ? ' danger'         : ''
  const extraCls    = extraClass ? ` ${extraClass}` : ''
  const hw = compact ? 1.5 : large ? 8 : 4
  const shape = bridge
    ? `<polygon id="room-${id}" class="room bridge outdoor${typeClass}${sizeClass}${waterClass}${greenClass}${dangerClass}${extraCls}"${label} cx="${x}" cy="${y}" points="${octagonPoints(x, y, hw)}"/>`
    : isIndoor
      ? `<rect id="room-${id}" class="room indoor${typeClass}${sizeClass}${waterClass}${greenClass}${dangerClass}${extraCls}"${label} x="${x - hw}" y="${y - hw}" width="${hw * 2}" height="${hw * 2}" rx="${compact ? 0.75 : 2}"/>`
      : `<circle id="room-${id}" class="room outdoor${typeClass}${sizeClass}${waterClass}${greenClass}${dangerClass}${extraCls}"${label} cx="${x}" cy="${y}" r="${hw}"/>`
  const typeEl  = type  ? `<text class="room-type-label" font-size="4.5" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${TYPE_LETTERS[type]}</text>` : ''
  return shape + typeEl
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/build-svg.test.mjs`
Expected: PASS — all existing tests still pass (the new `bridge` param defaults to `false` and is appended before `extraClass`, so no existing positional call sites shift), plus all new `octagonPoints`/`roomElement (bridge)` tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs
git commit -m "feat(maps): add octagon room shape for bridge rooms"
```

---

### Task 2: Wire `room-bridge.json` through the SVG build pipeline

**Files:**
- Modify: `scripts/build-svg.mjs:15-25` (config path constants), `:437` (`buildNewSvg` signature+body), `:471` (`updateExistingSvg` signature+body), `:512-566` (`buildOneSvg`)
- Test: `scripts/build-svg.test.mjs` — extend the existing `describe('buildNewSvg', ...)` block (starts at line 548)

**Interfaces:**
- Consumes: `roomElement(..., large, bridge, extraClass)` from Task 1 — the 12th positional arg is `bridge`.
- Produces: `buildNewSvg(mapMeta, rooms, exits, mapId, stairRooms, shopTypes, compactRooms, waterOverrides, greenOverrides, exitExcludes, dangerOverrides, largeRooms, extraClasses, climbEdges, bridgeRooms = new Set())` and `updateExistingSvg(...)` with the same new trailing `bridgeRooms` parameter (15th positional arg on both). `bridgeRooms` is used directly as the final bridge-membership `Set` — no merging with a live classifier.

- [ ] **Step 1: Write the failing test**

Append to the `describe('buildNewSvg', ...)` block in `scripts/build-svg.test.mjs` (after the existing `'plain room unchanged when not in shopTypes'` test, before the closing `})` of that describe block):

```js
  it('renders bridge rooms as an octagon polygon, leaves others untouched', () => {
    const bridgeRooms = new Set(['r1'])
    const svg = buildNewSvg(mapMeta, rooms, exits, 7, new Map(), new Map(), new Set(), new Set(), new Set(), new Set(), new Set(), new Set(), new Map(), new Set(), bridgeRooms)
    expect(svg).toContain('<polygon id="room-r1" class="room bridge outdoor"')
    expect(svg).toContain('<circle id="room-r2"')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/build-svg.test.mjs -t "renders bridge rooms as an octagon"`
Expected: FAIL — `svg` doesn't contain `<polygon id="room-r1"...` (bridgeRooms isn't read by `buildNewSvg` yet, and passing it as a 15th arg is currently a no-op since the function doesn't declare that parameter).

- [ ] **Step 3: Add the `BRIDGE_CONFIG` constant and wire `bridgeRooms` through both builders**

In `scripts/build-svg.mjs`, add a new config path constant after line 21 (`const DANGER_CONFIG = ...`):

```js
const DANGER_CONFIG       = path.join(REPO_ROOT, 'ui', 'data', 'room-danger.json')
const BRIDGE_CONFIG       = path.join(REPO_ROOT, 'ui', 'data', 'room-bridge.json')
```

Change the `buildNewSvg` signature (line 437) and its `roomShapes` line (line 442):

```js
export function buildNewSvg(mapMeta, rooms, exits, mapId = '', stairRooms = new Map(), shopTypes = new Map(), compactRooms = new Set(), waterOverrides = new Set(), greenOverrides = new Set(), exitExcludes = new Set(), dangerOverrides = new Set(), largeRooms = new Set(), extraClasses = new Map(), climbEdges = new Set(), bridgeRooms = new Set()) {
  const waterRooms  = new Set(rooms.filter(r => isWaterRoom(r, waterOverrides)).map(r => r.id))
  const greenRooms  = new Set(rooms.filter(r => greenOverrides.has(r.id)).map(r => r.id))
  const dangerRooms = new Set(rooms.filter(r => dangerOverrides.has(r.id)).map(r => r.id))
  const exitLines   = buildExitLines(exits, rooms, compactRooms, waterRooms, greenRooms, dangerRooms, exitExcludes, climbEdges)
  const roomShapes  = rooms.map(r => '    ' + roomElement(r.id, r.x, r.y, r.short, r.roomType === 'inside', shopTypes.get(r.id) ?? null, compactRooms.has(r.id), waterRooms.has(r.id), greenRooms.has(r.id), dangerRooms.has(r.id), largeRooms.has(r.id), bridgeRooms.has(r.id), extraClasses.get(r.id) ?? '')).join('\n')
  const stairShapes = buildStairLayer(rooms, stairRooms, shopTypes)
```

Do the identical change to `updateExistingSvg` (line 471 signature, line 476 `roomShapes` line) — same new trailing `bridgeRooms = new Set()` parameter, same `bridgeRooms.has(r.id)` argument inserted into the `roomElement(...)` call right after `largeRooms.has(r.id)`.

In `buildOneSvg` (around line 537-538, right after the `dangerOverrides` load), add:

```js
  let dangerOverrides = new Set()
  try { dangerOverrides = new Set(JSON.parse(await fs.readFile(DANGER_CONFIG, 'utf8'))) } catch {}

  let bridgeOverrides = new Set()
  try { bridgeOverrides = new Set(JSON.parse(await fs.readFile(BRIDGE_CONFIG, 'utf8'))) } catch {}
```

Then update both call sites in `buildOneSvg` (lines 562 and 565) to pass `bridgeOverrides` as the final argument:

```js
    svg = updateExistingSvg(existing, mapMeta, roomRows, exitRows, stairRooms, shopTypes, compactRooms, waterOverrides, greenOverrides, exitExcludes, dangerOverrides, largeRooms, extraClasses, climbEdges, bridgeOverrides)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    svg = buildNewSvg(mapMeta, roomRows, exitRows, mapId, stairRooms, shopTypes, compactRooms, waterOverrides, greenOverrides, exitExcludes, dangerOverrides, largeRooms, extraClasses, climbEdges, bridgeOverrides)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/build-svg.test.mjs`
Expected: PASS — all tests including the new bridge-in-`buildNewSvg` test.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs
git commit -m "feat(maps): wire room-bridge.json overrides through the SVG build"
```

---

### Task 3: Fix `computeRoomUnit()` shape detection in `ui/svg-renderer.js`

**Files:**
- Modify: `ui/svg-renderer.js:21-31`

**Interfaces:**
- Consumes: the `cx`/`cy` attributes Task 1 added to bridge `<polygon>` elements.
- Produces: no new exports — internal bugfix only.

**Context:** `computeRoomUnit()` is used to pick a sensible zoom-fit unit by measuring the median distance between neighboring room centers. It currently branches on `el.tagName.toLowerCase() === 'circle'` to decide whether to read `cx`/`cy` or fall back to `x`/`y`/`width` — a `<polygon>` has neither, so without this fix every bridge room would push `[NaN, NaN]` into the distance calculation, silently corrupting the zoom-fit heuristic on any map containing a bridge. `findRoomByLabel()` a few hundred lines down in the same file already avoids this by checking `getAttribute('cx') !== null` instead of the tag name — this task applies that same duck-typed check here.

- [ ] **Step 1: Make the fix**

In `ui/svg-renderer.js`, replace lines 21-31:

```js
function computeRoomUnit(svgEl) {
  const pts = [];
  for (const el of svgEl.querySelectorAll('.room')) {
    if (el.tagName.toLowerCase() === 'circle') {
      pts.push([+el.getAttribute('cx'), +el.getAttribute('cy')]);
    } else {
      const x = +el.getAttribute('x'), w = +el.getAttribute('width');
      pts.push([x + w / 2, +el.getAttribute('y') + w / 2]);
    }
  }
```

with:

```js
function computeRoomUnit(svgEl) {
  const pts = [];
  for (const el of svgEl.querySelectorAll('.room')) {
    if (el.hasAttribute('cx')) {
      pts.push([+el.getAttribute('cx'), +el.getAttribute('cy')]);
    } else {
      const x = +el.getAttribute('x'), w = +el.getAttribute('width');
      pts.push([x + w / 2, +el.getAttribute('y') + w / 2]);
    }
  }
```

- [ ] **Step 2: Run the JS test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS — `ui/svg-renderer.js` has no dedicated test file today, so this step only confirms the change doesn't break anything else; this fix is verified for real in Task 6 via the `verify` skill.

- [ ] **Step 3: Commit**

```bash
git add ui/svg-renderer.js
git commit -m "fix(maps): detect room center by cx attribute, not tag name, for zoom-fit spacing"
```

---

### Task 4: `find-bridge-candidates.mjs` discovery script

**Files:**
- Create: `scripts/find-bridge-candidates.mjs`
- Create: `scripts/find-bridge-candidates.test.mjs`
- Modify: `package.json:11-12` (new `find:bridges` script entry)

**Interfaces:**
- Consumes: `rooms` exported from `ui/data/rooms.js` (`{ [roomId]: [mapId, x, y, shortName] }`).
- Produces: `isBridgeCandidate(name)` — exported pure function, `string|undefined -> boolean`. Used only by this script and its test; not imported by `build-svg.mjs`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/find-bridge-candidates.test.mjs`:

```js
import { describe, it, expect } from 'vitest'
import { isBridgeCandidate } from './find-bridge-candidates.mjs'

describe('isBridgeCandidate', () => {
  it('includes a plain named bridge', () => {
    expect(isBridgeCandidate("King's Bridge")).toBe(true)
  })

  it('includes a punnily-named bridge', () => {
    expect(isBridgeCandidate('Rubber bridge')).toBe(true)
  })

  it('includes "middle of X Bridge"', () => {
    expect(isBridgeCandidate('middle of New Bridge')).toBe(true)
  })

  it('includes "end of X Bridge"', () => {
    expect(isBridgeCandidate('east end of New Bridge')).toBe(true)
  })

  it('includes "section of X Bridge ..."', () => {
    expect(isBridgeCandidate('section of Rainbow Bridge connecting Hong Fa and Shoo-Li')).toBe(true)
  })

  it('includes "bridge over/spanning/between Y"', () => {
    expect(isBridgeCandidate('bridge over Lancre Gorge')).toBe(true)
    expect(isBridgeCandidate('bridge spanning the Sapphire Strand')).toBe(true)
    expect(isBridgeCandidate('bridge between two towers')).toBe(true)
  })

  it('excludes rooms under the bridge', () => {
    expect(isBridgeCandidate("under the King's Bridge")).toBe(false)
    expect(isBridgeCandidate('ledge underneath the Tora Bridge')).toBe(false)
  })

  it('excludes a street named after a bridge', () => {
    expect(isBridgeCandidate('Bridge Street')).toBe(false)
  })

  it('excludes a junction room that merely mentions a bridge', () => {
    expect(isBridgeCandidate("junction of Phedre Road with King's Way and King's Bridge")).toBe(false)
  })

  it('excludes a river room that merely mentions bridges in passing', () => {
    expect(isBridgeCandidate('Pearl River between two bridges')).toBe(false)
    expect(isBridgeCandidate('east of a bridge on Pearl Path')).toBe(false)
  })

  it('excludes empty or missing names', () => {
    expect(isBridgeCandidate('')).toBe(false)
    expect(isBridgeCandidate(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/find-bridge-candidates.test.mjs`
Expected: FAIL — `Cannot find module './find-bridge-candidates.mjs'` (file doesn't exist yet).

- [ ] **Step 3: Write `scripts/find-bridge-candidates.mjs`**

```js
// scripts/find-bridge-candidates.mjs
// Read-only helper: scans ui/data/rooms.js for room names that look like the
// physical span of a named bridge, and prints any not already listed in
// ui/data/room-bridge.json. Never writes room-bridge.json itself — that file
// is exclusively hand-maintained; copy in whatever candidates you agree with.
// Usage: node scripts/find-bridge-candidates.mjs

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rooms } from '../ui/data/rooms.js'

const __dirname     = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT     = path.resolve(__dirname, '..')
const BRIDGE_CONFIG = path.join(REPO_ROOT, 'ui', 'data', 'room-bridge.json')

// Matches room names that read as "you are standing on the bridge span itself".
const BRIDGE_INCLUDE_PATTERNS = [
  /\bbridge$/i,
  /^(?:the )?(?:middle|centre|center) of (?:the )?.*\bbridge\b/i,
  /^(?:the )?(?:north|south|east|west|northeast|southeast|northwest|southwest) end of (?:the )?.*\bbridge\b/i,
  /^section of .*\bbridge\b/i,
  /\bbridge (?:over|spanning|between)\b/i,
]

// Excludes names that would otherwise match but aren't the span itself.
const BRIDGE_EXCLUDE_PATTERNS = [
  /\bunder(?:neath)?\b/i,
  /^junction\b/i,
]

export function isBridgeCandidate(name) {
  if (!name) return false
  if (BRIDGE_EXCLUDE_PATTERNS.some(p => p.test(name))) return false
  return BRIDGE_INCLUDE_PATTERNS.some(p => p.test(name))
}

async function main() {
  let existing = new Set()
  try { existing = new Set(JSON.parse(await fs.readFile(BRIDGE_CONFIG, 'utf8'))) } catch {}

  const candidates = []
  for (const [id, [mapId, , , short]] of Object.entries(rooms)) {
    if (existing.has(id)) continue
    if (isBridgeCandidate(short)) candidates.push({ id, mapId, short })
  }

  if (candidates.length === 0) {
    console.log('[find-bridge-candidates] No new bridge candidates found.')
    return
  }

  console.log(`[find-bridge-candidates] ${candidates.length} new candidate(s) not in room-bridge.json:\n`)
  for (const { id, mapId, short } of candidates) {
    console.log(`  ${id}  map ${mapId}  "${short}"`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`[find-bridge-candidates] FAILED: ${e.message}`); process.exit(1) })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/find-bridge-candidates.test.mjs`
Expected: PASS — all `isBridgeCandidate` cases pass.

- [ ] **Step 5: Add the `find:bridges` npm script**

In `package.json`, add a new line after `"sync:svg": "node scripts/sync-svg-js.mjs",`:

```json
    "sync:svg": "node scripts/sync-svg-js.mjs",
    "find:bridges": "node scripts/find-bridge-candidates.mjs",
```

- [ ] **Step 6: Commit**

```bash
git add scripts/find-bridge-candidates.mjs scripts/find-bridge-candidates.test.mjs package.json
git commit -m "feat(maps): add find-bridge-candidates helper script"
```

---

### Task 5: Seed `ui/data/room-bridge.json`

**Files:**
- Create: `ui/data/room-bridge.json`

**Interfaces:**
- Consumes: `npm run find:bridges` (Task 4).
- Produces: `ui/data/room-bridge.json` — a flat JSON array of room-ID strings, read by `buildOneSvg` (Task 2) at `BRIDGE_CONFIG`.

This task involves reviewing real output, not writing predetermined code — the exact room IDs are only known once the script runs against the live `ui/data/rooms.js` data.

- [ ] **Step 1: Run the candidate finder**

Run: `npm run find:bridges`
Expected output: a list of lines like `  <hash>  map <N>  "<room name>"` — since `room-bridge.json` doesn't exist yet, every match the heuristic finds is printed.

- [ ] **Step 2: Review the candidate list**

For each printed candidate, sanity-check the name against the include/exclude rules from Task 4 (on the bridge span itself vs. under it / a street / a passing mention). The heuristic is intentionally conservative (see the exclude patterns), so expect mostly true positives, but skim for surprises — e.g. a room whose name happens to end in "...bridge" as part of an unrelated proper noun.

- [ ] **Step 3: Write `ui/data/room-bridge.json`**

Write the room IDs you accepted in Step 2 as a JSON array, one per line, matching the style of `ui/data/room-water.json` — e.g. if `npm run find:bridges` printed `15a6d5704c99525f8196655c6e28186ce7777d14  map 1  "King's Bridge"` and you accepted it:

```json
[
  "15a6d5704c99525f8196655c6e28186ce7777d14"
]
```

Continue this way for every accepted candidate from the real `npm run find:bridges` output — the full list is only known once that command has actually been run against the live `ui/data/rooms.js`, so it can't be pre-written here.

- [ ] **Step 4: Re-run the finder to confirm it now reports nothing new**

Run: `npm run find:bridges`
Expected: `[find-bridge-candidates] No new bridge candidates found.`

- [ ] **Step 5: Commit**

```bash
git add ui/data/room-bridge.json
git commit -m "data(maps): seed initial bridge room list"
```

---

### Task 6: Regenerate map SVGs and verify in the browser

**Files:**
- Regenerates: `ui/maps/*.svg`, `ui/maps/*.js` (via existing `npm run build:svg` / `npm run sync:svg` scripts — no manual edits)

**Interfaces:**
- Consumes: `ui/data/room-bridge.json` (Task 5), the updated `roomElement`/`buildNewSvg`/`updateExistingSvg` (Tasks 1-2), the `computeRoomUnit` fix (Task 3).

- [ ] **Step 1: Run the full JS test suite**

Run: `npm run test:js`
Expected: PASS — every test from Tasks 1, 2, and 4, plus all pre-existing tests, still pass.

- [ ] **Step 2: Regenerate SVGs from the DB**

Run: `npm run build:svg`
Expected: `[build-svg] done.` with per-map `✓` lines; any map containing a room now listed in `room-bridge.json` gets that room's shape updated to a `<polygon class="room bridge ...">` in place (via `updateExistingSvg`, which preserves hand-edited layers like `layer-artwork`).

- [ ] **Step 3: Resync the compiled JS map bundles**

Run: `npm run sync:svg`
Expected: `ui/maps/*.js` files regenerated to match the updated `.svg` sources (same pattern as recent "chore(maps): regenerate map SVGs..." commits in this repo's history).

- [ ] **Step 4: Manually verify in the browser via the `verify` skill**

Invoke the `verify` skill to drive the map panel UI and confirm:
- On `am.svg`, King's Bridge (and any other bridge rooms seeded in Task 5) render as a visibly distinct octagon, not a circle.
- Clicking a bridge room still selects/routes to it correctly (confirms `findRoomByLabel`/click-detection logic works for the new shape).
- Zooming in/out on a map containing a bridge room behaves normally (confirms the Task 3 `computeRoomUnit` fix — no snapping glitches from the earlier `NaN` bug).

- [ ] **Step 5: Commit the regenerated map files**

```bash
git add ui/maps/
git commit -m "chore(maps): regenerate map SVGs with bridge room shape"
```

## Scope boundaries

**Not in scope (per the design spec):**
- Any change to `TYPE_LETTERS`/shop-type letter overlays.
- The ASCII Map panel (`ui/ascii_map.js`, `src/ansi_map.lua`).
- A live regex classifier wired into `build-svg.mjs` itself.
- Any new CSS fill/stroke styling for bridge rooms.
