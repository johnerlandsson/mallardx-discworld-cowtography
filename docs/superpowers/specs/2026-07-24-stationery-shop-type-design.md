# Stationery shop room type — design

## Purpose

Add a new auto-detected room type, `stationery`, for shops that sell writing/paper
goods, following the same pattern as the existing shop sub-types (`weapon`,
`armour`, `clothes`, `food`, `access`).

## Detection rule

A room qualifies as `stationery` when its `shop_items` contain matches from **at
least 2 of these 4 categories**. Each category uses a precise phrase or
word-boundary match, chosen specifically to avoid the keyword-collision problem
that made the `furniture` type manual-only (see commit `7b62b27`):

| Category | Match rule | Collision avoided |
|---|---|---|
| paper | item name contains `"writing paper"` | wallpaper, sandpaper, packaging paper, cigarette paper |
| quill | item name contains `quill` (substring) | none found in corpus |
| chalk | item name contains `"stick of chalk"` | "chicken tikka chalk", "chalky [scent] broom polish" |
| book | item name contains the whole word `book` **and** a colour word (`red`, `blue`, `green`, `yellow`, `purple`, `black`, `white`, `brown`, `grey`/`gray`, `pink`, `orange`, `silver`, `gold`, `violet`, `scarlet`, `crimson`, `indigo`, `turquoise`, `colour`/`color`) | bookcase, bookshelf, bookstand, notebook, chapbook, pattern book, guest book, prayer book — all excluded via `\bbook\b` word-boundary matching |

This was validated against the live `_quowmap_database.db` shop_items table
(8875 distinct item names): only 39 items match any category, all genuinely
stationery-related (quills, colour books, writing paper, stick of chalk — no
false positives at the item level). Applying the ≥2-category threshold across
real shops correctly picks out 20 rooms including "Toomer Stationers", "Felicity
Avenue Stationers", "Stationery Warehouse", "Academy Legibles", and "cosy little
stationer's shop", while excluding 24 rooms that matched only one category
(including some clear non-stationery shops like "Cartier's Exclusive
Jewellery" and "fresh and airy pet shop").

## Integration with existing classification

`classifyShopItems` in `scripts/build-svg.mjs` currently tallies item counts per
type from `SHOP_KEYWORDS` and picks the type with the highest count (ties fall
back to `shop`). `stationery` is not added to `SHOP_KEYWORDS` directly (its
matching logic is more complex than a flat keyword list). Instead:

1. Scan the room's items against the 4 stationery category matchers, tracking
   which distinct categories matched and how many items matched in total.
2. If **2 or more distinct categories** matched, add `stationery` to the
   existing `counts` object with that total item count as its score.
3. If fewer than 2 categories matched, `stationery` is not added as a
   candidate at all — those items simply don't count toward any type (same as
   any other non-matching item today).
4. The existing winner-take-all comparison (highest count wins, ties fall back
   to `shop`) then runs unmodified, so `stationery` competes fairly against
   `weapon`/`armour`/`clothes`/`food`/`access`.

This means a shop that qualifies for `stationery` (≥2 categories) but has a
larger competing category — e.g. a magic shop selling one quill, one stick of
chalk, and a dozen rings — still classifies as `access`, not `stationery`,
because `access`'s raw item count wins. A `room-types.json` manual override
continues to take priority over all auto-detection, unchanged.

**Known trade-off:** a small number of curio/religious shops that sell old
quills alongside colour-named leather-bound books (e.g. an "Ecclesiastical
Curiosity Shop") could get mis-tagged `stationery` if they have no larger
competing category present. This is the same class of imprecision the project
already accepts for other auto-detected sub-types; fixable via manual override
in `room-types.json` if spotted.

## Rendering

- **Letter:** `Q` (mnemonic: quill) — not currently used by any other type.
- **Colour:** dark green — grouped with the other auto-detected shop subtypes
  (`shop`, `weapon`, `armour`, `clothes`, `food`, `access`, `furniture`) in the
  shared CSS selector.
- **Label:** "Stationery shop" (for tooltips / labels via `ROOM_TYPE_LABELS`).

## Files touched

| File | Change |
|---|---|
| `scripts/build-svg.mjs` | Add stationery category matchers, extend `classifyShopItems`, add `stationery: 'Q'` to `TYPE_LETTERS` |
| `ui/svg-renderer.js` | Add `stationery: 'Stationery shop'` to `ROOM_TYPE_LABELS` |
| `ui/mapper.css` | Add `.room-stationery` to the existing dark-green shop-subtype selector group |
| `docs/map-data-guide.md` | Add a `stationery` row to the room-types table |
| `scripts/build-svg.test.mjs` | New tests: qualifies at 2 categories, does not qualify at 1, loses to a larger competing category, `roomElement` renders `room-stationery` class and `Q` letter |
| `ui/maps/*.svg`, `ui/maps/*.js` | Regenerated via `npm run build:svg && npm run sync:svg` |

## Testing plan

- Unit tests in `scripts/build-svg.test.mjs` covering:
  - a room with `writing paper` + `quill` → classified `stationery`
  - a room with only `quill` (1 category) → classified `shop` (not `stationery`)
  - a room with `quill` + `stick of chalk` but a larger `weapon` count →
    classified `weapon`
  - `roomElement(..., 'stationery')` renders `class="room ... room-stationery"`
    and a `Q` type-label glyph
  - manual override in `room-types.json` still wins over an auto-detected
    `stationery` classification
- Run `npm test` (includes Lua tests per project convention) before
  considering the work done.
- Rebuild all maps (`npm run build:svg && npm run sync:svg`) and spot-check at
  least one real qualifying room (e.g. "Toomer Stationers" or "Felicity Avenue
  Stationers") renders correctly in the generated SVG.

## Out of scope

- No changes to the `room-types.json` manual-override data itself (this spec
  is about the detection mechanism, not curating specific rooms).
- No new JSON config file — `stationery` is fully auto-detected, no manual
  seed list needed (unlike `furniture`/`talker`/etc.).
