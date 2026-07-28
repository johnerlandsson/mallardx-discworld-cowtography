import { LIB_ORB_RADIUS } from "./constants.js";

// Three points of the facing-direction chevron, centered on (cx, cy).
export function libraryArrowPoints(cx, cy, facing, r, w) {
  switch (facing) {
    case 'n': return [[cx - w, cy - r + w], [cx, cy - r], [cx + w, cy - r + w]];
    case 's': return [[cx - w, cy + r - w], [cx, cy + r], [cx + w, cy + r - w]];
    case 'e': return [[cx + r - w, cy - w], [cx + r, cy], [cx + r - w, cy + w]];
    case 'w': return [[cx - r + w, cy - w], [cx - r, cy], [cx - r + w, cy + w]];
    default:  return null;
  }
}

// [x, y, width, height] of the distortion band on the given wall of the current cell.
export function libraryDistortionRect(cx, cy, dir, half, bw, bh) {
  switch (dir) {
    case 'n': return [cx - bw / 2, cy - half - bh, bw, bh];
    case 's': return [cx - bw / 2, cy + half, bw, bh];
    case 'e': return [cx + half, cy - bw / 2, bh, bw];
    case 'w': return [cx - half - bh, cy - bw / 2, bh, bw];
    default:  return null;
  }
}

export function drawLibraryOverlay(ctx, cx, cy, s, { distortion, orb, facing }) {
  if (distortion) {
    const rect = libraryDistortionRect(cx, cy, distortion, 15 * s, 20 * s, 3 * s);
    if (rect) {
      ctx.fillStyle = "rgba(220, 20, 20, 0.9)";
      ctx.fillRect(...rect);
    }
  }
  if (orb) {
    ctx.beginPath();
    ctx.arc(cx, cy, (LIB_ORB_RADIUS[orb] ?? 7) * s, 0, Math.PI * 2);
    ctx.fillStyle   = "rgba(255, 140, 0, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth   = 1.5 * s;
    ctx.stroke();
  }
  if (facing) {
    const pts = libraryArrowPoints(cx, cy, facing, 12 * s, 5 * s);
    if (pts) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineTo(pts[2][0], pts[2][1]);
      ctx.strokeStyle = "rgba(255, 210, 60, 1)";
      ctx.lineWidth   = 2.5 * s;
      ctx.lineJoin    = "round";
      ctx.stroke();
    }
  }
}
