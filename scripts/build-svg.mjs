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
const TYPES_CONFIG   = path.join(REPO_ROOT, 'ui', 'data', 'room-types.json')
const COMPACT_CONFIG      = path.join(REPO_ROOT, 'ui', 'data', 'room-compact.json')
const LARGE_CONFIG        = path.join(REPO_ROOT, 'ui', 'data', 'room-large.json')
const EXTRA_CLASS_CONFIG  = path.join(REPO_ROOT, 'ui', 'data', 'room-extra-classes.json')
const WATER_CONFIG        = path.join(REPO_ROOT, 'ui', 'data', 'room-water.json')
const GREEN_CONFIG        = path.join(REPO_ROOT, 'ui', 'data', 'room-green.json')
const DANGER_CONFIG       = path.join(REPO_ROOT, 'ui', 'data', 'room-danger.json')
const EXIT_EXCLUDE_CONFIG = path.join(REPO_ROOT, 'ui', 'data', 'exit-exclude.json')

// ─── DB queries ──────────────────────────────────────────────────────────────

// Exit directions that represent vertical movement between floors.
// These suppress the connecting line and show a symbol inside the room instead.
const VERTICAL_EXITS = new Set([
  'u', 'd',
  'climb up', 'climb down', 'climb ladder',
  'stairs', 'staircase', 'trapdoor', 'ladder',
])

// Directions that mean "going up" and "going down" for symbol selection.
const UP_DIRS   = new Set(['u', 'climb up', 'climb ladder', 'ladder'])
const DOWN_DIRS = new Set(['d', 'climb down', 'trapdoor'])
// stairs/staircase are ambiguous — mark the room as having both directions.
const BOTH_DIRS = new Set(['stairs', 'staircase'])

// ─── Room type data ──────────────────────────────────────────────────────────

export const SHOP_KEYWORDS = {
  weapon:  ['sword', 'axe', 'dagger', 'crossbow', 'bolt', 'spear', 'mace', 'flail', 'whip', 'lance'],
  armour:  ['armour', 'armor', 'shield', 'helm', 'mail', 'chainmail', 'breastplate', 'gauntlet'],
  clothes: ['coat', 'cloak', 'robe', 'gown', 'jacket', 'dress', 'shirt', 'trouser', 'skirt', 'shoe', 'boot', 'hat', 'wig'],
  food:    ['cake', 'pie', 'bread', 'meat', 'ale', 'beer', 'wine', 'cheese', 'soup', 'stew'],
  access:  ['ring', 'bracelet', 'necklace', 'earring', 'gem', 'jewel', 'brooch', 'pendant'],
}

export const TYPE_LETTERS = {
  shop: 'S', weapon: 'W', armour: 'A', clothes: 'C', food: 'F', access: 'X',
  bank: '$', changer: '¢', mission: '!', post: 'O', lang: 'L', temple: 'R',
  crafts: 'K', house: 'H', club: 'G', pshop: 'P', tshop: 'T',
}

function classifyShopItems(items) {
  const counts = {}
  for (const item of items) {
    const lower = item.toLowerCase()
    for (const [type, keywords] of Object.entries(SHOP_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        counts[type] = (counts[type] ?? 0) + 1
        break
      }
    }
  }
  let winner = 'shop'
  let best = 0
  for (const [type, count] of Object.entries(counts)) {
    if (count > best) { best = count; winner = type }
    else if (count === best) { winner = 'shop' }
  }
  return winner
}

// Room names matching these patterns are excluded from shop auto-detection.
// Gardens contain harvestable items in shop_items but are not shops.
// Exception: names also containing 'shop' are kept (e.g. "garden shop").
const SHOP_NAME_EXCLUDE = [
  (name) => /garden/i.test(name) && !/shop/i.test(name),
]

