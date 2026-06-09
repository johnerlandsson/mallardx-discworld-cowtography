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
