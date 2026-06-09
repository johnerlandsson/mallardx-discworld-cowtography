// Iframe glue. Imports data + helpers, wires up canvas rendering, subscribes
// to host messages. `panel` is the global injected by Mallard's SDK shim
// (see Plan #8 inject.rs); CSP forbids fetch/XHR/WebSocket so all data is
// import-time-loaded.

import { rooms, maps, terrain } from "./data/rooms.js";
import { resolveRoom } from "./lookup.js";
import { mapDidChange, headerText, markerPixel } from "./render.js";

const data = { rooms, maps, terrain };

// ─── DOM refs ─────────────────────────────────────────────────────────────
const $mapName = document.querySelector(".map-name");
const $canvas  = document.querySelector(".map-canvas");
const $lspace  = document.querySelector(".lspace-overlay");
const $tooltip = document.querySelector(".tooltip");
const $zoomIn  = document.querySelector(".zoom-in");
const $zoomOut = document.querySelector(".zoom-out");
const ctx = $canvas.getContext("2d");

// ─── State ────────────────────────────────────────────────────────────────
let current = null;          // resolved room: { mapId, x, y, short } | null
let currentImage = null;     // HTMLImageElement currently loaded
let currentRoomsForMap = []; // [{ id, x, y, short }] for hover tooltip
const ZOOMS = [0.75, 1.0, 1.5];
let zoomIdx = 1;
let routeRoomIds = [];       // ordered room IDs for current route highlight
let libraryOverlay = null;   // { facing, distortion, orb } from Lua
let lastKnownMapId = null;   // for L-space detection (null → was on map 47 → L-space)

// ─── Image loading ────────────────────────────────────────────────────────
function swapImage(next) {
  if (!next) { currentImage = null; currentRoomsForMap = []; return; }
  const meta = data.maps[next.mapId];
  if (!meta) { currentImage = null; currentRoomsForMap = []; return; }
  const img = new Image();
  // Tentative bind so a later swap can supersede us before onload fires.
  currentImage = img;
  img.onload = () => {
    // Race guard: if a newer swap happened while we were loading, bail.
    if (currentImage !== img) return;
    indexRoomsForMap(next.mapId);
    redraw();
  };
  img.src = `maps/${meta.file}`;
  $canvas.classList.remove("dimmed");
}

function indexRoomsForMap(mapId) {
  // Build the per-map list of rooms once per swap; used by the hover tooltip.
  currentRoomsForMap = [];
  for (const id of Object.keys(data.rooms)) {
    const r = data.rooms[id];
    if (r[0] === mapId) {
      currentRoomsForMap.push({ id, x: r[1], y: r[2], short: r[3] });
    }
  }
}

// ─── UU Library drawing helpers ───────────────────────────────────────────

// Directional arrow (chevron) showing which way the player is facing.
function drawFacingArrow(cx, cy, facing, zoom) {
  const r = 12 * zoom;   // distance from centre
  const w = 5  * zoom;   // wing spread
  ctx.beginPath();
  if (facing === 'n') {
    ctx.moveTo(cx - w, cy - r + w);
    ctx.lineTo(cx,     cy - r);
    ctx.lineTo(cx + w, cy - r + w);
  } else if (facing === 's') {
    ctx.moveTo(cx - w, cy + r - w);
    ctx.lineTo(cx,     cy + r);
    ctx.lineTo(cx + w, cy + r - w);
  } else if (facing === 'e') {
    ctx.moveTo(cx + r - w, cy - w);
    ctx.lineTo(cx + r,     cy);
    ctx.lineTo(cx + r - w, cy + w);
  } else if (facing === 'w') {
    ctx.moveTo(cx - r + w, cy - w);
    ctx.lineTo(cx - r,     cy);
    ctx.lineTo(cx - r + w, cy + w);
  }
  ctx.lineJoin = "round";
  // Dark outline first so the chevron reads on both light and dark map tiles.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.lineWidth = 5 * zoom;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 210, 60, 1)";
  ctx.lineWidth = 2.5 * zoom;
  ctx.stroke();
}

