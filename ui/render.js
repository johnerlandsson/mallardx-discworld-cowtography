// Pure render helpers — no DOM, no canvas operations.
// All canvas drawing happens in mapper.js; this module just computes the values.

/**
 * Decide whether the PNG tile needs to swap (current vs. next resolved room).
 * Treats null on either side as "different from any known mapId".
 */
export function mapDidChange(prev, next) {
  const a = prev?.mapId ?? null;
  const b = next?.mapId ?? null;
  return a !== b;
}

/**
 * Build the slim-header text. Known room → "<map name> — <short>";
 * terrain-resolved with no short → "<map name>"; null → "Unknown location".
 */
export function headerText(maps, resolved) {
  if (!resolved) return "Unknown location";
  const map = maps[resolved.mapId];
  const mapName = map?.name ?? `Map ${resolved.mapId}`;
  if (resolved.short) return `${mapName} — ${resolved.short}`;
  return mapName;
}

/**
 * Compute pixel-space marker position given:
 *   - image:   the loaded <img> (naturalWidth/naturalHeight)
 *   - resolved: the resolved room { x, y } (data-space)
 *   - mapMeta:  the map block { maxX, maxY } (declared data-space extent)
 *
 * Scales resolved coords to the image's natural size, then clamps to image bounds.
 */
export function markerPixel(image, resolved, mapMeta) {
  const sx = image.naturalWidth / mapMeta.maxX;
  const sy = image.naturalHeight / mapMeta.maxY;
  let px = Math.round(resolved.x * sx);
  let py = Math.round(resolved.y * sy);
  if (px < 0) px = 0; else if (px > image.naturalWidth)  px = image.naturalWidth;
  if (py < 0) py = 0; else if (py > image.naturalHeight) py = image.naturalHeight;
  return { px, py };
}
