import { ORB_RADIUS } from "./constants.js";

export function applyLibraryOverlay(svg, current, libraryOverlay) {
  const cx = current.x, cy = current.y, half = 15;
  const distEl = svg.querySelector("#lib-distortion");
  const orbEl  = svg.querySelector("#lib-orb");
  const arrEl  = svg.querySelector("#lib-arrow");
  if (!distEl || !orbEl || !arrEl) return;
  if (libraryOverlay?.distortion) {
    const dir = libraryOverlay.distortion;
    const bw = 20, bh = 3;
    const [x, y, w, h] =
      dir === 'n' ? [cx - bw/2, cy - half - bh, bw, bh] :
      dir === 's' ? [cx - bw/2, cy + half,       bw, bh] :
      dir === 'e' ? [cx + half, cy - bw/2,        bh, bw] :
                    [cx - half - bh, cy - bw/2,   bh, bw];
    distEl.setAttribute("x", x); distEl.setAttribute("y", y);
    distEl.setAttribute("width", w); distEl.setAttribute("height", h);
    distEl.setAttribute("visibility", "visible");
  } else {
    distEl.setAttribute("visibility", "hidden");
  }
  if (libraryOverlay?.orb) {
    orbEl.setAttribute("cx", cx); orbEl.setAttribute("cy", cy);
    orbEl.setAttribute("r",  ORB_RADIUS[libraryOverlay.orb] ?? 7);
    orbEl.setAttribute("visibility", "visible");
  } else {
    orbEl.setAttribute("visibility", "hidden");
  }
  if (libraryOverlay?.facing) {
    const f = libraryOverlay.facing, r = 12, w = 5;
    const d =
      f === 'n' ? `M ${cx-w} ${cy-r+w} L ${cx} ${cy-r} L ${cx+w} ${cy-r+w}` :
      f === 's' ? `M ${cx-w} ${cy+r-w} L ${cx} ${cy+r} L ${cx+w} ${cy+r-w}` :
      f === 'e' ? `M ${cx+r-w} ${cy-w} L ${cx+r} ${cy} L ${cx+r-w} ${cy+w}` :
                  `M ${cx-r+w} ${cy-w} L ${cx-r} ${cy} L ${cx-r+w} ${cy+w}`;
    arrEl.setAttribute("d", d);
    arrEl.setAttribute("visibility", "visible");
  } else {
    arrEl.setAttribute("visibility", "hidden");
  }
}
