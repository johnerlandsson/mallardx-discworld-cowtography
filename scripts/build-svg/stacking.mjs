// scripts/build-svg/stacking.mjs
// Multi-floor room stack detection: which same-position rooms across all maps
// are "upper floor" rooms relative to a "ground floor" room.

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
