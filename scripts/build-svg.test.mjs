import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { queryRooms, queryExits, queryStairRooms, edgeId, roomElement, stairSymbol, stairCornerSymbol, buildStairLayer, exitElement, buildNewSvg, updateExistingSvg, queryShopTypes, TYPE_LETTERS, isWaterRoom, buildStackData } from './build-svg.mjs'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      map_id  INTEGER NOT NULL,
      xpos    INTEGER NOT NULL,
      ypos    INTEGER NOT NULL,
      room_short TEXT NOT NULL,
      room_type  TEXT NOT NULL DEFAULT 'outside'
    );
    CREATE TABLE room_exits (
      room_id    TEXT NOT NULL,
      connect_id TEXT NOT NULL,
      exit       TEXT NOT NULL,
      guessed    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE shop_items (
      room_id    TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      sale_price TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (room_id, item_name)
    );
  `)
  return db
}

describe('queryRooms', () => {
  it('returns rooms for the given map_id only', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 100, 200, 'The Drum')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 2, 300, 400, 'Rub-a-dub')").run()
    const result = queryRooms(db, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ id: 'r1', x: 100, y: 200, short: 'The Drum', roomType: 'outside' })
  })

  it('returns empty array when no rooms on map', () => {
    const db = makeDb()
    expect(queryRooms(db, 99)).toEqual([])
  })
})

describe('queryExits', () => {
  it('returns deduplicated pairs with isVertical:false for horizontal exits', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0,   0, 'a')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 1, 100, 0, 'b')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r3', 2, 0,   0, 'c')").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'e', 0)").run()
    db.prepare("INSERT INTO room_exits VALUES ('r2', 'r1', 'w', 0)").run() // reverse — deduplicate
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r3', 'n', 0)").run() // cross-map — exclude
    const exits = queryExits(db, 1)
    expect(exits).toHaveLength(1)
    expect(exits[0]).toEqual({ from: 'r1', to: 'r2', isVertical: false })
  })

  it('marks pair as isVertical:true when all exits between rooms are vertical', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'a')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 1, 0, 0, 'b')").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'u', 0)").run()
    db.prepare("INSERT INTO room_exits VALUES ('r2', 'r1', 'd', 0)").run()
    const exits = queryExits(db, 1)
    expect(exits).toHaveLength(1)
    expect(exits[0].isVertical).toBe(true)
  })

  it('keeps isVertical:false when rooms share both horizontal and vertical exits', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'a')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 1, 0, 0, 'b')").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'n', 0)").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'u', 0)").run()
    const exits = queryExits(db, 1)
    expect(exits).toHaveLength(1)
    expect(exits[0].isVertical).toBe(false)
  })

  it('returns empty array when no exits on map', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'a')").run()
    expect(queryExits(db, 1)).toEqual([])
  })
})

describe('queryStairRooms', () => {
  it('returns empty map when no vertical exits', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'a')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 1, 0, 0, 'b')").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'n', 0)").run()
    expect(queryStairRooms(db, 1).size).toBe(0)
  })

  it('sets hasUp for u exit', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'a')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 1, 0, 0, 'b')").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'u', 0)").run()
    const m = queryStairRooms(db, 1)
    expect(m.get('r1')).toEqual({ hasUp: true, hasDown: false })
  })

  it('sets hasDown for d exit', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'a')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 1, 0, 0, 'b')").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'd', 0)").run()
    const m = queryStairRooms(db, 1)
    expect(m.get('r1')).toEqual({ hasUp: false, hasDown: true })
  })

  it('sets both for stairs exit', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'a')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 1, 0, 0, 'b')").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'stairs', 0)").run()
    const m = queryStairRooms(db, 1)
    expect(m.get('r1')).toEqual({ hasUp: true, hasDown: true })
  })

  it('excludes vertical exits to other maps', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'a')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 2, 0, 0, 'b')").run()
    db.prepare("INSERT INTO room_exits VALUES ('r1', 'r2', 'u', 0)").run()
    expect(queryStairRooms(db, 1).size).toBe(0)
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

describe('stairSymbol', () => {
  it('returns an up triangle for hasUp only', () => {
    const s = stairSymbol(10, 20, true, false)
    expect(s).toContain('class="stair-symbol"')
    expect(s).toContain('<polygon')
    expect(s).toContain('10,17')   // apex y = 20-3
  })

  it('returns a down triangle for hasDown only', () => {
    const s = stairSymbol(10, 20, false, true)
    expect(s).toContain('10,23')   // apex y = 20+3
  })

  it('returns a diamond (single polygon) for both', () => {
    const s = stairSymbol(10, 20, true, true)
    expect(s).toContain('10,17')   // top apex y = 20-3
    expect(s).toContain('10,23')   // bottom apex y = 20+3
    expect((s.match(/<polygon/g) ?? []).length).toBe(1)
  })

  it('includes id attribute when id is provided', () => {
    const s = stairSymbol(10, 20, true, false, 'stair-abc')
    expect(s).toContain('id="stair-abc"')
  })

  it('omits id attribute when id is not provided', () => {
    const s = stairSymbol(10, 20, true, false)
    expect(s).not.toContain('id=')
  })
})

describe('stairCornerSymbol', () => {
  it('returns an up wedge for hasUp only, offset into the bottom-right corner', () => {
    const s = stairCornerSymbol(10, 20, true, false)
    expect(s).toContain('class="stair-symbol"')
    expect(s).toContain('<polygon')
    expect(s).toContain('12.75,21.25')
    expect(s).toContain('12.75,22.75')
    expect(s).toContain('11.25,22.75')
  })

  it('returns a down wedge for hasDown only, offset into the bottom-right corner', () => {
    const s = stairCornerSymbol(10, 20, false, true)
    expect(s).toContain('12.75,22.75')
    expect(s).toContain('11.25,22.75')
    expect(s).toContain('11.25,21.25')
  })

  it('returns a small diamond (single polygon) for both, centered in the corner region', () => {
    const s = stairCornerSymbol(10, 20, true, true)
    expect(s).toContain('12,21')
    expect(s).toContain('13,22')
    expect(s).toContain('12,23')
    expect(s).toContain('11,22')
    expect((s.match(/<polygon/g) ?? []).length).toBe(1)
  })

  it('includes id attribute when id is provided', () => {
    const s = stairCornerSymbol(10, 20, true, false, 'stair-abc')
    expect(s).toContain('id="stair-abc"')
  })

  it('omits id attribute when id is not provided', () => {
    const s = stairCornerSymbol(10, 20, true, false)
    expect(s).not.toContain('id=')
  })

  it('stays within the room box, unlike the full-size centered symbol', () => {
    const corner = stairCornerSymbol(10, 20, true, true)
    const centered = stairSymbol(10, 20, true, true)
    expect(corner).not.toBe(centered)
  })
})

describe('buildStairLayer', () => {
  const rooms = [
    { id: 'r1', x: 100, y: 200 },
    { id: 'r2', x: 50,  y: 75  },
    { id: 'r3', x: 30,  y: 30  },
  ]

  it('returns empty string when no stair rooms', () => {
    expect(buildStairLayer(rooms, new Map())).toBe('')
  })

  it('emits a polygon with id="stair-{roomId}" for stair rooms', () => {
    const stairRooms = new Map([['r1', { hasUp: true, hasDown: false }]])
    const result = buildStairLayer(rooms, stairRooms)
    expect(result).toContain('id="stair-r1"')
    expect(result).toContain('class="stair-symbol"')
    expect(result).toContain('<polygon')
  })

  it('uses the corner-offset symbol for rooms with a shop type', () => {
    const stairRooms = new Map([['r1', { hasUp: true, hasDown: false }]])
    const shopTypes  = new Map([['r1', 'bank']])
    const result = buildStairLayer(rooms, stairRooms, shopTypes)
    expect(result).toBe('    ' + stairCornerSymbol(100, 200, true, false, 'stair-r1'))
  })

  it('emits the full-size symbol for rooms without a type, the corner symbol for rooms with one', () => {
    const stairRooms = new Map([
      ['r1', { hasUp: true,  hasDown: false }],
      ['r2', { hasUp: false, hasDown: true  }],
    ])
    const shopTypes = new Map([['r1', 'bank']])
    const result = buildStairLayer(rooms, stairRooms, shopTypes)
    expect(result).toContain(stairCornerSymbol(100, 200, true, false, 'stair-r1'))
    expect(result).toContain(stairSymbol(50, 75, false, true, 'stair-r2'))
  })
})

describe('roomElement', () => {
  it('returns a circle for outdoor rooms (isIndoor=false)', () => {
    const el = roomElement('abc', 100, 200, 'The Drum', false)
    expect(el).toContain('<circle')
    expect(el).toContain('id="room-abc"')
    expect(el).toContain('cx="100"')
    expect(el).toContain('cy="200"')
    expect(el).toContain('r="4"')
    expect(el).toContain('class="room outdoor"')
    expect(el).toContain('data-label="The Drum"')
  })

  it('returns a rect for indoor rooms (isIndoor=true)', () => {
    const el = roomElement('xyz', 50, 75, 'Cellar', true)
    expect(el).toContain('<rect')
    expect(el).toContain('id="room-xyz"')
    expect(el).toContain('x="46"')    // 50 - 4
    expect(el).toContain('y="71"')    // 75 - 4
    expect(el).toContain('width="8"')
    expect(el).toContain('height="8"')
    expect(el).toContain('rx="2"')
    expect(el).toContain('class="room indoor"')
  })

  it('escapes XML special chars in room name', () => {
    const el = roomElement('r1', 0, 0, "Assassin's & Guild <1>", false)
    expect(el).toContain('&#x27;')    // escaped single quote
    expect(el).toContain('&amp;')     // escaped ampersand
    expect(el).toContain('&lt;')      // escaped less-than
  })

  it('never contains a stair polygon (stair symbols live in layer-stairs)', () => {
    const el = roomElement('r1', 10, 20, 'Room', false)
    expect(el).not.toContain('<polygon')
    expect(el).not.toContain('stair-symbol')
  })
})

describe('roomElement (with type)', () => {
  it('plain room is unchanged when type is null', () => {
    const el = roomElement('r1', 10, 20, 'Room', false, null, null)
    expect(el).toContain('class="room outdoor"')
    expect(el).not.toContain(' room-')
    expect(el).not.toContain('<text')
  })

  it('outdoor typed room has type class and centered letter', () => {
    const el = roomElement('r1', 10, 20, 'Armoury', false, 'weapon')
    expect(el).toContain('class="room outdoor room-weapon"')
    expect(el).toContain('<text class="room-type-label"')
    expect(el).toContain('x="10"')
    expect(el).toContain('y="20"')
    expect(el).toContain('text-anchor="middle"')
    expect(el).toContain('dominant-baseline="central"')
    expect(el).toContain('>W<')
  })

  it('indoor typed room has type class and centered letter', () => {
    const el = roomElement('r1', 50, 75, 'Inn', true, 'food')
    expect(el).toContain('class="room indoor room-food"')
    expect(el).toContain('<text class="room-type-label"')
    expect(el).toContain('x="50"')
    expect(el).toContain('y="75"')
    expect(el).toContain('>F<')
  })

  it('typed room has type label and no stair polygon', () => {
    const el = roomElement('r1', 10, 20, 'Bank', false, 'bank')
    expect(el).not.toContain('<polygon')
    expect(el).toContain('<text class="room-type-label"')
    expect(el).toContain('>$<')
  })

  it('TYPE_LETTERS covers all 15 types', () => {
    const expected = ['shop', 'weapon', 'armour', 'clothes', 'food', 'access',
                      'bank', 'mission', 'post', 'lang',
                      'crafts', 'house', 'club', 'pshop', 'tshop']
    for (const t of expected) {
      expect(TYPE_LETTERS[t]).toBeTruthy()
    }
  })
})

describe('roomElement (compact)', () => {
  it('compact outdoor room has r=1.5 and room-compact class', () => {
    const el = roomElement('r1', 10, 20, 'Alley', false, null, true)
    expect(el).toContain('class="room outdoor room-compact"')
    expect(el).toContain('r="1.5"')
    expect(el).not.toContain('r="4"')
  })

  it('compact indoor room has 3x3 size and rx=0.75', () => {
    const el = roomElement('r1', 50, 75, 'Hall', true, null, true)
    expect(el).toContain('class="room indoor room-compact"')
    expect(el).toContain('width="3"')
    expect(el).toContain('height="3"')
    expect(el).toContain('rx="0.75"')
    expect(el).toContain(`x="${50 - 1.5}"`)
    expect(el).toContain(`y="${75 - 1.5}"`)
  })

  it('non-compact outdoor room still has r=4', () => {
    const el = roomElement('r1', 10, 20, 'Room', false, null, false)
    expect(el).toContain('r="4"')
    expect(el).not.toContain('room-compact')
  })

  it('compact room with type has both classes', () => {
    const el = roomElement('r1', 10, 20, 'Shop', false, 'weapon', true)
    expect(el).toContain('class="room outdoor room-weapon room-compact"')
    expect(el).toContain('r="1.5"')
    expect(el).toContain('>W<')
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

  it('returns null for vertical exits', () => {
    expect(exitElement('r1', 'r2', rooms, true)).toBeNull()
  })

  it('returns empty string when either endpoint is missing', () => {
    expect(exitElement('r1', 'missing', rooms)).toBe('')
  })

  it('adds exit-compact class when either endpoint is compact', () => {
    const compact = new Set(['r1'])
    expect(exitElement('r1', 'r2', rooms, false, compact)).toContain('class="exit exit-compact"')
  })

  it('adds exit-compact class when both endpoints are compact', () => {
    const compact = new Set(['r1', 'r2'])
    expect(exitElement('r1', 'r2', rooms, false, compact)).toContain('class="exit exit-compact"')
  })

  it('no exit-compact class when neither endpoint is compact', () => {
    expect(exitElement('r1', 'r2', rooms, false, new Set())).toContain('class="exit"')
    expect(exitElement('r1', 'r2', rooms, false, new Set())).not.toContain('exit-compact')
  })

  it('adds exit-water class when both endpoints are water rooms', () => {
    const water = new Set(['r1', 'r2'])
    expect(exitElement('r1', 'r2', rooms, false, new Set(), water)).toContain('exit-water')
  })

  it('does not add exit-water when only one endpoint is a water room', () => {
    const water = new Set(['r1'])
    expect(exitElement('r1', 'r2', rooms, false, new Set(), water)).not.toContain('exit-water')
  })
})

describe('isWaterRoom', () => {
  it('detects underwater room type', () => {
    expect(isWaterRoom({ roomType: 'underwater', short: 'something' })).toBe(true)
  })

  it('detects river Ankh surface and under-pier rooms', () => {
    expect(isWaterRoom({ roomType: 'outside', short: 'surface of the river Ankh' })).toBe(true)
    expect(isWaterRoom({ roomType: 'outside', short: 'under a pier' })).toBe(true)
  })

  it('detects bridge undersides via override set', () => {
    const overrides = new Set(['abc123'])
    expect(isWaterRoom({ id: 'abc123', roomType: 'outside', short: 'under Ankh Bridge' }, overrides)).toBe(true)
    expect(isWaterRoom({ id: 'other', roomType: 'outside', short: 'under Ankh Bridge' }, overrides)).toBe(false)
  })

  it('does not mark walkable river-bank rooms as water', () => {
    expect(isWaterRoom({ roomType: 'outside', short: 'muddy part of the river Ankh' })).toBe(false)
    expect(isWaterRoom({ roomType: 'outside', short: 'solid part of the river Ankh' })).toBe(false)
  })

  it('detects Pearl River and Tuna Bay rooms', () => {
    expect(isWaterRoom({ roomType: 'outside', short: 'Pearl River between two bridges' })).toBe(true)
    expect(isWaterRoom({ roomType: 'outside', short: 'surface of Tuna Bay' })).toBe(true)
    expect(isWaterRoom({ roomType: 'outside', short: 'middle of Tuna Bay next to a huge broken mast' })).toBe(true)
  })

  it('does not mark land rooms as water', () => {
    expect(isWaterRoom({ roomType: 'outside', short: 'Dock Road' })).toBe(false)
    expect(isWaterRoom({ roomType: 'outside', short: 'under the docks' })).toBe(false)
    expect(isWaterRoom({ roomType: 'outside', short: "under Pon's Bridge" })).toBe(false)
    expect(isWaterRoom({ roomType: 'outside', short: 'Waterfront' })).toBe(false)
    expect(isWaterRoom({ roomType: 'outside', short: 'muddy path along the side of Mort Lake' })).toBe(false)
  })
})

describe('roomElement (water)', () => {
  it('adds water class to water room', () => {
    const el = roomElement('r1', 10, 20, 'surface of the river Ankh', false, null, false, true)
    expect(el).toContain('water')
  })

  it('does not add water class to normal room', () => {
    const el = roomElement('r1', 10, 20, 'Dock Road', false, null, false, false)
    expect(el).not.toContain('water')
  })
})

describe('roomElement (green)', () => {
  it('adds green class to green room', () => {
    const el = roomElement('r1', 10, 20, 'Scoone Avenue Park', false, null, false, false, true)
    expect(el).toContain('green')
  })

  it('does not add green class to normal room', () => {
    const el = roomElement('r1', 10, 20, 'Market Street', false, null, false, false, false)
    expect(el).not.toContain('green')
  })

})

describe('exitElement (green)', () => {
  const rooms = [
    { id: 'r1', x: 10, y: 10 },
    { id: 'r2', x: 20, y: 10 },
  ]

  it('adds exit-green class when both endpoints are green rooms', () => {
    const green = new Set(['r1', 'r2'])
    expect(exitElement('r1', 'r2', rooms, false, new Set(), new Set(), green)).toContain('exit-green')
  })

  it('does not add exit-green when only one endpoint is green', () => {
    const green = new Set(['r1'])
    expect(exitElement('r1', 'r2', rooms, false, new Set(), new Set(), green)).not.toContain('exit-green')
  })

  it('does not add exit-green when both are water (water takes precedence)', () => {
    const water = new Set(['r1', 'r2'])
    const green = new Set(['r1', 'r2'])
    const el = exitElement('r1', 'r2', rooms, false, new Set(), water, green)
    expect(el).not.toContain('exit-green')
    expect(el).toContain('exit-water')
  })
})

describe('roomElement (danger)', () => {
  it('adds danger class to danger room', () => {
    const el = roomElement('r1', 10, 20, 'Arena', false, null, false, false, false, true)
    expect(el).toContain('danger')
  })

  it('does not add danger class to normal room', () => {
    const el = roomElement('r1', 10, 20, 'Market Street', false, null, false, false, false, false)
    expect(el).not.toContain('danger')
  })
})

describe('exitElement (danger)', () => {
  const rooms = [
    { id: 'r1', x: 10, y: 10 },
    { id: 'r2', x: 20, y: 10 },
  ]

  it('adds exit-danger class when both endpoints are danger rooms', () => {
    const danger = new Set(['r1', 'r2'])
    expect(exitElement('r1', 'r2', rooms, false, new Set(), new Set(), new Set(), danger)).toContain('exit-danger')
  })

  it('does not add exit-danger when only one endpoint is danger', () => {
    const danger = new Set(['r1'])
    expect(exitElement('r1', 'r2', rooms, false, new Set(), new Set(), new Set(), danger)).not.toContain('exit-danger')
  })

  it('does not add exit-danger when both are water (water takes precedence)', () => {
    const water  = new Set(['r1', 'r2'])
    const danger = new Set(['r1', 'r2'])
    const el = exitElement('r1', 'r2', rooms, false, new Set(), water, new Set(), danger)
    expect(el).not.toContain('exit-danger')
    expect(el).toContain('exit-water')
  })
})

describe('buildNewSvg', () => {
  const mapMeta = { maxX: 500, maxY: 400 }
  const rooms   = [
    { id: 'r1', x: 100, y: 100, short: 'Square', roomType: 'outside' },
    { id: 'r2', x: 200, y: 100, short: 'Street', roomType: 'outside' },
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

  it('has six layers in order: artwork, exits, rooms, stairs, room-labels, labels', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    const pos = id => svg.indexOf(`id="${id}"`)
    expect(pos('layer-artwork')).toBeLessThan(pos('layer-exits'))
    expect(pos('layer-exits')).toBeLessThan(pos('layer-rooms'))
    expect(pos('layer-rooms')).toBeLessThan(pos('layer-stairs'))
    expect(pos('layer-stairs')).toBeLessThan(pos('layer-room-labels'))
    expect(pos('layer-room-labels')).toBeLessThan(pos('layer-labels'))
  })

  it('uses circles for outside rooms', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    expect(svg).toContain('<circle id="room-r1"')
  })

  it('uses rects for inside rooms', () => {
    const indoorRooms = rooms.map(r => ({ ...r, roomType: 'inside' }))
    const svg = buildNewSvg(mapMeta, indoorRooms, exits, 7)
    expect(svg).toContain('<rect id="room-r1"')
  })

  it('includes exit lines', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    expect(svg).toContain(`id="${edgeId('r1', 'r2')}"`)
  })

  it('seeds layer-labels empty', () => {
    const svg = buildNewSvg(mapMeta, rooms, exits, 7)
    expect(svg).toContain('id="layer-labels"')
    expect(svg).not.toContain('<text')
  })

  it('applies room type class and letter when shopTypes provided', () => {
    const shopTypes = new Map([['r1', 'weapon']])
    const svg = buildNewSvg(mapMeta, rooms, exits, 7, new Map(), shopTypes)
    expect(svg).toContain('class="room outdoor room-weapon"')
    expect(svg).toContain('<text class="room-type-label"')
    expect(svg).toContain('>W<')
  })

  it('plain room unchanged when not in shopTypes', () => {
    const shopTypes = new Map([['r1', 'weapon']])
    const svg = buildNewSvg(mapMeta, rooms, exits, 7, new Map(), shopTypes)
    // r2 is plain — verify its element has no type suffix
    expect(svg).toContain('id="room-r2" class="room outdoor"')
  })
})

describe('updateExistingSvg', () => {
  const mapMeta  = { maxX: 500, maxY: 400 }
  const origRooms = [{ id: 'r1', x: 10, y: 10, short: 'Alpha', roomType: 'inside' }, { id: 'r2', x: 50, y: 10, short: 'Beta', roomType: 'inside' }]
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

  it('replaces rooms when layer-rooms is Inkscape-reformatted across multiple lines', () => {
    const inkscapeSvg = makeSvg()
      .replace('\n  <g id="layer-rooms">', '\n  <g\n     inkscape:label="rooms"\n     id="layer-rooms">')
    const newRooms = [{ id: 'r3', x: 90, y: 10, short: 'Gamma', roomType: 'inside' }]
    const updated = updateExistingSvg(inkscapeSvg, mapMeta, newRooms, [])
    expect(updated).toContain('id="room-r3"')
    expect(updated).not.toContain('id="room-r1"')
  })

  it('inserts layer-room-labels after layer-rooms when missing from existing SVG', () => {
    // Simulate old SVG without the new layer
    const oldSvg = makeSvg().replace('\n\n  <g id="layer-room-labels"></g>', '')
    const updated = updateExistingSvg(oldSvg, mapMeta, origRooms, origExits)
    const pos = id => updated.indexOf(`id="${id}"`)
    expect(pos('layer-room-labels')).toBeGreaterThan(pos('layer-rooms'))
    expect(pos('layer-room-labels')).toBeLessThan(pos('layer-labels'))
  })

  it('inserts layer-room-labels when layer-labels is Inkscape-reformatted across multiple lines', () => {
    // Inkscape reformats <g id="layer-labels"> onto multiple lines with extra attributes
    const oldSvg = makeSvg()
      .replace('\n\n  <g id="layer-room-labels"></g>', '')
      .replace('\n  <g id="layer-labels">', '\n  <g\n     inkscape:label="labels"\n     id="layer-labels">')
    const updated = updateExistingSvg(oldSvg, mapMeta, origRooms, origExits)
    const pos = id => updated.indexOf(`id="${id}"`)
    expect(pos('layer-room-labels')).toBeGreaterThan(pos('layer-rooms'))
    expect(pos('layer-room-labels')).toBeLessThan(pos('layer-labels'))
  })

  it('preserves existing layer-room-labels content on update', () => {
    const svg = makeSvg().replace(
      '<g id="layer-room-labels"></g>',
      '<g id="layer-room-labels"><text class="room-type-label" x="10" y="20">X</text></g>'
    )
    expect(updateExistingSvg(svg, mapMeta, origRooms, origExits)).toContain('>X<')
  })

  it('applies room type class and letter when shopTypes provided', () => {
    const shopTypes = new Map([['r1', 'food']])
    const updated = updateExistingSvg(makeSvg(), mapMeta, origRooms, origExits, new Map(), shopTypes)
    expect(updated).toContain('room-food')
    expect(updated).toContain('>F<')
  })
})

describe('queryShopTypes', () => {
  it('returns empty map when no rooms have shop items on this map', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Room')").run()
    expect(queryShopTypes(db, 1).size).toBe(0)
  })

  it('classifies a room with majority weapon items as weapon', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'long sword', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'short sword', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'dagger', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('weapon')
  })

  it('classifies a room with no matching keywords as generic shop', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'mystery item', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('shop')
  })

  it('picks majority type: three food items beat one armour item', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Bakery')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'apple pie', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'chocolate cake', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'beef stew', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'metal helm', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('food')
  })

  it('returns shop on a tie between two sub-types', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Mixed')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'long sword', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'metal helm', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('shop')
  })

  it('manual override wins over keyword heuristic', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Sword Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'long sword', '')").run()
    expect(queryShopTypes(db, 1, { 'r1': 'bank' }).get('r1')).toBe('bank')
  })

  it('override applies to rooms not in shop_items', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Bank')").run()
    expect(queryShopTypes(db, 1, { 'r1': 'bank' }).get('r1')).toBe('bank')
  })

  it('does not include rooms from other maps', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Map1 Room')").run()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r2', 2, 0, 0, 'Map2 Shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r2', 'long sword', '')").run()
    expect(queryShopTypes(db, 1).has('r2')).toBe(false)
  })

  it('auto-detects player houses from room_short', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, '[player house]')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('house')
  })

  it('auto-detects player shops from room_short', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, '[player shop]')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('pshop')
  })

  it('auto-detects player clubs from room_short', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, '[player club]')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('club')
  })

  it("auto-detects Bing's Bank from room_short", () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES (?, 1, 0, 0, ?)").run('r1', "branch of Bing's Bank")
    expect(queryShopTypes(db, 1).get('r1')).toBe('bank')
  })

  it('auto-detects Cooperative Bank from room_short', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES (?, 1, 0, 0, ?)").run('r1', "Lancrastian Farmers' Cooperative Bank")
    expect(queryShopTypes(db, 1).get('r1')).toBe('bank')
  })

  it('room_short detection does not overwrite a shop', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, '[player house]')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'long sword', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('weapon')
  })

  it('manual override beats room_short auto-detection', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, '[player house]')").run()
    expect(queryShopTypes(db, 1, { 'r1': 'pshop' }).get('r1')).toBe('pshop')
  })

  it('excludes garden rooms with harvestable items from shop detection', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'neat herb garden')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'some comfrey', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'some yarrow', '')").run()
    expect(queryShopTypes(db, 1).has('r1')).toBe(false)
  })

  it('keeps "garden shop" as a real shop despite garden in name', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'garden shop')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'rake', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('shop')
  })

  it('skips and warns for unknown override type', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Room')").run()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = queryShopTypes(db, 1, { 'r1': 'bank s' })
    expect(result.has('r1')).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown type "bank s"'))
    warnSpy.mockRestore()
  })

  it('auto-detects tavern from name containing "tavern"', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'The Broken Tavern')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('tavern')
  })

  it('auto-detects pub from name containing "bar"', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES (?, 1, 0, 0, ?)").run('r1', "Troll's Head Bar")
    expect(queryShopTypes(db, 1).get('r1')).toBe('pub')
  })

  it('auto-detects pub from name containing "pub"', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'The Mended Pub')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('pub')
  })

  it('auto-detects tavern from name containing "restaurant"', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Le Petit Restaurant')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('tavern')
  })

  it('auto-detects tavern from name containing "cafe"', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'The Sunrise Cafe')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('tavern')
  })

  it('pub name match overrides shop_items food classification', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'The Pub')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'apple pie', '')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'beef stew', '')").run()
    expect(queryShopTypes(db, 1).get('r1')).toBe('pub')
  })

  it('does not classify rooms containing "barn" as pub', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Inside the Barn')").run()
    expect(queryShopTypes(db, 1).has('r1')).toBe(false)
  })

  it('does not classify "outside" rooms as pub or tavern', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Outside the pub')").run()
    expect(queryShopTypes(db, 1).has('r1')).toBe(false)
  })

  it('does not classify street rooms adjacent to a tavern/cafe as tavern', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'Market Street by a boulevard cafe')").run()
    expect(queryShopTypes(db, 1).has('r1')).toBe(false)
  })

  it('manual override beats pub name detection', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms(room_id,map_id,xpos,ypos,room_short) VALUES ('r1', 1, 0, 0, 'The Famous Pub')").run()
    expect(queryShopTypes(db, 1, { 'r1': 'food' }).get('r1')).toBe('food')
  })
})

describe('buildStackData', () => {
  it('returns empty maps when no stacked positions', () => {
    const rooms = [
      { id: 'r1', mapId: 1, x: 0, y: 0 },
      { id: 'r2', mapId: 1, x: 10, y: 0 },
    ]
    const exits = [{ from: 'r1', to: 'r2', isVertical: false }]
    const { upperToGround, groundToUppers } = buildStackData(rooms, exits, new Map())
    expect(upperToGround).toEqual({})
    expect(groundToUppers).toEqual({})
  })

  it('identifies ground floor by BFS reachability score', () => {
    // r1 (ground) connects to r3 in the street; r2 (upper) has no cardinal exits
    const rooms = [
      { id: 'r1', mapId: 1, x: 0, y: 0 },
      { id: 'r2', mapId: 1, x: 0, y: 0 },
      { id: 'r3', mapId: 1, x: 10, y: 0 },
    ]
    const exits = [{ from: 'r1', to: 'r3', isVertical: false }]
    const { upperToGround, groundToUppers } = buildStackData(rooms, exits, new Map())
    expect(upperToGround).toEqual({ r2: 'r1' })
    expect(groundToUppers).toEqual({ r1: ['r2'] })
  })

  it('applies override regardless of BFS score', () => {
    const rooms = [
      { id: 'r1', mapId: 1, x: 0, y: 0 },
      { id: 'r2', mapId: 1, x: 0, y: 0 },
      { id: 'r3', mapId: 1, x: 10, y: 0 },
    ]
    const exits = [{ from: 'r1', to: 'r3', isVertical: false }]
    // r1 would normally win (higher score), but override forces r2 as ground
    const { upperToGround, groundToUppers } = buildStackData(rooms, exits, new Map(), { '1:0:0': 'r2' })
    expect(upperToGround).toEqual({ r1: 'r2' })
    expect(groundToUppers).toEqual({ r2: ['r1'] })
  })

  it('uses hasDown=false as tiebreaker when BFS scores are equal', () => {
    // Both rooms score 0; r1 has only an up exit (ground floor), r2 has only a down exit (upper)
    const rooms = [
      { id: 'r1', mapId: 1, x: 0, y: 0 },
      { id: 'r2', mapId: 1, x: 0, y: 0 },
    ]
    const stairRooms = new Map([
      ['r1', { hasUp: true,  hasDown: false }],
      ['r2', { hasUp: false, hasDown: true  }],
    ])
    const { upperToGround } = buildStackData(rooms, [], stairRooms)
    expect(upperToGround).toEqual({ r2: 'r1' })
  })

  it('BFS counts rooms reachable within 5 hops and ignores rooms at depth 6', () => {
    // r1 connects to a chain of 6 rooms (c0–c5); r2 has no cardinal exits
    // r1 should reach c0–c4 (5 rooms), c5 at depth 6 is not counted — but r1 still wins
    const chain = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, mapId: 1, x: (i + 1) * 10, y: 0 }))
    const rooms = [
      { id: 'r1', mapId: 1, x: 0, y: 0 },
      { id: 'r2', mapId: 1, x: 0, y: 0 },
      ...chain,
    ]
    const exits = chain.map((c, i) => ({
      from: i === 0 ? 'r1' : `c${i - 1}`,
      to: c.id,
      isVertical: false,
    }))
    const { upperToGround } = buildStackData(rooms, exits, new Map())
    expect(upperToGround).toEqual({ r2: 'r1' })
  })

  it('handles three-room stack correctly', () => {
    const rooms = [
      { id: 'r1', mapId: 1, x: 0, y: 0 },
      { id: 'r2', mapId: 1, x: 0, y: 0 },
      { id: 'r3', mapId: 1, x: 0, y: 0 },
      { id: 'st', mapId: 1, x: 10, y: 0 },
    ]
    const exits = [{ from: 'r1', to: 'st', isVertical: false }]
    const { upperToGround, groundToUppers } = buildStackData(rooms, exits, new Map())
    expect(upperToGround['r2']).toBe('r1')
    expect(upperToGround['r3']).toBe('r1')
    expect(groundToUppers['r1']).toContain('r2')
    expect(groundToUppers['r1']).toContain('r3')
    expect(groundToUppers['r1']).toHaveLength(2)
  })

  it('rooms on different maps with same x:y are not stacked together', () => {
    const rooms = [
      { id: 'r1', mapId: 1, x: 0, y: 0 },
      { id: 'r2', mapId: 2, x: 0, y: 0 },
    ]
    const { upperToGround } = buildStackData(rooms, [], new Map())
    expect(upperToGround).toEqual({})
  })
})
