// scripts/build-svg/db-queries.mjs
// Queries against the Quow minimap database: rooms, exits, and stair rooms.

// Exit directions that represent vertical movement between floors.
// These suppress the connecting line and show a symbol inside the room instead.
export const VERTICAL_EXITS = new Set([
  'u', 'd',
  'climb up', 'climb down', 'climb ladder',
  'stairs', 'staircase', 'trapdoor', 'ladder',
])

// Directions that mean "going up" and "going down" for symbol selection.
export const UP_DIRS   = new Set(['u', 'climb up', 'climb ladder', 'ladder'])
export const DOWN_DIRS = new Set(['d', 'climb down', 'trapdoor'])
// stairs/staircase are ambiguous — mark the room as having both directions.
export const BOTH_DIRS = new Set(['stairs', 'staircase'])

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
