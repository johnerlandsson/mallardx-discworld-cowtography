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

// ─── Drawing ──────────────────────────────────────────────────────────────
function redraw() {
  // Size canvas's drawing buffer to its CSS size (handles resize).
  const cw = $canvas.clientWidth;
  const ch = $canvas.clientHeight;
  if ($canvas.width !== cw) $canvas.width = cw;
  if ($canvas.height !== ch) $canvas.height = ch;

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, cw, ch);

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

  if (current && meta) {
    const { px, py } = markerPixel(currentImage, current, meta);
    const mx = offsetX + px * zoom;
    const my = offsetY + py * zoom;
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ff3b30";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }

  $mapName.textContent = headerText(data.maps, current);
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
  current = next;
  redraw();
});

// Signal readiness; Lua replays last_payload if it has one.
// plugin_panel_post requires a non-null data arg — empty object is the convention
// established by showcase + discworld-chat.
panel.post("ready", {});

// Initial draw so the placeholder header renders.
redraw();
