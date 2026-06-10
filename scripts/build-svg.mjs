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
const DEFAULT_DB    = path.join(REPO_ROOT, 'claude_resources', 'quow_cowbar', 'maps', '_quowmap_database.db')
const OUT_DIR       = path.join(REPO_ROOT, 'ui', 'maps')
const LIB_CONFIG    = path.join(REPO_ROOT, 'ui', 'data', 'uu_library.json')

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
  const label = short ? ` data-label="${escapeXml(short)}"` : ''
  if (isIndoor) {
    return `<rect id="room-${id}" class="room indoor"${label} x="${x - 4}" y="${y - 4}" width="8" height="8" rx="2"/>`
  }
  return `<circle id="room-${id}" class="room outdoor"${label} cx="${x}" cy="${y}" r="4"/>`
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

  <g id="layer-labels"><!-- labels --></g>

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

const LIB_COLS      = [46, 76, 106, 136, 166, 196, 226, 256]
const LIB_ENTRY_Y   = 4810
const LIB_STEP      = 30
const LIB_ROWS      = 160  // rows going north from entrance
const LIB_LEFT_PAD  = 25   // extra space left of rooms for row numbers
const LIB_RIGHT_PAD = 165  // extra space right of rooms for book list

function libViewBox(booksCount = 0) {
  const tileSize = Math.round(LIB_STEP * 2 / 3)
  const half     = tileSize / 2
  const topY     = LIB_ENTRY_Y - (LIB_ROWS - 1) * LIB_STEP
  const viewY    = topY - half - 5
  const southExt = booksCount > 0 ? 15 + booksCount * 12 + 10 : 5
  return {
    viewX: LIB_COLS[0] - half - LIB_LEFT_PAD,
    viewY,
    viewW: LIB_COLS[LIB_COLS.length - 1] + half + LIB_RIGHT_PAD - (LIB_COLS[0] - half - LIB_LEFT_PAD),
    viewH: LIB_ENTRY_Y + half + southExt - viewY,
  }
}

const LIB_DIR  = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }
const LIB_OPP  = { N: 'S', S: 'N', E: 'W', W: 'E' }
const STUB_LEN = 14  // SVG units for off-map / wrap exit stubs

