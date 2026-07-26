# Gather room type — design

## Purpose

Add a new auto-detected room type, `gather`, for rooms whose `shop_items`
entries are all foraged/harvested rather than purchased (herbs, roots, wild
plants). Today these rooms are misclassified: 26 of the 50 qualifying rooms
are skipped entirely by a narrow `room_short`-name heuristic (`SHOP_NAME_EXCLUDE`,
matching "garden"), and the remaining 24 fall through `classifyShopItems`'s
keyword matching (which never matches herb/plant names) to its `shop`
fallback — rendering as if they were real shops.

## Data finding

`shop_items.sale_price` is not always a monetary value. Distinct
non-monetary values found in the live `_quowmap_database.db`:

| `sale_price` value | Item rows | Meaning |
|---|---|---|
| `gather` | 230 | foraged (herbs, roots, flowers) |
| `trade` | 15 | bartered, not purchased or foraged |
| `pick` | 4 | picked (distinct verb, out of scope) |
| `search` | 1 | searched for (distinct verb, out of scope) |
| `LC variable` | 1 | unclear, single occurrence, out of scope |

This spec covers only `sale_price === 'gather'`, per explicit scope decision
(see Out of scope).

Of the 51 rooms with at least one `gather`-priced item, **50 have only
`gather`-priced items**; exactly 1 room ("middle of Dockside Walk") mixes a
`gather` items with items priced `pick`. Room names among the 50 vary widely
— parks, farmsteads, forest clearings, "old tree", "conservatory", "outside
the privy" — confirming the existing name-based heuristic (`garden` in
`room_short`) was only an approximation: it currently catches 26 of the 50.

8 of the 50 pure-gather rooms already carry a manual `room-types.json`
override of `"food"`, set by hand before this type existed.

## Detection rule

In `queryShopTypes` (`scripts/build-svg.mjs:119`), the `shop_items` query
gains `si.sale_price` to its `SELECT`. Per room, if **100% of its
`shop_items` rows have `sale_price === 'gather'`**, the room classifies as
`gather` directly, bypassing `classifyShopItems`'s keyword matching for that
room entirely (there is no purchasable item to classify by keyword). A room
with even one non-`gather`-priced item is unaffected by this change and
falls through to the existing `classifyShopItems` keyword logic exactly as
today — this is why the single mixed room ("middle of Dockside Walk") keeps
its current behavior (falls back to generic `shop`, since "clover" and the
gather-priced "cardamom"/"turmeric root" match no `SHOP_KEYWORDS`).

This slots into `queryShopTypes` at the exact point `classifyShopItems`'s
result used to be written into the `result` Map (`scripts/build-svg.mjs:135-137`),
so `gather` is subject to the same downstream precedence as every other
auto-detected value:
- A `room-types.json` override still always wins (`scripts/build-svg.mjs:165-171`).
- The later pub/tavern `room_short` name-match step (`scripts/build-svg.mjs:155-163`)
  can still overwrite a `gather` result, unchanged — same as it already
  overwrites `food`/`shop` today. None of the 50 known gather rooms match
  those name patterns, so this is a theoretical edge case, not observed.
- The `shortTypePatterns` step (`scripts/build-svg.mjs:139-153`) only fills
  in rooms `!result.has(room_id)`, so it cannot overwrite a `gather` result
  — same non-clobbering behavior it already has for every other type.

## Removed: `SHOP_NAME_EXCLUDE`

The `garden`-in-name heuristic (`scripts/build-svg.mjs:112-117`, and its use
at `scripts/build-svg.mjs:129`) is removed entirely. It was a workaround for
exactly this problem, catching only 26 of the 50 qualifying rooms, and is
fully superseded by the data-driven `sale_price` check: every room it used
to correctly skip is a pure-gather room that now gets classified `gather`
directly instead of being skipped. No known room depends on the old
exclusion for any other reason (it existed solely for the gather-item
problem, per its own comment).

## Data cleanup

The 8 rooms with a stale manual `"food"` override are removed from
`ui/data/room-types.json` so they pick up the new auto-detection:

```
209c1ff11b68db9a5eb8c90aa2457182ad96154e
3368641e0c16fe09e2d3cbdebf4e9167edccdc1c
521ce53ca1696d3352c501582a8585611688a6ed
64ee40a06178cbddb80935725cb463e2e21770b5
769a2166451cfa60708f488928661895533860b8
c4fd237c530cb85ca41ed5e188531437c158c922
d0d2db6636cc18e076b28460ef1e8752f8c9fbb3
f7f2ca6da4f318aa73bd86816df00ac2eae66235
```

