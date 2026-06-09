import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { generateRoomsLua } from './build-db.mjs'

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
