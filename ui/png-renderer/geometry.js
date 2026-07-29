import { PNG_CLICK_THRESHOLD } from "./constants.js";

export function findNearestRoom(rooms, mapId, px, py) {
  let bestId = null, bestDist = Infinity;
  for (const [id, room] of Object.entries(rooms)) {
    if (room[0] !== mapId) continue;
    const d = Math.hypot(px - room[1], py - room[2]);
    if (d < bestDist) { bestDist = d; bestId = id; }
  }
  return bestDist <= PNG_CLICK_THRESHOLD ? bestId : null;
}

export function computeRoomUnit(rooms, mapId) {
  const pts = [];
  for (const room of Object.values(rooms)) {
    if (room[0] === mapId) pts.push([room[1], room[2]]);
  }
  if (pts.length < 2) return null;
  pts.sort((a, b) => a[0] - b[0]);
  const dists = [];
  for (let i = 0; i < pts.length; i++) {
    let best = Infinity;
    for (let j = i - 1; j >= 0 && pts[i][0] - pts[j][0] < best; j--) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < best) best = d;
    }
    for (let j = i + 1; j < pts.length && pts[j][0] - pts[i][0] < best; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < best) best = d;
    }
    if (best < Infinity) dists.push(best);
  }
  if (!dists.length) return null;
  dists.sort((a, b) => a - b);
  return dists[Math.floor(dists.length / 2)];
}
