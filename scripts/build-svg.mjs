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
const TYPES_CONFIG   = path.join(REPO_ROOT, 'ui', 'data', 'room-types.json')
const COMPACT_CONFIG      = path.join(REPO_ROOT, 'ui', 'data', 'room-compact.json')
const LARGE_CONFIG        = path.join(REPO_ROOT, 'ui', 'data', 'room-large.json')
const EXTRA_CLASS_CONFIG  = path.join(REPO_ROOT, 'ui', 'data', 'room-extra-classes.json')
const WATER_CONFIG        = path.join(REPO_ROOT, 'ui', 'data', 'room-water.json')
const GREEN_CONFIG        = path.join(REPO_ROOT, 'ui', 'data', 'room-green.json')
const DANGER_CONFIG       = path.join(REPO_ROOT, 'ui', 'data', 'room-danger.json')
const BRIDGE_CONFIG       = path.join(REPO_ROOT, 'ui', 'data', 'room-bridge.json')
const EXIT_EXCLUDE_CONFIG = path.join(REPO_ROOT, 'ui', 'data', 'exit-exclude.json')
const EXIT_CLIMB_CONFIG   = path.join(REPO_ROOT, 'ui', 'data', 'exit-climb.json')
const GROUND_CONFIG       = path.join(REPO_ROOT, 'ui', 'data', 'room-ground.json')
const STACKS_OUT          = path.join(REPO_ROOT, 'ui', 'data', 'room-stacks.js')

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
  furniture: 'U',
  bank: '$', changer: '¢', mission: '!', post: 'O', lang: 'L', temple: 'R',
  crafts: 'K', house: 'H', club: 'G', pshop: 'P', tshop: 'T', talker: 'M',
  tavern: 'V',
  pub:    'B',
}

