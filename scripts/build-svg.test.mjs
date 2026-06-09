import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { queryRooms, queryExits, edgeId, roomElement, exitElement, buildNewSvg, updateExistingSvg, buildLibrarySvg } from './build-svg.mjs'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      map_id  INTEGER NOT NULL,
      xpos    INTEGER NOT NULL,
      ypos    INTEGER NOT NULL,
      room_short TEXT NOT NULL
    );
    CREATE TABLE room_exits (
      room_id    TEXT NOT NULL,
      connect_id TEXT NOT NULL,
      exit       TEXT NOT NULL,
      guessed    INTEGER NOT NULL DEFAULT 0
    );
  `)
  return db
}

describe('queryRooms', () => {
  it('returns rooms for the given map_id only', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 100, 200, 'The Drum')").run()
    db.prepare("INSERT INTO rooms VALUES ('r2', 2, 300, 400, 'Rub-a-dub')").run()
    const result = queryRooms(db, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ id: 'r1', x: 100, y: 200, short: 'The Drum' })
  })

  it('returns empty array when no rooms on map', () => {
    const db = makeDb()
    expect(queryRooms(db, 99)).toEqual([])
  })
})

describe('queryExits', () => {
  it('returns deduplicated pairs for rooms on the same map', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0,   0, 'a')").run()
    db.prepare("INSERT INTO rooms VALUES ('r2', 1, 100, 0, 'b')").run()
    db.prepare("INSERT INTO rooms VALUES ('r3', 2, 0,   0, 'c')").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'e', 0)").run()
    db.prepare("INSERT INTO room_exits VALUES ('r2', 'r1', 'w', 0)").run() // reverse — deduplicate
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r3', 'n', 0)").run() // cross-map — exclude
    const exits = queryExits(db, 1)
    expect(exits).toHaveLength(1)
    expect(exits[0]).toEqual({ from: 'r1', to: 'r2' })
  })

  it('returns empty array when no exits on map', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'a')").run()
    expect(queryExits(db, 1)).toEqual([])
  })
})

describe('edgeId', () => {
  it('produces same ID regardless of argument order', () => {
    expect(edgeId('aaa', 'bbb')).toBe(edgeId('bbb', 'aaa'))
  })

  it('produces different IDs for different pairs', () => {
    expect(edgeId('r1', 'r2')).not.toBe(edgeId('r1', 'r3'))
  })

  it('formats as edge-{lo}-{hi} in sorted order', () => {
    expect(edgeId('bbb', 'aaa')).toBe('edge-aaa-bbb')
  })
})

describe('roomElement', () => {
  it('returns a circle for outdoor rooms (isIndoor=false)', () => {
    const el = roomElement('abc', 100, 200, 'The Drum', false)
    expect(el).toContain('<circle')
    expect(el).toContain('id="room-abc"')
    expect(el).toContain('cx="100"')
    expect(el).toContain('cy="200"')
    expect(el).toContain('r="8"')
    expect(el).toContain('class="room outdoor"')
    expect(el).toContain('<title>The Drum</title>')
  })

  it('returns a rect for indoor rooms (isIndoor=true)', () => {
    const el = roomElement('xyz', 50, 75, 'Cellar', true)
    expect(el).toContain('<rect')
    expect(el).toContain('id="room-xyz"')
    expect(el).toContain('x="42"')    // 50 - 8
    expect(el).toContain('y="67"')    // 75 - 8
    expect(el).toContain('width="16"')
    expect(el).toContain('height="16"')
    expect(el).toContain('rx="4"')
    expect(el).toContain('class="room indoor"')
  })

  it('escapes XML special chars in room name', () => {
    const el = roomElement('r1', 0, 0, "Assassin's & Guild <1>", false)
    expect(el).toContain('&#x27;')    // escaped single quote
    expect(el).toContain('&amp;')     // escaped ampersand
    expect(el).toContain('&lt;')      // escaped less-than
  })
})

describe('exitElement', () => {
  const rooms = [{ id: 'r1', x: 10, y: 20 }, { id: 'r2', x: 50, y: 80 }]

  it('returns a line with deterministic ID', () => {
    const el = exitElement('r1', 'r2', rooms)
    expect(el).toContain('<line')
    expect(el).toContain(`id="${edgeId('r1', 'r2')}"`)
    expect(el).toContain('x1="10"')
    expect(el).toContain('y1="20"')
    expect(el).toContain('x2="50"')
    expect(el).toContain('y2="80"')
    expect(el).toContain('class="exit"')
  })

  it('returns empty string when either endpoint is missing', () => {
    expect(exitElement('r1', 'missing', rooms)).toBe('')
  })
})

describe('buildNewSvg', () => {
  const mapMeta = { maxX: 500, maxY: 400, topLevel: true }
  const rooms   = [
    { id: 'r1', x: 100, y: 100, short: 'Square' },
    { id: 'r2', x: 200, y: 100, short: 'Street' },
  ]
  const exits = [{ from: 'r1', to: 'r2' }]

  it('has correct viewBox', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    expect(svg).toContain('viewBox="0 0 500 400"')
  })

  it('has data-map-id and class="map-svg"', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    expect(svg).toContain('data-map-id="7"')
    expect(svg).toContain('class="map-svg"')
  })

  it('has four layers in order: artwork, exits, rooms, labels', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    const pos = id => svg.indexOf(`id="${id}"`)
    expect(pos('layer-artwork')).toBeLessThan(pos('layer-exits'))
    expect(pos('layer-exits')).toBeLessThan(pos('layer-rooms'))
    expect(pos('layer-rooms')).toBeLessThan(pos('layer-labels'))
  })

  it('uses circles for topLevel maps', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    expect(svg).toContain('<circle id="room-r1"')
  })

  it('uses rects for non-topLevel maps', () => {
    const svg = buildNewSvg({ ...mapMeta, topLevel: false }, rooms, exits, 7)
    expect(svg).toContain('<rect id="room-r1"')
  })

  it('includes exit lines', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    expect(svg).toContain(`id="${edgeId('r1', 'r2')}"`)
  })

  it('seeds layer-labels with text for each room', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    expect(svg).toContain('<text')
    expect(svg).toContain('Square')
    expect(svg).toContain('Street')
  })
})

describe('updateExistingSvg', () => {
  const mapMeta  = { maxX: 500, maxY: 400, topLevel: false }
  const origRooms = [{ id: 'r1', x: 10, y: 10, short: 'Alpha' }, { id: 'r2', x: 50, y: 10, short: 'Beta' }]
  const origExits = [{ from: 'r1', to: 'r2' }]
  const makeSvg   = () => buildNewSvg(mapMeta, origRooms, origExits, 3)

  it('preserves layer-artwork content', () => {
    const svg = makeSvg().replace(
      '<g id="layer-artwork"><!-- artwork --></g>',
      '<g id="layer-artwork"><rect class="map-water" x="0" y="0" width="10" height="10"/></g>'
    )
    expect(updateExistingSvg(svg, mapMeta, origRooms, origExits)).toContain('class="map-water"')
  })

  it('replaces exits layer — new exit present, old exit gone', () => {
    const newRooms = [{ id: 'r1', x: 10, y: 10, short: 'Alpha' }, { id: 'r3', x: 90, y: 10, short: 'Gamma' }]
    const newExits = [{ from: 'r1', to: 'r3' }]
    const updated  = updateExistingSvg(makeSvg(), mapMeta, newRooms, newExits)
    expect(updated).toContain(`id="${edgeId('r1', 'r3')}"`)
    expect(updated).not.toContain(`id="${edgeId('r1', 'r2')}"`)
  })

  it('replaces rooms layer — new room present, old room gone', () => {
    const newRooms = [{ id: 'r3', x: 90, y: 10, short: 'Gamma' }]
    const updated  = updateExistingSvg(makeSvg(), mapMeta, newRooms, [])
    expect(updated).toContain('id="room-r3"')
    expect(updated).not.toContain('id="room-r1"')
  })

  it('preserves layer-labels content', () => {
    const svg = makeSvg().replace(
      '<g id="layer-labels">',
      '<g id="layer-labels"><text class="map-label">Hand-crafted label</text>'
    )
    expect(updateExistingSvg(svg, mapMeta, origRooms, origExits)).toContain('Hand-crafted label')
  })
})

describe('buildLibrarySvg', () => {
  const svg = buildLibrarySvg()

  it('has data-map-id="47"', () => {
    expect(svg).toContain('data-map-id="47"')
  })

  it('has tiles at all 8 columns at entrance row y=4810', () => {
    for (const x of [46, 76, 106, 136, 166, 196, 226, 256]) {
      expect(svg).toContain(`id="room-lib-${x}-4810"`)
    }
  })

  it('has tiles N rows above and below entrance (N=25)', () => {
    expect(svg).toContain('id="room-lib-166-4060"')  // 4810 - 25*30
    expect(svg).toContain('id="room-lib-166-5560"')  // 4810 + 25*30
  })

  it('all tiles are indoor rects', () => {
    expect(svg).toContain('class="room indoor"')
    expect(svg).not.toContain('class="room outdoor"')
    expect(svg).not.toContain('<circle')
  })

  it('has lib-distortion, lib-orb, lib-arrow overlay elements', () => {
    expect(svg).toContain('id="lib-distortion"')
    expect(svg).toContain('id="lib-orb"')
    expect(svg).toContain('id="lib-arrow"')
  })

  it('lib-distortion and lib-orb are initially hidden', () => {
    const distIdx = svg.indexOf('id="lib-distortion"')
    expect(svg.slice(distIdx, distIdx + 80)).toContain('visibility="hidden"')
    const orbIdx = svg.indexOf('id="lib-orb"')
    expect(svg.slice(orbIdx, orbIdx + 80)).toContain('visibility="hidden"')
  })

  it('has exit lines connecting adjacent tiles', () => {
    expect(svg).toContain('class="exit"')
  })

  it('has all four layers', () => {
    expect(svg).toContain('id="layer-artwork"')
    expect(svg).toContain('id="layer-exits"')
    expect(svg).toContain('id="layer-rooms"')
    expect(svg).toContain('id="layer-labels"')
  })
})