export function queryShopTypes(db, mapId, overrides = {}) {
  const rows = db.prepare(`
    SELECT si.room_id, si.item_name, r.room_short
    FROM shop_items si
    JOIN rooms r ON si.room_id = r.room_id
    WHERE r.map_id = ?
  `).all(mapId)

  const roomItems = new Map()
  for (const { room_id, item_name, room_short } of rows) {
    if (SHOP_NAME_EXCLUDE.some(fn => fn(room_short ?? ''))) continue
    if (!roomItems.has(room_id)) roomItems.set(room_id, [])
    roomItems.get(room_id).push(item_name)
  }

  const result = new Map()
  for (const [roomId, items] of roomItems) {
    result.set(roomId, classifyShopItems(items))
  }

  const shortTypePatterns = [
    ['%[player house]%',  'house'],
    ['%[player shop]%',   'pshop'],
    ['%[player club]%',   'club'],
    ['%Bing%bank%',       'bank'],
    ['%Coop%bank%',       'bank'],
  ]
  const shortStmt = db.prepare(
    `SELECT room_id FROM rooms WHERE map_id = ? AND room_short LIKE ? COLLATE NOCASE`
  )
  for (const [pattern, type] of shortTypePatterns) {
    for (const { room_id } of shortStmt.all(mapId, pattern)) {
      if (!result.has(room_id)) result.set(room_id, type)
    }
  }

  for (const [roomId, type] of Object.entries(overrides)) {
    if (!TYPE_LETTERS[type]) {
      console.warn(`[build-svg] room-types.json: unknown type "${type}" for room ${roomId}, skipping`)
      continue
    }
    result.set(roomId, type)
  }
  return result
}

export function queryRooms(db, mapId) {
  return db.prepare(
    'SELECT room_id AS id, xpos AS x, ypos AS y, room_short AS short, room_type AS roomType FROM rooms WHERE map_id = ?'
  ).all(mapId)
}

// Returns deduplicated same-map exit pairs with an isVertical flag.
// A pair is vertical only when ALL exits between those two rooms are vertical —
// if two rooms are connected by both 'n' and 'u', the horizontal line is kept.
export function queryExits(db, mapId) {
  const rows = db.prepare(`
    SELECT re.room_id AS "from", re.connect_id AS "to", re.exit AS dir
    FROM room_exits re
    JOIN rooms r1 ON re.room_id    = r1.room_id AND r1.map_id = ?
    JOIN rooms r2 ON re.connect_id = r2.room_id AND r2.map_id = ?
  `).all(mapId, mapId)

  const seen = new Map()
  for (const row of rows) {
    const key = [row.from, row.to].sort().join('\0')
    const isVert = VERTICAL_EXITS.has(row.dir)
    if (!seen.has(key)) {
      const [a, b] = [row.from, row.to].sort()
      seen.set(key, { from: a, to: b, allVertical: isVert })
    } else if (!isVert) {
      seen.get(key).allVertical = false
    }
  }
  return [...seen.values()].map(({ from, to, allVertical }) => ({
    from, to, isVertical: allVertical,
  }))
}