const TAVERN_NAME_KEYWORDS   = ['restaurant', 'tavern', 'pizzeria', 'pizza', 'cafe', 'café']
const PUB_NAME_RE            = /\b(?:pub|bar)\b/
const TAVERN_NAME_EXCLUSIONS = ['outside', ' by ']

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

  // Tavern name matching — overrides shop_items food/shop classification.
  const allMapRooms = db.prepare('SELECT room_id, room_short FROM rooms WHERE map_id = ?').all(mapId)
  for (const { room_id, room_short } of allMapRooms) {
    const lower = (room_short ?? '').toLowerCase()
    if (!TAVERN_NAME_EXCLUSIONS.some(ex => lower.includes(ex))) {
      if (PUB_NAME_RE.test(lower))                                  result.set(room_id, 'pub')
      else if (TAVERN_NAME_KEYWORDS.some(kw => lower.includes(kw))) result.set(room_id, 'tavern')
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

// Returns SVG polygon for the stair direction indicator inside a room.
// ▲ up-only, ▼ down-only, ◆ both (diamond).
export function stairSymbol(x, y, hasUp, hasDown, id = null) {
  const idAttr = id ? ` id="${id}"` : ''
  if (hasUp && hasDown) {
    return `<polygon${idAttr} class="stair-symbol" points="${x},${y - 3} ${x + 2.5},${y} ${x},${y + 3} ${x - 2.5},${y}"/>`
  }
  if (hasUp) {
    return `<polygon${idAttr} class="stair-symbol" points="${x},${y - 3} ${x - 2.5},${y + 2} ${x + 2.5},${y + 2}"/>`
  }
  return `<polygon${idAttr} class="stair-symbol" points="${x},${y + 3} ${x - 2.5},${y - 2} ${x + 2.5},${y - 2}"/>`
}

// Returns SVG polygon for the stair direction indicator, scaled down and
// pushed into the bottom-right corner of the room box. Used instead of
// stairSymbol() for rooms that already show a type letter dead-center, so
// the letter stays legible and the stair info isn't lost entirely.
// Same shape semantics as stairSymbol (▲ up, ▼ down, ◆ both), offset by
// roughly +1..+3 units from center on both axes.
export function stairCornerSymbol(x, y, hasUp, hasDown, id = null) {
  const idAttr = id ? ` id="${id}"` : ''
  if (hasUp && hasDown) {
    return `<polygon${idAttr} class="stair-symbol" points="${x + 2},${y + 1} ${x + 3},${y + 2} ${x + 2},${y + 3} ${x + 1},${y + 2}"/>`
  }
  if (hasUp) {
    return `<polygon${idAttr} class="stair-symbol" points="${x + 2.75},${y + 1.25} ${x + 2.75},${y + 2.75} ${x + 1.25},${y + 2.75}"/>`
  }
  return `<polygon${idAttr} class="stair-symbol" points="${x + 2.75},${y + 2.75} ${x + 1.25},${y + 2.75} ${x + 1.25},${y + 1.25}"/>`
}

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

// Returns { upperToGround, groundToUppers } for all stacked room positions across maps.
// allRooms: Array<{id, mapId, x, y}>
// exitPairs: Array<{from, to, isVertical}>
// stairRooms: Map<roomId, {hasUp, hasDown}>
// overrides: { "mapId:x:y": groundRoomId }
export function buildStackData(allRooms, exitPairs, stairRooms, overrides = {}) {
  // Group rooms by "mapId:x:y" position key.
  const posGroups = new Map()
  for (const { id, mapId, x, y } of allRooms) {
    const key = `${mapId}:${x}:${y}`
    if (!posGroups.has(key)) posGroups.set(key, [])
    posGroups.get(key).push(id)
  }

  // Build non-vertical adjacency: roomId → Set<roomId>
  const adj = new Map()
  for (const { from, to, isVertical } of exitPairs) {
    if (isVertical) continue
    if (!adj.has(from)) adj.set(from, new Set())
    if (!adj.has(to))   adj.set(to,   new Set())
    adj.get(from).add(to)
    adj.get(to).add(from)
  }

  const upperToGround = {}
  const groundToUppers = {}

  for (const [posKey, members] of posGroups) {
    if (members.length < 2) continue

    let groundId = overrides[posKey]

    if (!groundId) {
      // BFS reachability: count non-stack rooms reachable within 5 hops.
      const memberSet = new Set(members)
      const scored = members.map(roomId => {
        const visited = new Set([roomId])
        const queue = [{ id: roomId, depth: 0 }]
        let score = 0
        while (queue.length) {
          const { id, depth } = queue.shift()
          if (depth >= 5) continue
          for (const nb of (adj.get(id) ?? [])) {
            if (visited.has(nb)) continue
            visited.add(nb)
            if (!memberSet.has(nb)) score++
            queue.push({ id: nb, depth: depth + 1 })
          }
        }
        return { roomId, score }
      })

      // Sort: highest score first; tie-break by hasDown=false (ground floor stair pattern).
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const aDown = stairRooms.get(a.roomId)?.hasDown ?? false
        const bDown = stairRooms.get(b.roomId)?.hasDown ?? false
        if (aDown !== bDown) return aDown ? 1 : -1  // prefer hasDown=false
        return 0
      })
      groundId = scored[0].roomId
    }

    const uppers = members.filter(id => id !== groundId)
    for (const upperId of uppers) upperToGround[upperId] = groundId
    if (uppers.length > 0) groundToUppers[groundId] = uppers
  }

  return { upperToGround, groundToUppers }
}

// Returns an SVG polygon "points" attribute string for a regular pointy-top
// hexagon centered at (x, y), with circumradius hw — matching the existing
// circle's r=hw exactly, so it inherits the same compact/large size classes
// and footprint. Sharp points land at top/bottom, flat edges at left/right.
export function hexagonPoints(x, y, hw) {
  const h = hw * Math.sqrt(3) / 2
  return [
    [x,          y - hw],
    [x + h,      y - hw / 2],
    [x + h,      y + hw / 2],
    [x,          y + hw],
    [x - h,      y + hw / 2],
    [x - h,      y - hw / 2],
  ].map(([px, py]) => `${px},${py}`).join(' ')
}

