// Pure render helpers — no DOM, no canvas operations.

export function mapDidChange(prev, next) {
  const a = prev?.mapId ?? null;
  const b = next?.mapId ?? null;
  return a !== b;
}

export function headerText(maps, resolved) {
  if (!resolved) return "Unknown location";
  const map     = maps[resolved.mapId];
  const mapName = map?.name ?? `Map ${resolved.mapId}`;
  if (resolved.short) return `${mapName} — ${resolved.short}`;
  return mapName;
}