// Returns a Map<roomId, {hasUp, hasDown}> for rooms that have same-map vertical exits.
export function queryStairRooms(db, mapId) {
  const dirs = [...VERTICAL_EXITS]
  const placeholders = dirs.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT re.room_id AS id, re.exit AS dir
    FROM room_exits re
    JOIN rooms r1 ON re.room_id    = r1.room_id AND r1.map_id = ?
    JOIN rooms r2 ON re.connect_id = r2.room_id AND r2.map_id = ?
    WHERE re.exit IN (${placeholders})
  `).all(mapId, mapId, ...dirs)

  const result = new Map()
  for (const { id, dir } of rows) {
    if (!result.has(id)) result.set(id, { hasUp: false, hasDown: false })
    const entry = result.get(id)
    if (UP_DIRS.has(dir)   || BOTH_DIRS.has(dir)) entry.hasUp   = true
    if (DOWN_DIRS.has(dir) || BOTH_DIRS.has(dir)) entry.hasDown = true
  }
  return result
}

// ─── Water room detection ────────────────────────────────────────────────────

const WATER_NAME_PATTERNS = [
  // River Ankh — surface and under-pier rooms (map 5)
  // am_docks bridge undersides and other edge cases are handled by room-water.json
  /^surface of the river ankh$/i,
  /^under a pier$/i,
  // Pearl River and Tuna Bay (map 17)
  /^pearl river\b/i,
  /^somewhere along pearl river$/i,
  /^east end of the pearl river$/i,
  /^the west end of pearl river$/i,
  /^surface of tuna bay\b/i,
  /^middle of tuna bay\b/i,
  /^choppy surface of the bay\b/i,
  /^beside the piers$/i,
  /^near the end of the piers$/i,
  /^underneath the piers$/i,
  // Sea rooms (map 21)
  /^sea (between|just north|just west)\b/i,
  // Djelibeybi river Djel (map 23)
  /^river djel($| as it)/i,
  /^small section of the river djel$/i,
  // Cave streams (map 29)
  /^flowing stream\b/i,
  /^cave filled with water$/i,
  /^stream$/i,
  // Overworld (map 99)
  /^sea$/i,
  /^swamp$/i,
  /^dense marshland\b/i,
  // Misc
  /^lake$/i,
  /^surface of a pool$/i,
  /^heart of the swamp$/i,
  /^river near slippery hollow$/i,
]

export function isWaterRoom(room, overrideIds = new Set()) {
  if (overrideIds.has(room.id)) return true
  if (room.roomType === 'underwater') return true
  const name = room.short ?? ''
  return WATER_NAME_PATTERNS.some(p => p.test(name))
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

// Returns SVG polygon(s) for the stair direction indicator inside a room.
// ▲ up-only, ▼ down-only, ◆ both (diamond).
export function stairSymbol(x, y, hasUp, hasDown) {
  if (hasUp && hasDown) {
    return `<polygon class="stair-symbol" points="${x},${y - 3} ${x + 2.5},${y} ${x},${y + 3} ${x - 2.5},${y}"/>`
  }
  if (hasUp) {
    return `<polygon class="stair-symbol" points="${x},${y - 3} ${x - 2.5},${y + 2} ${x + 2.5},${y + 2}"/>`
  }
  return `<polygon class="stair-symbol" points="${x},${y + 3} ${x - 2.5},${y - 2} ${x + 2.5},${y - 2}"/>`
}

// stair: null | {hasUp, hasDown}
// type: null | string (key of TYPE_LETTERS)
// compact: true → small room (r=1.5 circle, 3×3 rect)
// water: true → room is in a body of water
// green: true → room is a park or forest
// danger: true → room is in a dangerous area
export function roomElement(id, x, y, short, isIndoor, stair = null, type = null, compact = false, water = false, green = false, danger = false, large = false, extraClass = '') {
  const label       = short ? ` data-label="${escapeXml(short)}"` : ''
  const typeClass   = type   ? ` room-${type}`  : ''
  const sizeClass   = compact ? ' room-compact'  : ''
  const waterClass  = water   ? ' water'          : ''
  const greenClass  = green   ? ' green'          : ''
  const dangerClass = danger  ? ' danger'         : ''
  const extraCls    = extraClass ? ` ${extraClass}` : ''
  const hw = compact ? 1.5 : large ? 8 : 4
  const shape = isIndoor
    ? `<rect id="room-${id}" class="room indoor${typeClass}${sizeClass}${waterClass}${greenClass}${dangerClass}${extraCls}"${label} x="${x - hw}" y="${y - hw}" width="${hw * 2}" height="${hw * 2}" rx="${compact ? 0.75 : 2}"/>`
    : `<circle id="room-${id}" class="room outdoor${typeClass}${sizeClass}${waterClass}${greenClass}${dangerClass}${extraCls}"${label} cx="${x}" cy="${y}" r="${hw}"/>`
  const stairEl = (stair && !type) ? stairSymbol(x, y, stair.hasUp, stair.hasDown) : ''
  const typeEl  = type  ? `<text class="room-type-label" font-size="4.5" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${TYPE_LETTERS[type]}</text>` : ''
  return shape + stairEl + typeEl
}

// Returns null for vertical exit pairs (no line drawn).
export function exitElement(fromId, toId, rooms, isVertical = false, compactRooms = new Set(), waterRooms = new Set(), greenRooms = new Set(), dangerRooms = new Set()) {
  if (isVertical) return null
  const from = rooms.find(r => r.id === fromId)
  const to   = rooms.find(r => r.id === toId)
  if (!from || !to) return ''
  const compact = compactRooms.has(fromId) || compactRooms.has(toId)
  const water   = waterRooms.has(fromId)  && waterRooms.has(toId)
  const green   = !water && greenRooms.has(fromId)  && greenRooms.has(toId)
  const danger  = !water && dangerRooms.has(fromId) && dangerRooms.has(toId)
  return `<line id="${edgeId(fromId, toId)}" class="exit${compact ? ' exit-compact' : ''}${water ? ' exit-water' : ''}${green ? ' exit-green' : ''}${danger ? ' exit-danger' : ''}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`
}

