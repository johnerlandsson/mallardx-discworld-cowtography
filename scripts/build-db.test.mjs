import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { generateRoomsLua, generateItemsLua, generateNpcsLua, generateNpcItemsLua } from './build-db.mjs'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      map_id INTEGER NOT NULL,
      xpos INTEGER NOT NULL,
      ypos INTEGER NOT NULL,
      room_short TEXT NOT NULL,
      room_type TEXT NOT NULL
    )
  `)
  return db
}

describe('generateRoomsLua', () => {
  it('returns a Lua table mapping room_id to room_short', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('abc123','1','100','200','The Drum','inside')").run()
    const lua = generateRoomsLua(db)
    expect(lua).toContain("['abc123'] = 'The Drum'")
  })

  it('escapes single quotes in room names', () => {
    const db = makeDb()
    db.prepare("INSERT INTO rooms VALUES ('r1','1','0','0','Assassin''s Guild','inside')").run()
    const lua = generateRoomsLua(db)
    expect(lua).toContain("Assassin\\'s Guild")
  })

  it('starts with auto-generated comment and return {', () => {
    const db = makeDb()
    const lua = generateRoomsLua(db)
    expect(lua).toMatch(/^-- Auto-generated/)
    expect(lua).toContain('return {')
  })

  it('ends with }', () => {
    const db = makeDb()
    const lua = generateRoomsLua(db)
    expect(lua.trim()).toMatch(/\}$/)
  })
})

function makeFullDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY, map_id INTEGER NOT NULL,
      xpos INTEGER NOT NULL, ypos INTEGER NOT NULL,
      room_short TEXT NOT NULL, room_type TEXT NOT NULL
    );
    CREATE TABLE shop_items (
      room_id TEXT NOT NULL, item_name TEXT NOT NULL, sale_price TEXT NOT NULL
    );
    CREATE TABLE npc_info (
      npc_id TEXT PRIMARY KEY, map_id INTEGER NOT NULL,
      npc_name TEXT NOT NULL, room_id TEXT NOT NULL
    );
    CREATE TABLE npc_items (
      npc_id TEXT NOT NULL, item_name TEXT NOT NULL, sale_price TEXT NOT NULL
    );
  `)
  db.prepare("INSERT INTO rooms VALUES ('r1',1,0,0,'weapon shop','inside')").run()
  db.prepare("INSERT INTO rooms VALUES ('r2',1,0,0,'market square','outside')").run()
  db.prepare("INSERT INTO shop_items VALUES ('r1','long sword','A\\$180')").run()
  db.prepare("INSERT INTO npc_info VALUES ('npc1',1,'city guard','r2')").run()
  db.prepare("INSERT INTO npc_items VALUES ('npc1','dagger','')").run()
  return db
}

describe('generateItemsLua', () => {
  it('includes item name, room_id, location and price', () => {
    const db = makeFullDb()
    const lua = generateItemsLua(db)
    expect(lua).toContain("name = 'long sword'")
    expect(lua).toContain("room_id = 'r1'")
    expect(lua).toContain("location = 'weapon shop'")
    expect(lua).toContain("price = 'A\\\\$180'")
  })

  it('is a valid Lua array literal', () => {
    const db = makeFullDb()
    const lua = generateItemsLua(db)
    expect(lua).toContain('return {')
    expect(lua.trim()).toMatch(/\}$/)
  })
})

describe('generateNpcsLua', () => {
  it('includes npc name, room_id and location', () => {
    const db = makeFullDb()
    const lua = generateNpcsLua(db)
    expect(lua).toContain("name = 'city guard'")
    expect(lua).toContain("room_id = 'r2'")
    expect(lua).toContain("location = 'market square'")
  })
})

describe('generateNpcItemsLua', () => {
  it('includes item name, npc name, room_id, location and price', () => {
    const db = makeFullDb()
    const lua = generateNpcItemsLua(db)
    expect(lua).toContain("name = 'dagger'")
    expect(lua).toContain("npc = 'city guard'")
    expect(lua).toContain("room_id = 'r2'")
    expect(lua).toContain("location = 'market square'")
  })
})
