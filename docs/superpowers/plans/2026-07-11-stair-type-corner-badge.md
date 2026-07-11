# Stair Symbol on Typed Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rooms that have both a stair and a room type currently lose their stair indicator entirely (it's suppressed in favor of the type letter). Add a small stair badge in the bottom-right corner of the room box for these rooms instead, so both pieces of info are visible.

**Architecture:** A new `stairCornerSymbol()` function in `scripts/build-svg.mjs` emits the same three shapes as the existing `stairSymbol()` (up/down/both), but scaled down and offset into the room's bottom-right corner instead of centered. `buildStairLayer()` picks whichever symbol function applies per room based on whether it has a type. Existing map SVGs are regenerated via the existing `npm run build:svg` pipeline, which already knows how to rebuild the `layer-stairs` group in place.

**Tech Stack:** Node.js (ESM), vitest, better-sqlite3 (SVG build pipeline only — no runtime/plugin code touched).

## Global Constraints

- No new CSS class or color — the corner badge reuses the existing `.stair-symbol` CSS rule (`ui/mapper.css`) verbatim.
- The emitted element keeps `id="stair-<roomId>"` for both the centered and corner variants — `svg-renderer.js`'s `#stair-${id}` lookups must keep working unchanged.
- Corner badge geometry is only designed for the standard 8×8-unit room box (half-width 4). Compact/large rooms are out of scope (confirmed zero rooms in the DB currently combine stairs + a type at those sizes).
- The ASCII Map panel (`ui/ascii_map.js`, `src/ansi_map.lua`) is out of scope — it has no room-type or stair concept.
- Reference spec: `docs/superpowers/specs/2026-07-11-stair-type-corner-badge-design.md`. Reference mockup with exact validated coordinates: `.superpowers/brainstorm/58613-1783805257/content/stair-type-options.html`.

---

### Task 1: Add `stairCornerSymbol()` 

**Files:**
- Modify: `scripts/build-svg.mjs:267-292` (add new function after `stairSymbol`)
- Test: `scripts/build-svg.test.mjs:1,150-179` (add import, add new `describe` block)

**Interfaces:**
- Produces: `stairCornerSymbol(x, y, hasUp, hasDown, id = null)` → `string` (an SVG `<polygon>` element string). Same signature shape as the existing `stairSymbol(x, y, hasUp, hasDown, id = null)`. Used by Task 2's `buildStairLayer()`.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/build-svg.test.mjs`, immediately after the closing `})` of the existing `describe('stairSymbol', ...)` block (currently ending at line 179, right before `describe('buildStairLayer', ...)`):

```js
describe('stairCornerSymbol', () => {
  it('returns an up wedge for hasUp only, offset into the bottom-right corner', () => {
    const s = stairCornerSymbol(10, 20, true, false)
    expect(s).toContain('class="stair-symbol"')
    expect(s).toContain('<polygon')
    expect(s).toContain('12.6,21.4')
    expect(s).toContain('12.6,22.6')
    expect(s).toContain('11.4,22.6')
  })

  it('returns a down wedge for hasDown only, offset into the bottom-right corner', () => {
    const s = stairCornerSymbol(10, 20, false, true)
    expect(s).toContain('12.6,22.6')
    expect(s).toContain('11.4,22.6')
    expect(s).toContain('11.4,21.4')
  })

  it('returns a small diamond (single polygon) for both, centered in the corner region', () => {
    const s = stairCornerSymbol(10, 20, true, true)
    expect(s).toContain('12,21.2')
    expect(s).toContain('12.8,22')
    expect(s).toContain('12,22.8')
    expect(s).toContain('11.2,22')
    expect((s.match(/<polygon/g) ?? []).length).toBe(1)
  })

  it('includes id attribute when id is provided', () => {
    const s = stairCornerSymbol(10, 20, true, false, 'stair-abc')
    expect(s).toContain('id="stair-abc"')
  })

  it('omits id attribute when id is not provided', () => {
    const s = stairCornerSymbol(10, 20, true, false)
    expect(s).not.toContain('id=')
  })

  it('stays within the room box, unlike the full-size centered symbol', () => {
    const corner = stairCornerSymbol(10, 20, true, true)
    const centered = stairSymbol(10, 20, true, true)
    expect(corner).not.toBe(centered)
  })
})
```

Also update the import line at the top of the file:

```js
import { queryRooms, queryExits, queryStairRooms, edgeId, roomElement, stairSymbol, stairCornerSymbol, buildStairLayer, exitElement, buildNewSvg, updateExistingSvg, queryShopTypes, TYPE_LETTERS, isWaterRoom, buildStackData } from './build-svg.mjs'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/build-svg.test.mjs -t stairCornerSymbol`
Expected: FAIL — `stairCornerSymbol is not a function` (or import error, since it doesn't exist in `build-svg.mjs` yet).

- [ ] **Step 3: Implement `stairCornerSymbol()`**

In `scripts/build-svg.mjs`, immediately after the closing `}` of `stairSymbol()` (currently line 280), add:

```js
// Returns SVG polygon for the stair direction indicator, scaled down and
// pushed into the bottom-right corner of the room box. Used instead of
// stairSymbol() for rooms that already show a type letter dead-center, so
// the letter stays legible and the stair info isn't lost entirely.
// Same shape semantics as stairSymbol (▲ up, ▼ down, ◆ both), offset by
// roughly +1.2..+2.8 units from center on both axes.
export function stairCornerSymbol(x, y, hasUp, hasDown, id = null) {
  const idAttr = id ? ` id="${id}"` : ''
  if (hasUp && hasDown) {
    return `<polygon${idAttr} class="stair-symbol" points="${x + 2},${y + 1.2} ${x + 2.8},${y + 2} ${x + 2},${y + 2.8} ${x + 1.2},${y + 2}"/>`
  }
  if (hasUp) {
    return `<polygon${idAttr} class="stair-symbol" points="${x + 2.6},${y + 1.4} ${x + 2.6},${y + 2.6} ${x + 1.4},${y + 2.6}"/>`
  }
  return `<polygon${idAttr} class="stair-symbol" points="${x + 2.6},${y + 2.6} ${x + 1.4},${y + 2.6} ${x + 1.4},${y + 1.4}"/>`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/build-svg.test.mjs -t stairCornerSymbol`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs
git commit -m "feat: add stairCornerSymbol for rooms with a type"
```

---

### Task 2: Wire `stairCornerSymbol()` into `buildStairLayer()`

**Files:**
- Modify: `scripts/build-svg.mjs:282-292`
- Test: `scripts/build-svg.test.mjs:181-217`

**Interfaces:**
- Consumes: `stairCornerSymbol(x, y, hasUp, hasDown, id)` from Task 1, `stairSymbol(x, y, hasUp, hasDown, id)` (existing).
- Produces: `buildStairLayer(rooms, stairRooms, shopTypes = new Map())` — same signature as before, but no longer drops rooms that have a type; it now renders the corner variant for them.

- [ ] **Step 1: Update the failing tests**

In `scripts/build-svg.test.mjs`, replace the two tests inside `describe('buildStairLayer', ...)` that currently cover the shop-type case (`'suppresses stair symbol for rooms with a shop type'` and `'emits stair for room with stairs but no shop type, skips room with shop type'`) with:

```js
  it('uses the corner-offset symbol for rooms with a shop type', () => {
    const stairRooms = new Map([['r1', { hasUp: true, hasDown: false }]])
    const shopTypes  = new Map([['r1', 'bank']])
    const result = buildStairLayer(rooms, stairRooms, shopTypes)
    expect(result).toBe('    ' + stairCornerSymbol(100, 200, true, false, 'stair-r1'))
  })

  it('emits the full-size symbol for rooms without a type, the corner symbol for rooms with one', () => {
    const stairRooms = new Map([
      ['r1', { hasUp: true,  hasDown: false }],
      ['r2', { hasUp: false, hasDown: true  }],
    ])
    const shopTypes = new Map([['r1', 'bank']])
    const result = buildStairLayer(rooms, stairRooms, shopTypes)
    expect(result).toContain(stairCornerSymbol(100, 200, true, false, 'stair-r1'))
    expect(result).toContain(stairSymbol(50, 75, false, true, 'stair-r2'))
  })
```

The rest of the `describe('buildStairLayer', ...)` block (the `'returns empty string when no stair rooms'` and `'emits a polygon with id="stair-{roomId}" for stair rooms'` tests) is unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/build-svg.test.mjs -t buildStairLayer`
Expected: FAIL — the two updated tests fail because `buildStairLayer` still filters out rooms with a shop type entirely (returns `''` instead of the corner symbol).

- [ ] **Step 3: Update `buildStairLayer()`**

In `scripts/build-svg.mjs`, replace:

```js
// Builds the content for <g id="layer-stairs">.
// Stair symbols are suppressed for rooms that have a shop type (type label takes priority).
export function buildStairLayer(rooms, stairRooms, shopTypes = new Map()) {
  return rooms
    .filter(r => stairRooms.has(r.id) && !shopTypes.has(r.id))
    .map(r => {
      const s = stairRooms.get(r.id)
      return '    ' + stairSymbol(r.x, r.y, s.hasUp, s.hasDown, `stair-${r.id}`)
    })
    .join('\n')
}
```

with:

```js
// Builds the content for <g id="layer-stairs">.
// Rooms with a type get the small corner-offset symbol (stairCornerSymbol)
// so the type letter stays dead-center and legible; rooms without a type
// get the full-size centered symbol (stairSymbol).
export function buildStairLayer(rooms, stairRooms, shopTypes = new Map()) {
  return rooms
    .filter(r => stairRooms.has(r.id))
    .map(r => {
      const s = stairRooms.get(r.id)
      const symbol = shopTypes.has(r.id) ? stairCornerSymbol : stairSymbol
      return '    ' + symbol(r.x, r.y, s.hasUp, s.hasDown, `stair-${r.id}`)
    })
    .join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/build-svg.test.mjs`
Expected: PASS (all tests in the file, including the unrelated ones — confirms nothing else broke)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-svg.mjs scripts/build-svg.test.mjs
git commit -m "feat: show corner stair badge instead of suppressing it on typed rooms"
```

---

### Task 3: Regenerate map SVGs and verify

**Files:**
- Modify (generated): `ui/maps/*.svg`, `ui/maps/*.js`, `ui/data/room-stacks.js`
- No test file — this task verifies via the full test suite plus a manual count check.

**Interfaces:**
- Consumes: `buildStairLayer()` from Task 2 (invoked internally by `npm run build:svg`'s existing `buildOneSvg()`/`updateExistingSvg()` pipeline — no code changes needed here, this task only re-runs the existing generator).

- [ ] **Step 1: Run the full test suite before regenerating, to confirm the baseline is clean**

Run: `npm test`
Expected: all vitest suites pass (153+ tests), and the three lua suites pass (run `luajit tests/search_test.lua && luajit tests/pathfind_test.lua && luajit tests/ansi_map_test.lua` directly if the `lua` binary isn't on `PATH` in this environment — `luajit` is a drop-in substitute here).

- [ ] **Step 2: Regenerate all map SVGs from the DB**

Run: `npm run build:svg`
Expected: output ending in `[build-svg] done.`, with one `✓` line per map and a `room-stacks.js written (...)` line. No `FAILED` line.

- [ ] **Step 3: Confirm the corner badge actually shows up**

Run:
```bash
grep -rl 'class="stair-symbol"' ui/maps/*.svg | wc -l
```
Expected: a non-zero count (some maps have stair rooms). Then spot-check one room combining a type and stairs — e.g. search for a `room-bank`/`room-shop`/etc. room whose `id` also has a matching `stair-<id>` polygon in the same file:

```bash
for f in ui/maps/*.svg; do
  for id in $(grep -oP '(?<=id=\"room-)[a-f0-9]+(?=\" class=\"room[^\"]*room-[a-z]+)' "$f"); do
    if grep -q "id=\"stair-$id\"" "$f"; then echo "$f: room-$id has both a type and a stair badge"; fi
  done
done | head -5
```
Expected: at least one line printed, confirming a real room in a real map now carries both a type class and a `stair-<id>` polygon (this would have been impossible before Task 2 — `buildStairLayer` used to drop the stair polygon for any room with a type).

- [ ] **Step 4: Run the full test suite again post-regeneration**

Run: `npm test`
Expected: same pass counts as Step 1 — regenerating the SVGs doesn't touch any test-covered logic beyond what Tasks 1–2 already covered, this just confirms the regeneration script itself didn't error partway and leave things inconsistent.

- [ ] **Step 5: Review the diff scope, then commit**

Run: `git status --short ui/maps/ ui/data/room-stacks.js` to see which map files changed (only maps containing at least one stair+type room should show a diff in their `layer-stairs` group; some whitespace-only diffs elsewhere in unrelated maps are possible since `build:svg` rewrites the whole `layer-rooms`/`layer-stairs` groups every run — that's expected and matches how this script has always behaved for unrelated changes).

```bash
git add ui/maps/ ui/data/room-stacks.js
git commit -m "chore: regenerate map SVGs with corner stair badges on typed rooms"
```

---

## Self-Review Notes

- **Spec coverage:** geometry (Task 1), `buildStairLayer` branching + toggle behavior via unchanged `layer-stairs`/`id="stair-*"` (Task 2), regeneration (Task 3), test updates for the three changed `buildStairLayer` behaviors (Task 2) and new `stairCornerSymbol` coverage (Task 1) are all covered. Scope boundaries (compact/large rooms, ASCII panel, direction-detection logic, light theme) require no tasks since they're explicitly non-goals.
- **No placeholders:** every step has literal code or an exact command with expected output.
- **Type/name consistency:** `stairCornerSymbol(x, y, hasUp, hasDown, id = null)` matches between Task 1's implementation and Task 2's usage in `buildStairLayer`; `id="stair-<roomId>"` naming is preserved identically to the existing `stairSymbol` convention so `svg-renderer.js` needs no changes (not touched by this plan).