// Red bar across one edge of the current room showing a distortion direction.
function drawDistortionBar(cx, cy, dir, zoom) {
  const half = 10 * zoom;  // half-width of bar along the edge
  const thick = 4 * zoom;  // bar thickness (into the room)
  ctx.fillStyle = "rgba(220, 20, 20, 0.9)";
  if      (dir === 'n') ctx.fillRect(cx - half, cy - half - thick, half * 2, thick);
  else if (dir === 's') ctx.fillRect(cx - half, cy + half,         half * 2, thick);
  else if (dir === 'e') ctx.fillRect(cx + half,         cy - half, thick, half * 2);
  else if (dir === 'w') ctx.fillRect(cx - half - thick, cy - half, thick, half * 2);
}

const ORB_RADIUS = {
  "tiny speck":          3,
  "small point":         5,
  "moderately-sized ball": 7,
  "large orb":           9,
  "substantial sphere":  12,
};

// Filled orange circle sized by spell strength; dark outline for visibility on white.
function drawOrb(cx, cy, sizeName, zoom) {
  const r = (ORB_RADIUS[sizeName] ?? 7) * zoom;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 140, 0, 0.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.lineWidth = 1.5 * zoom;
  ctx.stroke();
}


// ─── Drawing ──────────────────────────────────────────────────────────────
function redraw() {
  // Size canvas's drawing buffer to its CSS size (handles resize).
  const cw = $canvas.clientWidth;
  const ch = $canvas.clientHeight;
  if ($canvas.width !== cw) $canvas.width = cw;
  if ($canvas.height !== ch) $canvas.height = ch;

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, cw, ch);

  const inLSpace = current === null && lastKnownMapId === 47;
  $lspace.hidden = !inLSpace;

  if (inLSpace) {
    $mapName.textContent = "L-space";
    return;
  }

  if (!currentImage || !currentImage.complete || currentImage.naturalWidth === 0) {
    $mapName.textContent = headerText(data.maps, current);
    return;
  }

  const meta = data.maps[current?.mapId];
  const zoom = ZOOMS[zoomIdx];
  const drawW = currentImage.naturalWidth * zoom;
  const drawH = currentImage.naturalHeight * zoom;

  // Center the marker in the viewport.
  let offsetX = 0, offsetY = 0;
  if (current && meta) {
    const { px, py } = markerPixel(currentImage, current, meta);
    offsetX = cw / 2 - px * zoom;
    offsetY = ch / 2 - py * zoom;
  } else {
    // Unknown room: center the map default.
    offsetX = cw / 2 - drawW / 2;
    offsetY = ch / 2 - drawH / 2;
  }

  ctx.drawImage(currentImage, offsetX, offsetY, drawW, drawH);

  // Route highlight — draw before the position marker so it sits underneath.
  if (routeRoomIds.length > 0 && meta) {
    for (const id of routeRoomIds) {
      const r = data.rooms[id];
      if (!r || r[0] !== current?.mapId) continue;
      const { px, py } = markerPixel(currentImage, { x: r[1], y: r[2] }, meta);
      const rx = offsetX + px * zoom;
      const ry = offsetY + py * zoom;
      ctx.beginPath();
      ctx.arc(rx, ry, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 210, 255, 0.8)";
      ctx.fill();
    }
  }

  if (current && meta) {
    const { px, py } = markerPixel(currentImage, current, meta);
    const mx = offsetX + px * zoom;
    const my = offsetY + py * zoom;

    // UU Library: distortion bar and orb ring — drawn before position marker.
    if (current.mapId === 47 && libraryOverlay) {
      if (libraryOverlay.distortion) drawDistortionBar(mx, my, libraryOverlay.distortion, zoom);
      if (libraryOverlay.orb)        drawOrb(mx, my, libraryOverlay.orb, zoom);
    }

    // Position marker.
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ff3b30";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();

    // UU Library: facing arrow — drawn on top of the position marker.
    if (current.mapId === 47 && libraryOverlay?.facing) {
      drawFacingArrow(mx, my, libraryOverlay.facing, zoom);
    }
  }

  // UU Library: thaum depth in panel header.
  if (current?.mapId === 47) {
    const thaums = Math.floor((((4850 - current.y) - 10) / 30) * 5);
    $mapName.textContent = `UU Library — ${thaums} thaums`;
  } else {
    $mapName.textContent = headerText(data.maps, current);
  }
  $canvas.classList.toggle("dimmed", current == null && currentImage != null);

  // Remember offsets so the hover handler can map screen → data-space.
  $canvas._offsetX = offsetX;
  $canvas._offsetY = offsetY;
  $canvas._zoom = zoom;
}

