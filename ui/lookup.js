// Pure lookup + terrain math. No DOM, no canvas, no fetch.
// Tested in lookup.test.js.

/**
 * @param {Object<string, [number, number, number, string]>} rooms
 * @param {string|null|undefined} identifier
 * @returns {{ mapId:number, x:number, y:number, short:string } | null}
 */
export function lookupRoom(rooms, identifier) {
  if (identifier == null) return null;
  const row = rooms[identifier];
  if (!row) return null;
  return { mapId: row[0], x: row[1], y: row[2], short: row[3] };
}

/**
 * Quow's procedural terrain position formula. Applied when room.info reports
 * terrain==1 and the identifier isn't in the rooms dictionary.
 *
 * @returns {{ mapId:number, x:number, y:number }}
 */
export function terrainPosition(terrain, tx, ty) {
  let x = terrain.hubX + Math.floor(tx / terrain.scaleX);
  let y = terrain.hubY - Math.floor(ty / terrain.scaleY);

  // Six-case clamp ladder, copied from QuowMinimap.xml lines ~8170–8174.
  // Order matters — Quow uses `elseif`; we mirror that with `else if`.
  if (x < 0) x = 0;
  else if (x > 5809) x = 5809;
  if (y > 5000) y = 5000;
  else if (y < 2800 && x < 1600) y = 2800;
  else if (y < 3200 && x >= 1600 && x < 3400) y = 3200;
  else if (y < 0 && x >= 3400) y = 0;

  return { mapId: terrain.viewportMapId, x, y };
}

/**
 * Combined entry: DB hit → DB position; terrain==1 → procedural; else null.
 *
 * @param {{ rooms:Object, terrain:Object, maps:Object }} data
 * @param {{ identifier?:string, terrain?:number, tx?:number, ty?:number }} frame
 */
export function resolveRoom(data, frame) {
  if (!frame) return null;
  const hit = lookupRoom(data.rooms, frame.identifier);
  if (hit) return hit;
  if (frame.terrain === 1 && typeof frame.tx === "number" && typeof frame.ty === "number") {
    const t = terrainPosition(data.terrain, frame.tx, frame.ty);
    return { ...t, short: null };
  }
  return null;
}
