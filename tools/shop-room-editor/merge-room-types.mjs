// tools/shop-room-editor/merge-room-types.mjs
// Pure functions for merging manual room-type overrides into room-types.json.
// This file is also inlined verbatim (with `export ` stripped) into the
// generated output.html by generate.mjs — keep it free of Node-only APIs.

export function applyRoomTypeChanges(original, changes) {
  const result = { ...original }
  for (const [roomId, value] of Object.entries(changes)) {
    if (value === null) {
      delete result[roomId]
    } else {
      result[roomId] = value
    }
  }
  return result
}

export function serializeRoomTypes(obj) {
  return JSON.stringify(obj, null, 2) + '\n'
}
