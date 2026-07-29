// scripts/build-svg/elements.mjs
// SVG element generators for individual rooms, exits, and stair symbols.

import { TYPE_LETTERS } from './shop-types.mjs'
import { edgeId, escapeXml } from './utils.mjs'

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
