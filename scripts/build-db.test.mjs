import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { generateMapsLua, assertSingleFileSeed, copySeedDb } from './build-db.mjs'

const TEST_MAPS = {
  1: { name: 'Ankh-Morpork', file: 'am.png', region: 'AM', maxX: 1354, maxY: 1256, topLevel: true },
  27: { name: 'Genua', file: 'genua.png', region: 'Genua', maxX: 839, maxY: 560, topLevel: true },
}

describe('generateMapsLua', () => {
  it('maps map_id to map name, using string keys', () => {
    const lua = generateMapsLua(TEST_MAPS)
    expect(lua).toContain("['1'] = 'Ankh-Morpork'")
    expect(lua).toContain("['27'] = 'Genua'")
  })

  it('escapes single quotes in map names', () => {
    const lua = generateMapsLua({ 1: { name: "Dragon's Den" } })
    expect(lua).toContain("Dragon\\'s Den")
  })

  it('starts with auto-generated comment and return {', () => {
    const lua = generateMapsLua(TEST_MAPS)
    expect(lua).toMatch(/^-- Auto-generated/)
    expect(lua).toContain('return {')
  })

  it('ends with }', () => {
    const lua = generateMapsLua(TEST_MAPS)
    expect(lua.trim()).toMatch(/\}$/)
  })
})

describe('assertSingleFileSeed', () => {
  it('accepts the default rollback-journal mode', () => {
    const db = new Database(':memory:')
    expect(() => assertSingleFileSeed(db)).not.toThrow()
    db.close()
  })

  it('rejects WAL mode', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cowtography-seed-test-'))
    const dbPath = path.join(dir, 'wal.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    expect(() => assertSingleFileSeed(db)).toThrow(/WAL/)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('copySeedDb', () => {
  it('copies the source file verbatim to destDir/_quowmap_database.db', async () => {
    const srcDir = mkdtempSync(path.join(os.tmpdir(), 'cowtography-seed-src-'))
    const destDir = mkdtempSync(path.join(os.tmpdir(), 'cowtography-seed-dest-'))
    const srcPath = path.join(srcDir, 'source.db')
    await fs.writeFile(srcPath, 'fake db bytes')

    const destPath = await copySeedDb(srcPath, destDir)

    expect(destPath).toBe(path.join(destDir, '_quowmap_database.db'))
    expect(await fs.readFile(destPath, 'utf8')).toBe('fake db bytes')

    rmSync(srcDir, { recursive: true, force: true })
    rmSync(destDir, { recursive: true, force: true })
  })
})