// type: null | string (key of TYPE_LETTERS)
// compact: true → small room (r=1.5 circle, 3×3 rect/hexagon)
// water: true → room is in a body of water
// green: true → room is a park or forest
// danger: true → room is in a dangerous area
// large: true → large room (r=8 circle, 16×16 rect/hexagon)
// bridge: true → room is the physical span of a named bridge; always drawn
//   as a hexagon regardless of isIndoor.
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
    ? `<polygon id="room-${id}" class="room bridge outdoor${typeClass}${sizeClass}${waterClass}${greenClass}${dangerClass}${extraCls}"${label} cx="${x}" cy="${y}" points="${hexagonPoints(x, y, hw)}"/>`
    : isIndoor
      ? `<rect id="room-${id}" class="room indoor${typeClass}${sizeClass}${waterClass}${greenClass}${dangerClass}${extraCls}"${label} x="${x - hw}" y="${y - hw}" width="${hw * 2}" height="${hw * 2}" rx="${compact ? 0.75 : 2}"/>`
      : `<circle id="room-${id}" class="room outdoor${typeClass}${sizeClass}${waterClass}${greenClass}${dangerClass}${extraCls}"${label} cx="${x}" cy="${y}" r="${hw}"/>`
  const typeEl  = type  ? `<text class="room-type-label" font-size="4.5" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${TYPE_LETTERS[type]}</text>` : ''
  return shape + typeEl
}

// Returns null for vertical exit pairs (no line drawn).
export function exitElement(fromId, toId, rooms, isVertical = false, compactRooms = new Set(), waterRooms = new Set(), greenRooms = new Set(), dangerRooms = new Set(), climbEdges = new Set()) {
  if (isVertical) return null
  const from = rooms.find(r => r.id === fromId)
  const to   = rooms.find(r => r.id === toId)
  if (!from || !to) return ''
  const compact = compactRooms.has(fromId) || compactRooms.has(toId)
  const water   = waterRooms.has(fromId)  && waterRooms.has(toId)
  const green   = !water && greenRooms.has(fromId)  && greenRooms.has(toId)
  const danger  = !water && dangerRooms.has(fromId) && dangerRooms.has(toId)
  const climb   = !water && !green && !danger && climbEdges.has(edgeId(fromId, toId))
  return `<line id="${edgeId(fromId, toId)}" class="exit${compact ? ' exit-compact' : ''}${water ? ' exit-water' : ''}${green ? ' exit-green' : ''}${danger ? ' exit-danger' : ''}${climb ? ' exit-climb' : ''}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`
}

// ─── Map SVG builders ────────────────────────────────────────────────────────

// Typed exits (water/green/danger) rendered before normal ones so normal exits sit on top.
function buildExitLines(exits, rooms, compactRooms, waterRooms, greenRooms, dangerRooms, exitExcludes = new Set(), climbEdges = new Set()) {
  const typed = [], normal = []
  for (const e of exits) {
    if (exitExcludes.has(edgeId(e.from, e.to))) continue
    const line = '    ' + exitElement(e.from, e.to, rooms, e.isVertical, compactRooms, waterRooms, greenRooms, dangerRooms, climbEdges)
    if (!line.trim()) continue
    const isTyped = (waterRooms.has(e.from)  && waterRooms.has(e.to))  ||
                    (greenRooms.has(e.from)   && greenRooms.has(e.to))  ||
                    (dangerRooms.has(e.from)  && dangerRooms.has(e.to))
    ;(isTyped ? typed : normal).push(line)
  }
  return [...typed, ...normal].join('\n')
}

