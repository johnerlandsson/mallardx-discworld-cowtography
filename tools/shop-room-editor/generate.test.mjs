import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { collectShopItems, buildRoomRecords } from './generate.mjs'

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
    CREATE TABLE shop_items (
      room_id    TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      sale_price TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (room_id, item_name)
    );
  `)
  return db
}

describe('collectShopItems', () => {
  it('groups items by room and sorts alphabetically, case-insensitively', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Bakery', 'inside')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'Wheat Bread', 'A$1')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'apple pie', '50p')").run()
    const result = collectShopItems(db)
    expect(result.get('r1')).toEqual([
      { name: 'apple pie', price: '50p' },
      { name: 'Wheat Bread', price: 'A$1' },
    ])
  })

  it('rooms with no shop_items rows are absent from the result', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Empty Room', 'inside')").run()
    const result = collectShopItems(db)
    expect(result.has('r1')).toBe(false)
  })
})

describe('buildRoomRecords', () => {
  const testMaps = { 1: { name: 'Test City' } }

  it('includes a room with shop_items and computes its effective type', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Sword Shop', 'inside')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'iron sword', 'A$5')").run()
    const records = buildRoomRecords(db, testMaps, {})
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      room_id: 'r1', room_short: 'Sword Shop', map_id: 1, map_name: 'Test City',
      effectiveType: 'weapon', hasOverride: false, overrideType: null,
    })
    expect(records[0].items).toEqual([{ name: 'iron sword', price: 'A$5' }])
  })

  it('excludes rooms with no shop_items rows', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Empty Hall', 'inside')").run()
    const records = buildRoomRecords(db, testMaps, {})
    expect(records).toHaveLength(0)
  })

  it('reflects a room-types.json override on hasOverride/overrideType/effectiveType', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Sword Shop', 'inside')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'iron sword', 'A$5')").run()
    const records = buildRoomRecords(db, testMaps, { r1: 'crafts' })
    expect(records[0]).toMatchObject({ hasOverride: true, overrideType: 'crafts', effectiveType: 'crafts' })
  })

  it('includes a shop_items room classified as gather (e.g. a garden with only foraged items)', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'quiet garden', 'inside')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'carrot', 'gather')").run()
    const records = buildRoomRecords(db, testMaps, {})
    expect(records).toHaveLength(1)
    expect(records[0].effectiveType).toBe('gather')
  })

  it('sorts records by map name then room name', () => {
    const db = makeDb()
    const twoMaps = { 1: { name: 'B City' }, 2: { name: 'A City' } }
    db.prepare("INSERT INTO rooms VALUES ('r1', 1, 0, 0, 'Zed Shop', 'inside')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r1', 'thing', '1p')").run()
    db.prepare("INSERT INTO rooms VALUES ('r2', 2, 0, 0, 'Ann Shop', 'inside')").run()
    db.prepare("INSERT INTO shop_items VALUES ('r2', 'thing', '1p')").run()
    const records = buildRoomRecords(db, twoMaps, {})
    expect(records.map(r => r.room_short)).toEqual(['Ann Shop', 'Zed Shop'])
  })
})
