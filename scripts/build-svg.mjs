// scripts/build-svg.mjs
// Generates SVG map files from the Quow minimap database.
// Usage: node scripts/build-svg.mjs [--db /path/to/_quowmap_database.db] [--map N]

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { maps } from '../ui/data/rooms.js'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT  = path.resolve(__dirname, '..')
const DEFAULT_DB = path.join(REPO_ROOT, 'claude_resources', 'quow_cowbar', 'maps', '_quowmap_database.db')
const OUT_DIR    = path.join(REPO_ROOT, 'ui', 'maps')

// ─── DB queries ──────────────────────────────────────────────────────────────

export function queryRooms(db, mapId) {
  return db.prepare(
    'SELECT room_id AS id, xpos AS x, ypos AS y, room_short AS short FROM rooms WHERE map_id = ?'
  ).all(mapId)
}

export function queryExits(db, mapId) {
  const rows = db.prepare(`
    SELECT re.room_id AS "from", re.connect_id AS "to"
    FROM room_exits re
    JOIN rooms r1 ON re.room_id    = r1.room_id AND r1.map_id = ?
    JOIN rooms r2 ON re.connect_id = r2.room_id AND r2.map_id = ?
  `).all(mapId, mapId)

  const seen = new Set()
  const result = []
  for (const row of rows) {
    const key = [row.from, row.to].sort().join('\0')
    if (!seen.has(key)) {
      seen.add(key)
      const [a, b] = [row.from, row.to].sort()
      result.push({ from: a, to: b })
    }
  }
  return result
}

// ─── ID helpers ──────────────────────────────────────────────────────────────

export function edgeId(a, b) {
  const [lo, hi] = [a, b].sort()
  return `edge-${lo}-${hi}`
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeXml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;')
}

// ─── SVG element generators ──────────────────────────────────────────────────

export function roomElement(id, x, y, short, isIndoor) {
  const title = `<title>${escapeXml(short)}</title>`
  if (isIndoor) {
    return `<rect id="room-${id}" class="room indoor" x="${x - 8}" y="${y - 8}" width="16" height="16" rx="4">${title}</rect>`
  }
  return `<circle id="room-${id}" class="room outdoor" cx="${x}" cy="${y}" r="8">${title}</circle>`
}

export function exitElement(fromId, toId, rooms) {
  const from = rooms.find(r => r.id === fromId)
  const to   = rooms.find(r => r.id === toId)
  if (!from || !to) return ''
  return `<line id="${edgeId(fromId, toId)}" class="exit" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`
}

// ─── Map SVG builders ────────────────────────────────────────────────────────