// ─── Map SVG builders ────────────────────────────────────────────────────────

// Typed exits (water/green/danger) rendered before normal ones so normal exits sit on top.
function buildExitLines(exits, rooms, compactRooms, waterRooms, greenRooms, dangerRooms, exitExcludes = new Set()) {
  const typed = [], normal = []
  for (const e of exits) {
    if (exitExcludes.has(edgeId(e.from, e.to))) continue
    const line = '    ' + exitElement(e.from, e.to, rooms, e.isVertical, compactRooms, waterRooms, greenRooms, dangerRooms)
    if (!line.trim()) continue
    const isTyped = (waterRooms.has(e.from)  && waterRooms.has(e.to))  ||
                    (greenRooms.has(e.from)   && greenRooms.has(e.to))  ||
                    (dangerRooms.has(e.from)  && dangerRooms.has(e.to))
    ;(isTyped ? typed : normal).push(line)
  }
  return [...typed, ...normal].join('\n')
}

export function buildNewSvg(mapMeta, rooms, exits, mapId = '', stairRooms = new Map(), shopTypes = new Map(), compactRooms = new Set(), waterOverrides = new Set(), greenOverrides = new Set(), exitExcludes = new Set(), dangerOverrides = new Set(), largeRooms = new Set(), extraClasses = new Map()) {
  const waterRooms  = new Set(rooms.filter(r => isWaterRoom(r, waterOverrides)).map(r => r.id))
  const greenRooms  = new Set(rooms.filter(r => greenOverrides.has(r.id)).map(r => r.id))
  const dangerRooms = new Set(rooms.filter(r => dangerOverrides.has(r.id)).map(r => r.id))
  const exitLines   = buildExitLines(exits, rooms, compactRooms, waterRooms, greenRooms, dangerRooms, exitExcludes)
  const roomShapes  = rooms.map(r => '    ' + roomElement(r.id, r.x, r.y, r.short, r.roomType === 'inside', stairRooms.get(r.id) ?? null, shopTypes.get(r.id) ?? null, compactRooms.has(r.id), waterRooms.has(r.id), greenRooms.has(r.id), dangerRooms.has(r.id), largeRooms.has(r.id), extraClasses.get(r.id) ?? '')).join('\n')

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

  <g id="layer-room-labels"></g>

  <g id="layer-labels"><!-- labels --></g>

</svg>`
}

export function updateExistingSvg(existingSvg, mapMeta, rooms, exits, stairRooms = new Map(), shopTypes = new Map(), compactRooms = new Set(), waterOverrides = new Set(), greenOverrides = new Set(), exitExcludes = new Set(), dangerOverrides = new Set(), largeRooms = new Set(), extraClasses = new Map()) {
  const waterRooms  = new Set(rooms.filter(r => isWaterRoom(r, waterOverrides)).map(r => r.id))
  const greenRooms  = new Set(rooms.filter(r => greenOverrides.has(r.id)).map(r => r.id))
  const dangerRooms = new Set(rooms.filter(r => dangerOverrides.has(r.id)).map(r => r.id))
  const exitLines   = buildExitLines(exits, rooms, compactRooms, waterRooms, greenRooms, dangerRooms, exitExcludes)
  const roomShapes  = rooms.map(r => '    ' + roomElement(r.id, r.x, r.y, r.short, r.roomType === 'inside', stairRooms.get(r.id) ?? null, shopTypes.get(r.id) ?? null, compactRooms.has(r.id), waterRooms.has(r.id), greenRooms.has(r.id), dangerRooms.has(r.id), largeRooms.has(r.id), extraClasses.get(r.id) ?? '')).join('\n')

  let svg = existingSvg.replace(
    /(<g[^>]*\bid="layer-exits"[^>]*>)([\s\S]*?)(<\/g>)/,
    `$1\n${exitLines}\n  $3`
  )
  svg = svg.replace(
    /(<g[^>]*\bid="layer-rooms"[^>]*>)([\s\S]*?)(<\/g>)/,
    `$1\n${roomShapes}\n  $3`
  )
  if (!svg.includes('id="layer-room-labels"')) {
    const re = /(\n[ \t]*<g[^>]*\bid="layer-labels"[^>]*>)/
    if (re.test(svg)) {
      svg = svg.replace(re, `\n\n  <g id="layer-room-labels"></g>$1`)
    } else {
      console.warn('[build-svg] Warning: could not insert layer-room-labels — layer-labels <g> not found')
    }
  }
  return svg
}

// ─── UU Library SVG ──────────────────────────────────────────────────────────

const LIB_COLS      = [46, 76, 106, 136, 166, 196, 226, 256]
const LIB_ENTRY_Y   = 4810
const LIB_STEP      = 30
const LIB_ROWS      = 160  // rows going north from entrance
const LIB_LEFT_PAD  = 25   // extra space left of rooms for row numbers
const LIB_RIGHT_PAD = 450  // extra space right of rooms for book list

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
    lines.push(`    <line class="exit lib-exit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
  }

  const addNormal = (col, row, col2, row2) => {
    const key = [Math.min(col,col2), Math.min(row,row2), Math.max(col,col2), Math.max(row,row2)].join(',')
    if (seen.has(key)) return
    seen.add(key)
    if (missingSet.has(`${col-1},${row-1}`) || missingSet.has(`${col2-1},${row2-1}`)) return
    const [x1, y1] = roomXY(col, row)
    const [x2, y2] = roomXY(col2, row2)
    lines.push(`    <line class="exit lib-exit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
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
  const LINE   = 12
  const FONT   = 9  // matches .lib-book-list font-size
  const PAD    = 4
  const HDR_H  = 12
  const sorted = [...booksArray].sort((a, b) => a[2] - b[2])
  const n      = sorted.length
  const startY = LIB_ENTRY_Y - (n - 1) * LINE - FONT       // bottom-align last item with row 1
  const half   = Math.round(LIB_STEP * 2 / 3) / 2          // = 10
  const boxX   = x - PAD
  const boxW   = LIB_COLS[LIB_COLS.length - 1] + half + LIB_RIGHT_PAD - x
  const boxY   = startY - HDR_H - PAD * 3
  const boxH   = LIB_ENTRY_Y - boxY + FONT + PAD
  const ruleY  = startY - PAD
  const items  = sorted.map(([,, number, description], i) =>
    `    <text class="lib-book-list" x="${x}" y="${startY + i * LINE}" dominant-baseline="hanging">${escapeXml(`${number}: ${description}`)}</text>`
  )
  return [
    `    <rect class="anno-box" x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="2"/>`,
    `    <text class="map-label" x="${x}" y="${boxY + PAD}" dominant-baseline="hanging">Books</text>`,
    `    <line class="anno-rule" x1="${boxX}" y1="${ruleY}" x2="${boxX + boxW}" y2="${ruleY}"/>`,
    ...items,
  ].join('\n') + '\n  '
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

  <g id="layer-room-labels"></g>

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
  if (!svg.includes('id="layer-room-labels"')) {
    const re = /(\n[ \t]*<g[^>]*\bid="layer-labels"[^>]*>)/
    if (re.test(svg)) {
      svg = svg.replace(re, `\n\n  <g id="layer-room-labels"></g>$1`)
    } else {
      console.warn('[build-svg] Warning: could not insert layer-room-labels — layer-labels <g> not found')
    }
  }
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

  let exitExcludes = new Set()
  try { exitExcludes = new Set(JSON.parse(await fs.readFile(EXIT_EXCLUDE_CONFIG, 'utf8'))) } catch {}

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
    svg = updateExistingSvg(existing, mapMeta, roomRows, exitRows, stairRooms, shopTypes, compactRooms, waterOverrides, greenOverrides, exitExcludes, dangerOverrides, largeRooms, extraClasses)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    svg = buildNewSvg(mapMeta, roomRows, exitRows, mapId, stairRooms, shopTypes, compactRooms, waterOverrides, greenOverrides, exitExcludes, dangerOverrides, largeRooms, extraClasses)
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
