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
 * The raw hub/scale projection is coarse (one pixel per huge real-distance
 * step), so a `shift` — calibrated via computeTerrainShift() the last time a
 * *known* room reported terrain coordinates — is added before clamping. This
 * keeps unmapped terrain rooms tracking near the road you left instead of
 * snapping to the raw projection's absolute grid. Mirrors QuowMinimap.xml's
 * iTerrainShiftX/Y (~lines 8043–8046, 8165–8168).
 *
 * @param {{x:number, y:number}} [shift]
 * @returns {{ mapId:number, x:number, y:number }}
 */
export function terrainPosition(terrain, tx, ty, shift = { x: 0, y: 0 }) {
  let x = terrain.hubX + Math.floor(tx / terrain.scaleX) + shift.x;
  let y = terrain.hubY - Math.floor(ty / terrain.scaleY) + shift.y;

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
 * Calibrates the terrain-projection shift: how far the raw hub/scale formula
 * is from a room's actual (known, DB-assigned) pixel position. Call this
 * whenever a *recognized* room also reports terrain tx/ty, and feed the
 * result into terrainPosition() for subsequent unrecognized terrain rooms.
 * Mirrors QuowMinimap.xml ~lines 8043–8046.
 *
 * @returns {{x:number, y:number}}
 */
export function computeTerrainShift(terrain, tx, ty, knownX, knownY) {
  const rawX = terrain.hubX + Math.floor(tx / terrain.scaleX);
  const rawY = terrain.hubY - Math.floor(ty / terrain.scaleY);
  return { x: knownX - rawX, y: knownY - rawY };
}

/**
 * Combined entry: DB hit → DB position; terrain==1 → procedural; else null.
 *
 * @param {{ rooms:Object, terrain:Object, maps:Object }} data
 * @param {{ identifier?:string, terrain?:number, tx?:number, ty?:number }} frame
 * @param {{x:number, y:number}} [shift] Calibration from the last known+terrain room; see computeTerrainShift().
 */
export function resolveRoom(data, frame, shift) {
  if (!frame) return null;
  const hit = lookupRoom(data.rooms, frame.identifier);
  if (hit) return hit;
  if (frame.terrain === 1 && typeof frame.tx === "number" && typeof frame.ty === "number") {
    const t = terrainPosition(data.terrain, frame.tx, frame.ty, shift);
    return { ...t, short: null };
  }
  return null;
}
