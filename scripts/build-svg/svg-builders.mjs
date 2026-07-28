// scripts/build-svg/svg-builders.mjs
// Assembles full map SVGs (new files) and patches existing ones in place.

import { isWaterRoom } from './water.mjs'
import { edgeId } from './utils.mjs'
import { roomElement, exitElement, buildStairLayer } from './elements.mjs'

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
