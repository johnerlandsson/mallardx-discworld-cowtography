// scripts/find-bridge-candidates.mjs
// Read-only helper: scans ui/data/rooms.js for room names that look like the
// physical span of a named bridge, and prints any not already listed in
// ui/data/room-bridge.json. Never writes room-bridge.json itself — that file
// is exclusively hand-maintained; copy in whatever candidates you agree with.
// Usage: node scripts/find-bridge-candidates.mjs

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rooms } from '../ui/data/rooms.js'

const __dirname     = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT     = path.resolve(__dirname, '..')
const BRIDGE_CONFIG = path.join(REPO_ROOT, 'ui', 'data', 'room-bridge.json')

// Matches room names that read as "you are standing on the bridge span itself".
const BRIDGE_INCLUDE_PATTERNS = [
  /\bbridge$/i,
  /^(?:the )?(?:middle|centre|center) of (?:the )?.*\bbridge\b/i,
  /^(?:the )?(?:north|south|east|west|northeast|southeast|northwest|southwest) end of (?:the )?.*\bbridge\b/i,
  /^section of .*\bbridge\b/i,
  /\bbridge (?:over|spanning|between)\b/i,
]

// Excludes names that would otherwise match but aren't the span itself.
const BRIDGE_EXCLUDE_PATTERNS = [
  /\bunder(?:neath)?\b/i,
  /^junction\b/i,
]

export function isBridgeCandidate(name) {
  if (!name) return false
  if (BRIDGE_EXCLUDE_PATTERNS.some(p => p.test(name))) return false
  return BRIDGE_INCLUDE_PATTERNS.some(p => p.test(name))
}

async function main() {
  let existing = new Set()
  try { existing = new Set(JSON.parse(await fs.readFile(BRIDGE_CONFIG, 'utf8'))) } catch {}

  const candidates = []
  for (const [id, [mapId, , , short]] of Object.entries(rooms)) {
    if (existing.has(id)) continue
    if (isBridgeCandidate(short)) candidates.push({ id, mapId, short })
  }

  if (candidates.length === 0) {
    console.log('[find-bridge-candidates] No new bridge candidates found.')
    return
  }

  console.log(`[find-bridge-candidates] ${candidates.length} new candidate(s) not in room-bridge.json:\n`)
  for (const { id, mapId, short } of candidates) {
    console.log(`  ${id}  map ${mapId}  "${short}"`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`[find-bridge-candidates] FAILED: ${e.message}`); process.exit(1) })
}
