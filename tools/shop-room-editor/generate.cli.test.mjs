import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(__dirname, 'generate.mjs')

let tmpDir

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('generate.mjs CLI', () => {
  it('writes an output.html embedding the fixture room and the inlined merge functions', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shop-room-editor-'))
    const dbPath = path.join(tmpDir, 'fixture.db')
    const outPath = path.join(tmpDir, 'output.html')

    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE rooms (
        room_id TEXT PRIMARY KEY, map_id INTEGER NOT NULL, xpos INTEGER NOT NULL,
        ypos INTEGER NOT NULL, room_short TEXT NOT NULL, room_type TEXT NOT NULL DEFAULT 'outside'
      );
      CREATE TABLE shop_items (
        room_id TEXT NOT NULL, item_name TEXT NOT NULL, sale_price TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (room_id, item_name)
      );
    `)
    db.prepare("INSERT INTO rooms VALUES ('fixture-room-1', 1, 0, 0, 'Fixture Sword Shop', 'inside')").run()
    db.prepare("INSERT INTO shop_items VALUES ('fixture-room-1', 'iron sword', 'A$5')").run()
    db.close()

    execFileSync('node', [SCRIPT, '--db', dbPath, '--out', outPath], { stdio: 'pipe' })

    const html = await fs.readFile(outPath, 'utf8')
    expect(html).toContain('Fixture Sword Shop')
    expect(html).toContain('"effectiveType":"weapon"')
    expect(html).toContain('function applyRoomTypeChanges')
    expect(html).not.toContain('export function applyRoomTypeChanges')
    expect(html).not.toContain('__SHOP_ROOM_DATA__')
    expect(html).not.toContain('__MERGE_MODULE__')
  })
})
