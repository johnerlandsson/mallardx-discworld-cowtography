// scripts/build-svg/shop-types.mjs
// Shop/room type classification: keyword-based shop_items matching, short-name
// pattern matching, and tavern/pub name overrides.

export const SHOP_KEYWORDS = {
  weapon:  ['sword', 'axe', 'dagger', 'crossbow', 'bolt', 'spear', 'mace', 'flail', 'whip', 'lance'],
  armour:  ['armour', 'armor', 'shield', 'helm', 'mail', 'chainmail', 'breastplate', 'gauntlet'],
  clothes: ['coat', 'cloak', 'robe', 'gown', 'jacket', 'dress', 'shirt', 'trouser', 'skirt', 'shoe', 'boot', 'hat', 'wig'],
  food:    ['cake', 'pie', 'bread', 'meat', 'ale', 'beer', 'wine', 'cheese', 'soup', 'stew'],
  access:  ['ring', 'bracelet', 'necklace', 'earring', 'gem', 'jewel', 'brooch', 'pendant'],
}

// `stationery` isn't a flat keyword list like the ones above — a room only
// qualifies once >=2 of these 4 categories are matched (see classifyShopItems
// below). Patterns are precise phrase/word-boundary matches, chosen against
// the live shop_items corpus to dodge collisions (wallpaper/sandpaper vs
// writing paper; bookcase/notebook/pattern book vs colour book) that made the
// `furniture` type manual-only.
const STATIONERY_COLOUR_RE = /\b(red|blue|green|yellow|purple|black|white|brown|grey|gray|pink|orange|silver|gold|violet|scarlet|crimson|indigo|turquoise|colour|color)\b/i

export const STATIONERY_CATEGORY_MATCHERS = {
  paper: (item) => /writing paper/i.test(item),
  quill: (item) => /\bquill/i.test(item),
  chalk: (item) => /stick of chalk/i.test(item),
  book:  (item) => /\bbook\b/i.test(item) && STATIONERY_COLOUR_RE.test(item),
}

export const TYPE_LETTERS = {
  shop: 'S', weapon: 'W', armour: 'A', clothes: 'C', food: 'F', access: 'X',
  furniture: 'U', stationery: 'Q',
  bank: '$', changer: '¢', mission: '!', post: 'O', lang: 'L', temple: 'R',
  crafts: 'K', house: 'H', club: 'G', pshop: 'P', tshop: 'T', talker: 'M',
  tavern: 'V',
  pub:    'B',
  gather: 'N',
}

const TAVERN_NAME_KEYWORDS   = ['restaurant', 'tavern', 'pizzeria', 'pizza', 'cafe', 'café']
const PUB_NAME_RE            = /\b(?:pub|bar)\b/
const TAVERN_NAME_EXCLUSIONS = ['outside', ' by ']

function classifyShopItems(items) {
  const counts = {}
  for (const item of items) {
    const lower = item.toLowerCase()
    for (const [type, keywords] of Object.entries(SHOP_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        counts[type] = (counts[type] ?? 0) + 1
        break
      }
    }
  }

  const stationeryCats = new Set()
  let stationeryCount = 0
  for (const item of items) {
    for (const [category, matches] of Object.entries(STATIONERY_CATEGORY_MATCHERS)) {
      if (matches(item)) { stationeryCats.add(category); stationeryCount++; break }
    }
  }
  if (stationeryCats.size >= 2) counts.stationery = stationeryCount

  let winner = 'shop'
  let best = 0
  for (const [type, count] of Object.entries(counts)) {
    if (count > best) { best = count; winner = type }
    else if (count === best) { winner = 'shop' }
  }
  return winner
}

export function queryShopTypes(db, mapId, overrides = {}) {
  const rows = db.prepare(`
    SELECT si.room_id, si.item_name, si.sale_price
    FROM shop_items si
    JOIN rooms r ON si.room_id = r.room_id
    WHERE r.map_id = ?
  `).all(mapId)

  const roomItems = new Map()
  for (const { room_id, item_name, sale_price } of rows) {
    if (!roomItems.has(room_id)) roomItems.set(room_id, [])
    roomItems.get(room_id).push({ name: item_name, price: sale_price })
  }

  const result = new Map()
  for (const [roomId, items] of roomItems) {
    if (items.every(item => item.price === 'gather')) {
      result.set(roomId, 'gather')
    } else {
      result.set(roomId, classifyShopItems(items.map(item => item.name)))
    }
  }

  const shortTypePatterns = [
    ['%[player house]%',  'house'],
    ['%[player shop]%',   'pshop'],
    ['%[player club]%',   'club'],
    ['%Bing%bank%',       'bank'],
    ['%Coop%bank%',       'bank'],
  ]
  const shortStmt = db.prepare(
    `SELECT room_id FROM rooms WHERE map_id = ? AND room_short LIKE ? COLLATE NOCASE`
  )
  for (const [pattern, type] of shortTypePatterns) {
    for (const { room_id } of shortStmt.all(mapId, pattern)) {
      if (!result.has(room_id)) result.set(room_id, type)
    }
  }

  // Tavern name matching — overrides shop_items food/shop classification.
  const allMapRooms = db.prepare('SELECT room_id, room_short FROM rooms WHERE map_id = ?').all(mapId)
  for (const { room_id, room_short } of allMapRooms) {
    const lower = (room_short ?? '').toLowerCase()
    if (!TAVERN_NAME_EXCLUSIONS.some(ex => lower.includes(ex))) {
      if (PUB_NAME_RE.test(lower))                                  result.set(room_id, 'pub')
      else if (TAVERN_NAME_KEYWORDS.some(kw => lower.includes(kw))) result.set(room_id, 'tavern')
    }
  }

  for (const [roomId, type] of Object.entries(overrides)) {
    if (!TYPE_LETTERS[type]) {
      console.warn(`[build-svg] room-types.json: unknown type "${type}" for room ${roomId}, skipping`)
      continue
    }
    result.set(roomId, type)
  }
  return result
}
