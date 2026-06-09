import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { queryRooms, queryExits, edgeId } from './build-svg.mjs'

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