export function buildNewSvg(mapMeta, rooms, exits, mapId = '', stairRooms = new Map(), shopTypes = new Map(), compactRooms = new Set(), waterOverrides = new Set(), greenOverrides = new Set(), exitExcludes = new Set(), dangerOverrides = new Set(), largeRooms = new Set(), extraClasses = new Map(), climbEdges = new Set(), bridgeRooms = new Set()) {
  const waterRooms  = new Set(rooms.filter(r => isWaterRoom(r, waterOverrides)).map(r => r.id))
  const greenRooms  = new Set(rooms.filter(r => greenOverrides.has(r.id)).map(r => r.id))
  const dangerRooms = new Set(rooms.filter(r => dangerOverrides.has(r.id)).map(r => r.id))
  const exitLines   = buildExitLines(exits, rooms, compactRooms, waterRooms, greenRooms, dangerRooms, exitExcludes, climbEdges)
  const roomShapes  = rooms.map(r => '    ' + roomElement(r.id, r.x, r.y, r.short, r.roomType === 'inside', shopTypes.get(r.id) ?? null, compactRooms.has(r.id), waterRooms.has(r.id), greenRooms.has(r.id), dangerRooms.has(r.id), largeRooms.has(r.id), bridgeRooms.has(r.id), extraClasses.get(r.id) ?? '')).join('\n')
  const stairShapes = buildStairLayer(rooms, stairRooms, shopTypes)

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

  <g id="layer-stairs">
${stairShapes}
  </g>

  <g id="layer-room-labels"></g>

  <g id="layer-labels"><!-- labels --></g>

</svg>`
}

export function updateExistingSvg(existingSvg, mapMeta, rooms, exits, stairRooms = new Map(), shopTypes = new Map(), compactRooms = new Set(), waterOverrides = new Set(), greenOverrides = new Set(), exitExcludes = new Set(), dangerOverrides = new Set(), largeRooms = new Set(), extraClasses = new Map(), climbEdges = new Set(), bridgeRooms = new Set()) {
  const waterRooms  = new Set(rooms.filter(r => isWaterRoom(r, waterOverrides)).map(r => r.id))
  const greenRooms  = new Set(rooms.filter(r => greenOverrides.has(r.id)).map(r => r.id))
  const dangerRooms = new Set(rooms.filter(r => dangerOverrides.has(r.id)).map(r => r.id))
  const exitLines   = buildExitLines(exits, rooms, compactRooms, waterRooms, greenRooms, dangerRooms, exitExcludes, climbEdges)
  const roomShapes  = rooms.map(r => '    ' + roomElement(r.id, r.x, r.y, r.short, r.roomType === 'inside', shopTypes.get(r.id) ?? null, compactRooms.has(r.id), waterRooms.has(r.id), greenRooms.has(r.id), dangerRooms.has(r.id), largeRooms.has(r.id), bridgeRooms.has(r.id), extraClasses.get(r.id) ?? '')).join('\n')
  const stairShapes = buildStairLayer(rooms, stairRooms, shopTypes)

  let svg = existingSvg.replace(
    /(<g[^>]*\bid="layer-exits"[^>]*>)([\s\S]*?)(<\/g>)/,
    `$1\n${exitLines}\n  $3`
  )
  svg = svg.replace(
    /(<g[^>]*\bid="layer-rooms"[^>]*>)([\s\S]*?)(<\/g>)/,
    `$1\n${roomShapes}\n  $3`
  )
  svg = svg.replace(
    /(<g[^>]*\bid="layer-stairs"[^>]*>)([\s\S]*?)(<\/g>)/,
    `$1\n${stairShapes}\n  $3`
  )
  if (!svg.includes('id="layer-stairs"')) {
    const re = /(<g[^>]*\bid="layer-rooms"[^>]*>[\s\S]*?<\/g>)/
    if (re.test(svg)) {
      svg = svg.replace(re, `$1\n\n  <g id="layer-stairs">\n${stairShapes}\n  </g>`)
    } else {
      console.warn('[build-svg] Warning: could not insert layer-stairs — layer-rooms <g> not found')
    }
  }
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`[build-svg] FAILED: ${e.message}`); process.exit(1) })
}
