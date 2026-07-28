// scripts/build-svg/cli.mjs
// CLI entrypoint: builds one SVG per map from the DB, plus the room-stacks.js
// data file for a full build. The `main()` export is invoked from the
// top-level scripts/build-svg.mjs facade, guarded by the
// process.argv[1] === fileURLToPath(import.meta.url) check there.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { maps } from '../../ui/data/rooms.js'
import {
  DEFAULT_DB, OUT_DIR, TYPES_CONFIG, COMPACT_CONFIG, LARGE_CONFIG,
  EXTRA_CLASS_CONFIG, WATER_CONFIG, GREEN_CONFIG, DANGER_CONFIG, BRIDGE_CONFIG,
  EXIT_EXCLUDE_CONFIG, EXIT_CLIMB_CONFIG, GROUND_CONFIG, STACKS_OUT,
} from './paths.mjs'
import { queryRooms, queryExits, queryStairRooms } from './db-queries.mjs'
import { queryShopTypes } from './shop-types.mjs'
import { buildStackData } from './stacking.mjs'
import { buildNewSvg, updateExistingSvg } from './svg-builders.mjs'

async function buildOneSvg(db, mapId, mapMeta) {
  const outPath = path.join(OUT_DIR, mapMeta.file.replace('.png', '.svg'))
  const roomRows   = queryRooms(db, mapId)
  const exitRows   = queryExits(db, mapId)
  const stairRooms = queryStairRooms(db, mapId)

  let typesOverrides = {}
  try { typesOverrides = JSON.parse(await fs.readFile(TYPES_CONFIG, 'utf8')) } catch {}
  const shopTypes = queryShopTypes(db, mapId, typesOverrides)

  let compactRooms = new Set()
  try { compactRooms = new Set(JSON.parse(await fs.readFile(COMPACT_CONFIG, 'utf8'))) } catch {}

  let largeRooms = new Set()
  try { largeRooms = new Set(JSON.parse(await fs.readFile(LARGE_CONFIG, 'utf8'))) } catch {}

  let extraClasses = new Map()
  try { extraClasses = new Map(Object.entries(JSON.parse(await fs.readFile(EXTRA_CLASS_CONFIG, 'utf8')))) } catch {}

  let waterOverrides = new Set()
  try { waterOverrides = new Set(JSON.parse(await fs.readFile(WATER_CONFIG, 'utf8'))) } catch {}

  let greenOverrides = new Set()
  try { greenOverrides = new Set(JSON.parse(await fs.readFile(GREEN_CONFIG, 'utf8'))) } catch {}

  let dangerOverrides = new Set()
  try { dangerOverrides = new Set(JSON.parse(await fs.readFile(DANGER_CONFIG, 'utf8'))) } catch {}

  let bridgeOverrides = new Set()
  try { bridgeOverrides = new Set(JSON.parse(await fs.readFile(BRIDGE_CONFIG, 'utf8'))) } catch {}

  let exitExcludes = new Set()
  try { exitExcludes = new Set(JSON.parse(await fs.readFile(EXIT_EXCLUDE_CONFIG, 'utf8'))) } catch {}

  let climbEdges = new Set()
  try { climbEdges = new Set(JSON.parse(await fs.readFile(EXIT_CLIMB_CONFIG, 'utf8'))) } catch {}

  let svg
  try {
    const existing = await fs.readFile(outPath, 'utf8')
    // If the DB has no rooms for this map (e.g. Medina — rooms come from
    // room-custom.js at runtime), keep the existing SVG unchanged.
    if (roomRows.length === 0) {
      console.log(`[build-svg]   ↷ map ${mapId}: no DB rooms — keeping existing SVG`)
      return
    }
    const oldIds = new Set([...existing.matchAll(/id="room-([^"]+)"/g)].map(m => m[1]))
    const newIds = new Set(roomRows.map(r => r.id))
    const added   = [...newIds].filter(id => !oldIds.has(id)).length
    const removed = [...oldIds].filter(id => !newIds.has(id)).length
    if (added > 0 || removed > 0) {
      console.log(`[build-svg] map ${mapId}: +${added} rooms, -${removed} removed — update labels manually`)
    }
    svg = updateExistingSvg(existing, mapMeta, roomRows, exitRows, stairRooms, shopTypes, compactRooms, waterOverrides, greenOverrides, exitExcludes, dangerOverrides, largeRooms, extraClasses, climbEdges, bridgeOverrides)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    svg = buildNewSvg(mapMeta, roomRows, exitRows, mapId, stairRooms, shopTypes, compactRooms, waterOverrides, greenOverrides, exitExcludes, dangerOverrides, largeRooms, extraClasses, climbEdges, bridgeOverrides)
  }

  await fs.writeFile(outPath, svg, 'utf8')
  await fs.writeFile(outPath.replace('.svg', '.js'), `export default ${JSON.stringify(svg)};\n`, 'utf8')
  console.log(`[build-svg]   ✓ ${path.basename(outPath)}  (${roomRows.length} rooms, ${exitRows.length} exits)`)
}

export async function main() {
  const args = process.argv.slice(2)

  const dbFlagIdx  = args.indexOf('--db')
  const mapFlagIdx = args.indexOf('--map')
  const dbPath    = (dbFlagIdx  !== -1 && dbFlagIdx  + 1 < args.length) ? path.resolve(args[dbFlagIdx  + 1]) : DEFAULT_DB
  const onlyMapId = (mapFlagIdx !== -1 && mapFlagIdx + 1 < args.length) ? Number(args[mapFlagIdx + 1])       : null

  try { await fs.access(dbPath) } catch {
    throw new Error(`DB not found at ${dbPath}\nRun 'npm run build:data' first, or pass --db /path/to/_quowmap_database.db`)
  }

  const db = new Database(dbPath, { readonly: true })
  try {
    await fs.mkdir(OUT_DIR, { recursive: true })

    // Standard maps — all except 47 (UU Library, hand-drawn SVG), 99 (World Disc — stays PNG),
    // and 8 (Shades — manually drawn SVG, not generated from DB).
    const mapIds = Object.keys(maps).map(Number).filter(id => id !== 47 && id !== 99 && id !== 8)

    const allRoomsForStacks      = []
    const allExitsForStacks      = []
    const allStairRoomsForStacks = new Map()

    for (const mapId of mapIds.sort((a, b) => a - b)) {
      if (onlyMapId !== null && mapId !== onlyMapId) continue
      const meta = maps[mapId]
      if (!meta) continue
      await buildOneSvg(db, mapId, meta)

      // Accumulate for stack data — only on full builds (room-stacks.js is skipped for --map N).
      if (onlyMapId === null) {
        const roomRows  = queryRooms(db, mapId)
        const exitRows  = queryExits(db, mapId)
        const stairRows = queryStairRooms(db, mapId)
        for (const r of roomRows) allRoomsForStacks.push({ ...r, mapId })
        for (const e of exitRows)  allExitsForStacks.push(e)
        for (const [id, v] of stairRows) allStairRoomsForStacks.set(id, v)
      }
    }

    // Build and write stacking data (full builds only).
    if (onlyMapId === null) {
      let groundOverrides = {}
      try { groundOverrides = JSON.parse(await fs.readFile(GROUND_CONFIG, 'utf8')) } catch {}

      const { upperToGround, groundToUppers } = buildStackData(
        allRoomsForStacks, allExitsForStacks, allStairRoomsForStacks, groundOverrides
      )
      const stacksJs =
        `export const upperToGround = ${JSON.stringify(upperToGround, null, 2)};\n\n` +
        `export const groundToUppers = ${JSON.stringify(groundToUppers, null, 2)};\n`
      await fs.writeFile(STACKS_OUT, stacksJs, 'utf8')
      console.log(`[build-svg] room-stacks.js written (${Object.keys(upperToGround).length} upper rooms)`)
    }
  } finally {
    db.close()
  }
  console.log('[build-svg] done.')
}