export function buildLibraryExitsContent(exitsArray = [], missingSet = new Set()) {
  const seen  = new Set()
  const lines = []

  const roomXY = (col, row) => [LIB_COLS[col - 1], LIB_ENTRY_Y - (row - 1) * LIB_STEP]

  const addStub = (col, row, d) => {
    const key = `stub:${col},${row},${d}`
    if (seen.has(key)) return
    seen.add(key)
    if (missingSet.has(`${col-1},${row-1}`)) return
    const [x1, y1] = roomXY(col, row)
    const delta = LIB_DIR[d]
    // SVG x increases east, y decreases northward — delta[1] is row-space so negate for SVG y
    const x2 = x1 + delta[0] * STUB_LEN
    const y2 = y1 - delta[1] * STUB_LEN
    lines.push(`    <line class="exit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
  }

  const addNormal = (col, row, col2, row2) => {
    const key = [Math.min(col,col2), Math.min(row,row2), Math.max(col,col2), Math.max(row,row2)].join(',')
    if (seen.has(key)) return
    seen.add(key)
    if (missingSet.has(`${col-1},${row-1}`) || missingSet.has(`${col2-1},${row2-1}`)) return
    const [x1, y1] = roomXY(col, row)
    const [x2, y2] = roomXY(col2, row2)
    lines.push(`    <line class="exit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
  }

  for (const [col, row, dirs] of exitsArray) {
    for (const d of String(dirs).toUpperCase()) {
      const delta = LIB_DIR[d]
      if (!delta) continue
      const col2 = col + delta[0]
      const row2 = row + delta[1]
      // Horizontal wrap: E from rightmost or W from leftmost
      const isHWrap = (d === 'E' && col === LIB_COLS.length) || (d === 'W' && col === 1)
      const isOffMap = col2 < 1 || col2 > LIB_COLS.length || row2 < 1 || row2 > LIB_ROWS
      if (isHWrap) {
        // Draw stubs at both ends of the wrap connection
        addStub(col, row, d)
        addStub(d === 'E' ? 1 : LIB_COLS.length, row, LIB_OPP[d])
      } else if (isOffMap) {
        addStub(col, row, d)
      } else {
        addNormal(col, row, col2, row2)
      }
    }
  }

  return lines.length ? lines.join('\n') + '\n  ' : ''
}

function buildLibraryRoomsContent(missingSet, gapsArray = [], booksArray = []) {
  const tileSize = Math.round(LIB_STEP * 2 / 3)  // 20
  const half     = tileSize / 2                    // 10
  const gapsSet  = new Set(gapsArray.map(([c, r]) => `${c - 1},${r - 1}`))
  const booksMap = new Map(booksArray.map(([c, r, n, d]) => [`${c - 1},${r - 1}`, { number: n, description: d }]))
  const tiles    = []
  for (let row = 0; row < LIB_ROWS; row++) {
    const y = LIB_ENTRY_Y - row * LIB_STEP
    for (let col = 0; col < LIB_COLS.length; col++) {
      const key = `${col},${row}`
      if (missingSet.has(key)) continue
      const x = LIB_COLS[col]
      let attrs
      if (gapsSet.has(key)) {
        attrs = ` class="room lib-gap"`
      } else if (booksMap.has(key)) {
        const { number, description } = booksMap.get(key)
        attrs = ` class="room lib-book" data-label="${escapeXml(`${number}: ${description}`)}"`
      } else {
        attrs = ` class="room indoor"`
      }
      tiles.push(
        `    <rect id="room-lib-${x}-${y}"${attrs}` +
        ` x="${x - half}" y="${y - half}" width="${tileSize}" height="${tileSize}"/>`
      )
    }
  }
  // Overlays after tiles so they render on top
  const overlays = [
    `    <rect id="lib-distortion" class="lib-distortion" x="0" y="0" width="0" height="0" visibility="hidden"/>`,
    `    <circle id="lib-orb" class="lib-orb" cx="0" cy="0" r="0" visibility="hidden"/>`,
    `    <path id="lib-arrow" class="lib-arrow" d="M 0 0" visibility="hidden"/>`,
  ].join('\n')
  return `${tiles.join('\n')}\n${overlays}\n  `
}

export function buildLibraryLabelsContent(tablesArray = [], gapsArray = [], booksArray = []) {
  const labels = []
  for (const [col, row] of tablesArray) {
    const x = LIB_COLS[col - 1]
    const y = LIB_ENTRY_Y - (row - 1) * LIB_STEP
    labels.push(`    <text class="lib-table" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">T</text>`)
  }
  for (const [col, row] of gapsArray) {
    const x = LIB_COLS[col - 1]
    const y = LIB_ENTRY_Y - (row - 1) * LIB_STEP
    labels.push(`    <text class="lib-gap-label" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">G</text>`)
  }
  for (const [col, row, number] of booksArray) {
    const x = LIB_COLS[col - 1]
    const y = LIB_ENTRY_Y - (row - 1) * LIB_STEP
    labels.push(`    <text class="lib-book-label" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${escapeXml(String(number))}</text>`)
  }
  return labels.length ? labels.join('\n') + '\n  ' : ''
}

export function buildLibraryRowNumbers() {
  const x = LIB_COLS[0] - 10 - 4  // 32: just left of room tiles
  const labels = []
  for (let row = 5; row <= LIB_ROWS; row += 5) {
    const y = LIB_ENTRY_Y - (row - 1) * LIB_STEP
    labels.push(`    <text class="lib-row-num" x="${x}" y="${y}" text-anchor="end" dominant-baseline="central">${row}</text>`)
  }
  return labels.join('\n') + '\n  '
}

export function buildLibraryBookList(booksArray = []) {
  if (!booksArray.length) return ''
  const x      = LIB_COLS[LIB_COLS.length - 1] + 10 + 20  // 286: right of room tiles
  const startY = LIB_ENTRY_Y + 15                           // below entrance row
  const LINE   = 12
  const sorted = [...booksArray].sort((a, b) => a[2] - b[2])
  const items  = sorted.map(([,, number, description], i) =>
    `    <text class="lib-book-list" x="${x}" y="${startY + i * LINE}" dominant-baseline="hanging">${escapeXml(`${number}: ${description}`)}</text>`
  )
  return items.join('\n') + '\n  '
}

function buildAllLibraryLabels(tablesArray, gapsArray, booksArray) {
  return (
    buildLibraryLabelsContent(tablesArray, gapsArray, booksArray) +
    buildLibraryRowNumbers() +
    buildLibraryBookList(booksArray)
  )
}

export function buildLibrarySvg(missingSet = new Set(), tablesArray = [], gapsArray = [], booksArray = [], exitsArray = []) {
  const { viewX, viewY, viewW, viewH } = libViewBox(booksArray.length)
  const allLabels  = buildAllLibraryLabels(tablesArray, gapsArray, booksArray)
  const exitsContent = buildLibraryExitsContent(exitsArray, missingSet)

  return `<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="${viewX} ${viewY} ${viewW} ${viewH}"
     class="map-svg"
     data-map-id="47">

  <g id="layer-artwork"><!-- artwork --></g>

  <g id="layer-exits">${exitsContent ? '\n' + exitsContent : ''}  </g>

  <g id="layer-rooms">
${buildLibraryRoomsContent(missingSet, gapsArray, booksArray)}
  </g>

  <g id="layer-labels">
${allLabels}  </g>

</svg>`
}

function updateLibrarySvg(existingSvg, missingSet, tablesArray = [], gapsArray = [], booksArray = [], exitsArray = []) {
  const { viewX, viewY, viewW, viewH } = libViewBox(booksArray.length)
  let svg = existingSvg.replace(/viewBox="[^"]*"/, `viewBox="${viewX} ${viewY} ${viewW} ${viewH}"`)
  const exitsContent = buildLibraryExitsContent(exitsArray, missingSet)
  svg = svg.replace(
    /(<g id="layer-exits">)([\s\S]*?)(<\/g>)/,
    `$1${exitsContent ? '\n' + exitsContent : ''}  $3`
  )
  svg = svg.replace(
    /(<g id="layer-rooms">)([\s\S]*?)(<\/g>)/,
    `$1\n${buildLibraryRoomsContent(missingSet, gapsArray, booksArray)}$3`
  )
  const allLabels = buildAllLibraryLabels(tablesArray, gapsArray, booksArray)
  svg = svg.replace(
    /(<g id="layer-labels">)([\s\S]*?)(<\/g>)/,
    `$1\n${allLabels}  $3`
  )
  return svg
}

async function readLibraryConfig() {
  try {
    const cfg = JSON.parse(await fs.readFile(LIB_CONFIG, 'utf8'))
    const missingSet = new Set()
    for (const [col, row] of (cfg.missing ?? [])) {
      missingSet.add(`${col - 1},${row - 1}`)  // 1-indexed file → 0-indexed internal
    }
    // Allow a bare [col, row] pair as a shorthand for a single-entry list
    const normalise = (arr) => Array.isArray(arr?.[0]) ? arr : (arr?.length ? [arr] : [])
    return {
      missingSet,
      tables: normalise(cfg.tables),
      gaps:   normalise(cfg.gaps),
      books:  cfg.books  ?? [],
      exits:  cfg.exits  ?? [],
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    return { missingSet: new Set(), tables: [], gaps: [], books: [], exits: [] }
  }
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
  await fs.writeFile(outPath.replace('.svg', '.js'), `export default ${JSON.stringify(svg)};\n`, 'utf8')
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

    // UU Library — regenerate tiles on every run; preserves hand-crafted layer-artwork
    if (onlyMapId === null || onlyMapId === 47) {
      const libPath    = path.join(OUT_DIR, 'uu_library_full.svg')
      const libJsPath  = path.join(OUT_DIR, 'uu_library_full.js')
      const { missingSet, tables, gaps, books, exits } = await readLibraryConfig()
      let libSvg
      try {
        libSvg = updateLibrarySvg(await fs.readFile(libPath, 'utf8'), missingSet, tables, gaps, books, exits)
        console.log('[build-svg]   ✓ uu_library_full.svg  (updated)')
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
        libSvg = buildLibrarySvg(missingSet, tables, gaps, books, exits)
        console.log('[build-svg]   ✓ uu_library_full.svg  (tile-grid, generated)')
      }
      await fs.writeFile(libPath,   libSvg, 'utf8')
      await fs.writeFile(libJsPath, `export default ${JSON.stringify(libSvg)};\n`, 'utf8')
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
