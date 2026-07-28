// scripts/build-svg/water.mjs
// Water room detection by name pattern, DB room_type, or explicit override.

const WATER_NAME_PATTERNS = [
  // River Ankh — surface and under-pier rooms (map 5)
  // am_docks bridge undersides and other edge cases are handled by room-water.json
  /^surface of the river ankh$/i,
  /^under a pier$/i,
  // Pearl River and Tuna Bay (map 17)
  /^pearl river\b/i,
  /^somewhere along pearl river$/i,
  /^east end of the pearl river$/i,
  /^the west end of pearl river$/i,
  /^surface of tuna bay\b/i,
  /^middle of tuna bay\b/i,
  /^choppy surface of the bay\b/i,
  /^beside the piers$/i,
  /^near the end of the piers$/i,
  /^underneath the piers$/i,
  // Sea rooms (map 21)
  /^sea (between|just north|just west)\b/i,
  // Djelibeybi river Djel (map 23)
  /^river djel($| as it)/i,
  /^small section of the river djel$/i,
  // Cave streams (map 29)
  /^flowing stream\b/i,
  /^cave filled with water$/i,
  /^stream$/i,
  // Overworld (map 99)
  /^sea$/i,
  /^swamp$/i,
  /^dense marshland\b/i,
  // Misc
  /^lake$/i,
  /^surface of a pool$/i,
  /^heart of the swamp$/i,
  /^river near slippery hollow$/i,
]

export function isWaterRoom(room, overrideIds = new Set()) {
  if (overrideIds.has(room.id)) return true
  if (room.roomType === 'underwater') return true
  const name = room.short ?? ''
  return WATER_NAME_PATTERNS.some(p => p.test(name))
}