All 8 currently map to `"food"`; removing the entry lets `queryShopTypes`
compute `gather` for them instead (all 8 are pure-gather rooms per the Data
finding above).

## Rendering

- **Letter:** `N` — no strong mnemonic letter was free (`G` is `club`, `H`
  is `house`, `F` is `food`, `P` is `pshop`); `N` is simply unused, consistent
  with other non-mnemonic picks already in the table (`X` for `access`, `V`
  for `tavern`, `B` for `pub`).
- **Colour:** `#4a4a1a` (dark olive/moss) — chosen to stay visually distinct
  from both the existing shop-green family (`#1c5c3a` shop/weapon/etc.,
  `#1a4a28` crafts) and the unrelated "green area" indicator
  (`room-green.json`, `#0d1f0d` fill / `#4a9f4a` stroke) that many gather
  rooms (parks, forests) will also be flagged with.
- New CSS rule in `ui/mapper.css`, added as its own selector (not grouped
  into the existing shop-green selector block at `ui/mapper.css:122-124`,
  since it needs a distinct fill): `.room-gather { fill: #4a4a1a; }`.
- **Label:** "Gather spot" (for tooltips/labels via `ROOM_TYPE_LABELS` in
  `ui/svg-renderer.js`).

## Files touched

| File | Change |
|---|---|
| `scripts/build-svg.mjs` | Remove `SHOP_NAME_EXCLUDE`; add `sale_price` to the `shop_items` query in `queryShopTypes`; add the 100%-gather branch; add `gather: 'N'` to `TYPE_LETTERS` |
| `ui/svg-renderer.js` | Add `gather: 'Gather spot'` to `ROOM_TYPE_LABELS` |
| `ui/mapper.css` | Add `.room-gather { fill: #4a4a1a; }` |
| `docs/map-data-guide.md` | Add a `gather` row to the room-types table (`shop_items`; 100% of a room's items priced `gather`); update the "Priority" line to note that gather detection happens before keyword matching within the `shop_items` step. The existing `shop` row's "no sub-type keyword match or tie" wording does not reference the removed garden exclusion and needs no change. |
| `ui/data/room-types.json` | Remove the 8 stale `"food"` overrides listed above |
| `scripts/build-svg.test.mjs` | New tests: a room with 100% `gather`-priced items classifies `gather`; a room with mixed `gather`/non-`gather` items does not; removal of any test that depended on `SHOP_NAME_EXCLUDE`/garden-name behavior, replaced with equivalent gather-detection coverage |
| `ui/maps/*.svg`, `ui/maps/*.js` | Regenerated via `npm run build:svg && npm run sync:svg` |
| `tools/shop-room-editor/output.html` | Regenerated via `npm run tool:shop-rooms` so the editor reflects the new type and cleared overrides |

## Testing plan

- Unit tests in `scripts/build-svg.test.mjs` covering:
  - a room whose `shop_items` are 100% `sale_price = 'gather'` → classified
    `gather`
  - a room with a mix of `gather` and non-`gather` priced items → classified
    via the existing `classifyShopItems` path (not `gather`)
  - a room-types.json override still wins over an auto-detected `gather`
    classification
  - `roomElement(..., 'gather')` renders `class="room ... room-gather"` and
    an `N` type-label glyph
  - a room previously excluded only by the removed `garden`-name heuristic
    now classifies `gather` (regression coverage for the removal)
- Run `npm test` (includes Lua tests per project convention) before
  considering the work done.
- Rebuild all maps (`npm run build:svg && npm run sync:svg`) and spot-check
  at least one of the 50 known gather rooms (e.g. "paddock" or "old tree")
  renders with the new olive colour and `N` glyph in the generated SVG.
- Regenerate `tools/shop-room-editor/output.html` and spot-check that the 8
  cleaned-up rooms now show `effectiveType: gather` with no manual override
  checked.

## Out of scope

- `pick` (4 items) and `search` (1 item) sale-price values are not folded
  into this detection — scoped to exactly `gather` per explicit decision.
  Could be revisited later if these turn out to matter.
- `trade` (15 items) is a distinct concept (bartering) and is not treated as
  gather-like.
- The single mixed room ("middle of Dockside Walk") is unaffected — no
  special-case handling added for partial-gather rooms.
- No new JSON config file — `gather` is fully auto-detected from
  `sale_price`, no manual seed list needed.
