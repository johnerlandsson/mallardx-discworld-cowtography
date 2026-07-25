// tools/shop-room-editor/generate.mjs
// Generates a self-contained HTML tool for reviewing and manually setting
// room types for every shop room in the game.
// Usage: node tools/shop-room-editor/generate.mjs [--db /path/to/_quowmap_database.db] [--out /path/to/output.html]

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { queryShopTypes, TYPE_LETTERS } from '../../scripts/build-svg.mjs'
import { maps } from '../../ui/data/rooms.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_DB = path.join(REPO_ROOT, 'claude_resources', 'quow_cowbar', 'maps', '_quowmap_database.db')
const TYPES_CONFIG = path.join(REPO_ROOT, 'ui', 'data', 'room-types.json')
const DEFAULT_OUT = path.join(__dirname, 'output.html')

export function collectShopItems(db) {
  const rows = db.prepare('SELECT room_id, item_name, sale_price FROM shop_items').all()
  const byRoom = new Map()
  for (const { room_id, item_name, sale_price } of rows) {
    if (!byRoom.has(room_id)) byRoom.set(room_id, [])
    byRoom.get(room_id).push({ name: item_name, price: sale_price })
  }
  for (const items of byRoom.values()) {
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }
  return byRoom
}

export function buildRoomRecords(db, mapsById, roomTypesOverrides) {
  const shopItemsByRoom = collectShopItems(db)
  const roomById = new Map(
    db.prepare('SELECT room_id, room_short, map_id FROM rooms').all().map(r => [r.room_id, r])
  )

  const shopTypesByMap = new Map()
  for (const mapIdStr of Object.keys(mapsById)) {
    const mapId = Number(mapIdStr)
    shopTypesByMap.set(mapId, queryShopTypes(db, mapId, roomTypesOverrides))
  }

  const records = []
  for (const [roomId, items] of shopItemsByRoom) {
    const room = roomById.get(roomId)
    if (!room) continue
    const mapMeta = mapsById[String(room.map_id)]
    if (!mapMeta) continue
    const shopTypes = shopTypesByMap.get(room.map_id)
    records.push({
      room_id: roomId,
      room_short: room.room_short,
      map_id: room.map_id,
      map_name: mapMeta.name,
      items,
      effectiveType: shopTypes?.get(roomId) ?? null,
      hasOverride: Object.prototype.hasOwnProperty.call(roomTypesOverrides, roomId),
      overrideType: roomTypesOverrides[roomId] ?? null,
    })
  }

  records.sort((a, b) =>
    a.map_name.localeCompare(b.map_name) || a.room_short.localeCompare(b.room_short)
  )
  return records
}
