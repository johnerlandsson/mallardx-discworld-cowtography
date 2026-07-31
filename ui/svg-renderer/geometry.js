export function computeRoomUnit(svgEl) {
  const pts = [];
  for (const el of svgEl.querySelectorAll('.room')) {
    if (el.hasAttribute('cx')) {
      pts.push([+el.getAttribute('cx'), +el.getAttribute('cy')]);
    } else {
      const x = +el.getAttribute('x'), w = +el.getAttribute('width');
      pts.push([x + w / 2, +el.getAttribute('y') + w / 2]);
    }
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
  dists.sort((a, b) => a - b);
  return dists[Math.floor(dists.length / 2)];
}

export function ensureWarpDefs(svgEl) {
  if (svgEl.querySelector('#warp-arrow')) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML =
    '<marker id="warp-arrow" viewBox="0 0 6 6" markerWidth="6.48" markerHeight="6.48"' +
    ' refX="6" refY="3" orient="auto-start-reverse" markerUnits="userSpaceOnUse">' +
    '<path d="M0,0 L6,3 L0,6 Z" fill="#a855f7"/></marker>';
  svgEl.prepend(defs);
}

export function roomFromElement(el) {
  if (!el || typeof el.id !== 'string') return null;
  const roomId = el.id.slice(5);
  if (!roomId) return null;
  return { roomId, name: el.dataset?.label ?? "" };
}
