// scripts/build-svg.mjs
// Generates SVG map files from the Quow minimap database.
// Usage: node scripts/build-svg.mjs [--db /path/to/_quowmap_database.db] [--map N]
//
// This file is a thin facade over scripts/build-svg/*.mjs — see that
// directory for the actual implementation, split by responsibility.

import { fileURLToPath } from 'node:url'
import { main } from './build-svg/cli.mjs'

export { queryRooms, queryExits, queryStairRooms } from './build-svg/db-queries.mjs'
export { SHOP_KEYWORDS, STATIONERY_CATEGORY_MATCHERS, TYPE_LETTERS, queryShopTypes } from './build-svg/shop-types.mjs'
export { isWaterRoom } from './build-svg/water.mjs'
export { edgeId } from './build-svg/utils.mjs'
export {
  stairSymbol, stairCornerSymbol, buildStairLayer, hexagonPoints, roomElement, exitElement,
} from './build-svg/elements.mjs'
export { buildStackData } from './build-svg/stacking.mjs'
export { buildNewSvg, updateExistingSvg } from './build-svg/svg-builders.mjs'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`[build-svg] FAILED: ${e.message}`); process.exit(1) })
}