export function buildNewSvg(mapMeta, rooms, exits, mapId = '') {
  const isIndoor = !mapMeta.topLevel

  const exitLines  = exits.map(e => '    ' + exitElement(e.from, e.to, rooms)).filter(Boolean).join('\n')
  const roomShapes = rooms.map(r => '    ' + roomElement(r.id, r.x, r.y, r.short, isIndoor)).join('\n')
  const labelTexts = rooms.map(r =>
    `    <text class="map-label" x="${r.x}" y="${r.y - 12}">${escapeXml(r.short)}</text>`
  ).join('\n')

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

  <g id="layer-labels">
${labelTexts}
  </g>

</svg>`
}

export function updateExistingSvg(existingSvg, mapMeta, rooms, exits) {
  const isIndoor   = !mapMeta.topLevel
  const exitLines  = exits.map(e => '    ' + exitElement(e.from, e.to, rooms)).filter(Boolean).join('\n')
  const roomShapes = rooms.map(r => '    ' + roomElement(r.id, r.x, r.y, r.short, isIndoor)).join('\n')

  let svg = existingSvg.replace(
    /(<g id="layer-exits">)([\s\S]*?)(<\/g>)/,
    `$1\n${exitLines}\n  $3`
  )
  svg = svg.replace(
    /(<g id="layer-rooms">)([\s\S]*?)(<\/g>)/,
    `$1\n${roomShapes}\n  $3`
  )
  return svg
}

// ─── UU Library SVG ──────────────────────────────────────────────────────────

const LIB_COLS    = [46, 76, 106, 136, 166, 196, 226, 256]
const LIB_ENTRY_Y = 4810
const LIB_STEP    = 30
const LIB_N       = 25  // rows above and below entrance

export function buildLibrarySvg() {
  const minY = LIB_ENTRY_Y - LIB_N * LIB_STEP  // 4060
  const maxY = LIB_ENTRY_Y + LIB_N * LIB_STEP  // 5560
  const half = LIB_STEP / 2                     // 15

  const tiles = []
  const exits = []

  for (const x of LIB_COLS) {
    for (let row = 0; row <= LIB_N * 2; row++) {
      const y = minY + row * LIB_STEP
      tiles.push(
        `    <rect id="room-lib-${x}-${y}" class="room indoor"` +
        ` x="${x - half}" y="${y - half}" width="${LIB_STEP}" height="${LIB_STEP}"/>`
      )
      // South neighbour
      const sy = y + LIB_STEP
      if (sy <= maxY) {
        exits.push(`    <line class="exit" x1="${x}" y1="${y}" x2="${x}" y2="${sy}"/>`)
      }
      // East neighbour
      const nextX = LIB_COLS[LIB_COLS.indexOf(x) + 1]
      if (nextX !== undefined) {
        exits.push(`    <line class="exit" x1="${x}" y1="${y}" x2="${nextX}" y2="${y}"/>`)
      }
    }
  }

  // Overlay elements — repositioned by viewer on library_position / library_overlay messages
  const overlays = [
    `    <rect id="lib-distortion" class="lib-distortion" x="0" y="0" width="0" height="0" visibility="hidden"/>`,
    `    <circle id="lib-orb" class="lib-orb" cx="0" cy="0" r="0" visibility="hidden"/>`,
    `    <path id="lib-arrow" class="lib-arrow" d="M 0 0" visibility="hidden"/>`,
  ].join('\n')

  const viewMinY = minY - LIB_STEP
  const viewH    = maxY - viewMinY + LIB_STEP

  return `<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 ${viewMinY} 302 ${viewH}"
     class="map-svg"
     data-map-id="47">

  <g id="layer-artwork"><!-- artwork --></g>

  <g id="layer-exits">
${exits.join('\n')}
  </g>

  <g id="layer-rooms">
${overlays}
${tiles.join('\n')}
  </g>

  <g id="layer-labels"><!-- labels --></g>

</svg>`
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function buildOneSvg(db, mapId, mapMeta) {
  const outPath = path.join(OUT_DIR, mapMeta.file.replace('.png', '.svg'))
  const roomRows = queryRooms(db, mapId)
  const exitRows = queryExits(db, mapId)

  let svg
  try {
    const existing = await fs.readFile(outPath, 'utf8')
    const oldIds = new Set([...existing.matchAll(/id="room-([^"]+)"/g)].map(m => m[1]))
    const newIds = new Set(roomRows.map(r => r.id))
    const added   = [...newIds].filter(id => !oldIds.has(id)).length
    const removed = [...oldIds].filter(id => !newIds.has(id)).length
    if (added > 0 || removed > 0) {
      console.log(`[build-svg] map ${mapId}: +${added} rooms, -${removed} removed — update labels manually`)
    }
    svg = updateExistingSvg(existing, mapMeta, roomRows, exitRows)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    svg = buildNewSvg(mapMeta, roomRows, exitRows, mapId)
  }

  await fs.writeFile(outPath, svg, 'utf8')
  console.log(`[build-svg]   ✓ ${path.basename(outPath)}  (${roomRows.length} rooms, ${exitRows.length} exits)`)
}

async function main() {
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

    // UU Library — always use the dedicated generator; skip if already exists
    if (onlyMapId === null || onlyMapId === 47) {
      const libPath = path.join(OUT_DIR, 'uu_library_full.svg')
      try {
        await fs.access(libPath)
        console.log('[build-svg]   ✓ uu_library_full.svg  (exists; delete to regenerate)')
      } catch {
        await fs.writeFile(libPath, buildLibrarySvg(), 'utf8')
        console.log('[build-svg]   ✓ uu_library_full.svg  (tile-grid, generated)')
      }
    }

    // Standard maps — all except 47 (UU Library) and 99 (World Disc — stays PNG)
    const mapIds = Object.keys(maps).map(Number).filter(id => id !== 47 && id !== 99)
    for (const mapId of mapIds.sort((a, b) => a - b)) {
      if (onlyMapId !== null && mapId !== onlyMapId) continue
      const meta = maps[mapId]
      if (!meta) continue
      await buildOneSvg(db, mapId, meta)
    }
  } finally {
    db.close()
  }
  console.log('[build-svg] done.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`[build-svg] FAILED: ${e.message}`); process.exit(1) })
}
