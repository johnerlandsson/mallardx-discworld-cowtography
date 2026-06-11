# map-label-accent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `map-label-accent` CSS class for annotation text that renders in the theme accent colour.

**Architecture:** One CSS rule in `mapper.css`, one selector added to `FONT_STYLE_BLOCK` in `sync-svg-js.mjs` (so Inkscape picks up the font), one doc row in `annotation-guide.md`. Run `npm run sync:svg` to push the updated embedded style into all SVG files and their `.js` modules.

**Tech Stack:** CSS, Node.js ESM, vitest.

---

## File Map

| File | Change |
|---|---|
| `ui/mapper.css` | Add `.map-label-accent` rule after `.map-label-muted` |
| `scripts/sync-svg-js.mjs` | Add `.map-label-accent` to `FONT_STYLE_BLOCK` selector list |
| `scripts/sync-svg-js.test.mjs` | Add failing test for `.map-label-accent` in `FONT_STYLE_BLOCK` (TDD) |
| `docs/annotation-guide.md` | Add row to Text table |
| `ui/maps/*.svg` + `ui/maps/*.js` | Updated by running `npm run sync:svg` |

---

### Task 1: Add map-label-accent

**Files:**
- Modify: `scripts/sync-svg-js.test.mjs`
- Modify: `scripts/sync-svg-js.mjs`
- Modify: `ui/mapper.css`
- Modify: `docs/annotation-guide.md`

- [ ] **Step 1: Write the failing test**

In `scripts/sync-svg-js.test.mjs`, add this test inside the existing `describe('injectFontStyle', ...)` block, after the last test:

```javascript
  it('includes map-label-accent in font fix selector', () => {
    expect(FONT_STYLE_BLOCK).toContain('.map-label-accent')
  })
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run scripts/sync-svg-js.test.mjs
```

Expected: 5 pass, 1 fail — `AssertionError: expected … to contain '.map-label-accent'`

- [ ] **Step 3: Update FONT_STYLE_BLOCK in sync-svg-js.mjs**

Change line 7 of `scripts/sync-svg-js.mjs` from:

```javascript
.map-label, .map-label-muted,
```

to:

```javascript
.map-label, .map-label-muted, .map-label-accent,
```

The full updated constant looks like:

```javascript
export const FONT_STYLE_BLOCK = `<style id="inkscape-font-fix">
.map-label, .map-label-muted, .map-label-accent,
.lib-table, .lib-gap-label, .lib-book-label,
.lib-row-num, .lib-book-list {
  font-family: "Noto Sans", sans-serif;
}
</style>`
```

- [ ] **Step 4: Run tests to confirm they all pass**

```bash
npx vitest run scripts/sync-svg-js.test.mjs
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Add the CSS rule to mapper.css**

In `ui/mapper.css`, add a new line immediately after line 89 (`.map-label-muted`):

```css
.map-label-accent { fill: var(--accent);       font-size: 10px; font-family: "Noto Sans", sans-serif; }
```

- [ ] **Step 6: Add row to annotation-guide.md**

In `docs/annotation-guide.md`, the Text table currently ends at line 38:

```markdown
| `map-label-muted` | Secondary / de-emphasised label | 10px |
```

Add a new row immediately after it:

```markdown
| `map-label-accent` | Strong highlight (accent colour) | 10px |
```

- [ ] **Step 7: Run sync to update SVG files and .js modules**

```bash
node scripts/sync-svg-js.mjs
```

Expected: lists all `.svg` files and prints `done — 64 files synced.`

Verify the updated style block is in the hand-crafted SVGs:

```bash
grep "map-label-accent" ui/maps/am_uu.svg
```

Expected: `.map-label-accent,` appears inside the `<style id="inkscape-font-fix">` block.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```

Expected: same pass/fail counts as before this task (84 passing, 8 pre-existing failures in `build-svg.test.mjs` unrelated to this change; the new test brings vitest to 6 passing in `sync-svg-js.test.mjs`).

- [ ] **Step 9: Commit**

```bash
git add scripts/sync-svg-js.test.mjs scripts/sync-svg-js.mjs ui/mapper.css docs/annotation-guide.md ui/maps/*.svg ui/maps/*.js
git commit -m "feat(annotation-font): add map-label-accent class for strong highlight"
```