// ─── Zoom ─────────────────────────────────────────────────────────────────
function updateZoomButtons() {
  $zoomOut.disabled = zoomIdx <= 0;
  $zoomIn.disabled = zoomIdx >= ZOOMS.length - 1;
}
$zoomIn.addEventListener("click",  () => { if (zoomIdx < ZOOMS.length - 1) { zoomIdx++; updateZoomButtons(); redraw(); } });
$zoomOut.addEventListener("click", () => { if (zoomIdx > 0) { zoomIdx--; updateZoomButtons(); redraw(); } });
updateZoomButtons();

// ─── Hover tooltip ────────────────────────────────────────────────────────
const HOVER_RADIUS_PX = 8;

$canvas.addEventListener("pointermove", (e) => {
  if (!currentImage || currentRoomsForMap.length === 0) { $tooltip.hidden = true; return; }
  const meta = data.maps[current?.mapId];
  if (!meta) { $tooltip.hidden = true; return; }

  const rect = $canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const offsetX = $canvas._offsetX, offsetY = $canvas._offsetY, zoom = $canvas._zoom;

  // Convert screen → image pixel → data-space.
  const imgPx = (screenX - offsetX) / zoom;
  const imgPy = (screenY - offsetY) / zoom;
  const dx = imgPx * (meta.maxX / currentImage.naturalWidth);
  const dy = imgPy * (meta.maxY / currentImage.naturalHeight);

  // Radius is in data-space, converted from a screen-px radius.
  const dataR = HOVER_RADIUS_PX / zoom * (meta.maxX / currentImage.naturalWidth);
  const dataR2 = dataR * dataR;

  let best = null, bestD2 = Infinity;
  for (const r of currentRoomsForMap) {
    const ddx = r.x - dx, ddy = r.y - dy;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < dataR2 && d2 < bestD2) { best = r; bestD2 = d2; }
  }

  if (best) {
    $tooltip.hidden = false;
    $tooltip.textContent = best.short;
    $tooltip.style.left = `${screenX + 12}px`;
    $tooltip.style.top  = `${screenY + 12}px`;
  } else {
    $tooltip.hidden = true;
  }
});
$canvas.addEventListener("pointerleave", () => { $tooltip.hidden = true; });

// ─── Resize ───────────────────────────────────────────────────────────────
const ro = new ResizeObserver(() => redraw());
ro.observe($canvas);

// ─── Host messages ────────────────────────────────────────────────────────
panel.on("room_info", (frame) => {
  const next = resolveRoom(data, frame);
  if (mapDidChange(current, next)) {
    swapImage(next);
  }
  if (next !== null) lastKnownMapId = next.mapId;
  current = next;
  redraw();
});

panel.on("route_set", (frame) => {
  routeRoomIds = Array.isArray(frame.rooms) ? frame.rooms : [];
  redraw();
});

panel.on("route_clear", () => {
  routeRoomIds = [];
  redraw();
});

panel.on("library_overlay", (frame) => {
  libraryOverlay = frame;
  redraw();
});

panel.on("library_position", (frame) => {
  const next = { mapId: 47, x: frame.x, y: frame.y, short: null };
  if (mapDidChange(current, next)) swapImage(next);
  lastKnownMapId = 47;
  current = next;
  redraw();
});

// Signal readiness; Lua replays last room, route and library overlay.
panel.post("ready", {});

// Initial draw so the placeholder header renders.
redraw();
