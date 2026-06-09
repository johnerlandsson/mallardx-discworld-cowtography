import { rooms, maps, terrain } from "./data/rooms.js";
import { resolveRoom } from "./lookup.js";
import { mapDidChange, headerText } from "./render.js";

const data = { rooms, maps, terrain };

// ─── DOM refs ─────────────────────────────────────────────────────────────
const $mapName   = document.querySelector(".map-name");
const $container = document.querySelector(".map-container");
const $lspace    = document.querySelector(".lspace-overlay");
const $tooltip   = document.querySelector(".tooltip");
const $zoomIn    = document.querySelector(".zoom-in");
const $zoomOut   = document.querySelector(".zoom-out");

// ─── State ────────────────────────────────────────────────────────────────
let current        = null;  // { mapId, x, y, short, roomId } | null
let currentSvg     = null;  // <svg> element | null
let routeRoomIds   = [];
let libraryOverlay = null;  // { facing, distortion, orb } | null
let lastKnownMapId = null;
let viewBox        = { x: 0, y: 0, w: 0, h: 0 };
let drag           = null;  // { screenX, screenY, vbX, vbY } | null
let loadGeneration = 0;

// World-disc canvas state (map 99 only)
let worldImg    = null;
let worldCanvas = null;
let worldCtx    = null;

// ─── ViewBox ──────────────────────────────────────────────────────────────
const ZOOM_FACTOR = 1.3;

function applyViewBox() {
  if (!currentSvg) return;
  currentSvg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

function resetZoom(mapId) {
  const meta = data.maps[mapId];
  if (!meta) return;
  const ratio = $container.clientHeight / Math.max($container.clientWidth, 1);
  viewBox.w = meta.maxX / 6;
  viewBox.h = viewBox.w * ratio;
}

function centerOnRoom(x, y) {
  viewBox.x = x - viewBox.w / 2;
  viewBox.y = y - viewBox.h / 2;
  applyViewBox();
}

// ─── SVG loading ──────────────────────────────────────────────────────────
function clearContainer() {
  for (const child of [...$container.children]) {
    if (!child.classList.contains("lspace-overlay") && !child.classList.contains("tooltip")) {
      child.remove();
    }
  }
  worldImg = null; worldCanvas = null; worldCtx = null;
}

async function loadSvgMap(mapId, x, y) {
  const meta = data.maps[mapId];
  if (!meta) return;
  const gen = ++loadGeneration;
  const res     = await fetch(`maps/${meta.file.replace(".png", ".svg")}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading map ${mapId}`);
  const svgText = await res.text();
  if (gen !== loadGeneration) return;  // superseded by a later load
  clearContainer();
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;";
  wrap.innerHTML = svgText;
  currentSvg = wrap.querySelector("svg");
  $container.insertBefore(wrap, $lspace);
  resetZoom(mapId);
  centerOnRoom(x, y);
  wireTooltip();
}

function loadWorldDisc(x, y) {
  clearContainer();
  currentSvg = null;
  const imgEl = document.createElement("img");
  imgEl.className = "world-map";
  imgEl.src = `maps/${data.maps[99].file}`;
  const canvasEl = document.createElement("canvas");
  canvasEl.className = "world-canvas";
  worldCanvas = canvasEl;
  worldCtx    = canvasEl.getContext("2d");
  imgEl.onload = () => { worldImg = imgEl; drawWorldDisc(x, y); };
  $container.insertBefore(imgEl, $lspace);
  $container.insertBefore(canvasEl, $lspace);
}

function drawWorldDisc(x, y) {
  if (!worldCtx || !worldImg) return;
  const cw = $container.clientWidth;
  const ch = $container.clientHeight;
  worldCanvas.width  = cw;
  worldCanvas.height = ch;
  worldCtx.clearRect(0, 0, cw, ch);
  const meta = data.maps[99];
  const sx = worldImg.naturalWidth  / meta.maxX;
  const sy = worldImg.naturalHeight / meta.maxY;
  const px = x * sx, py = y * sy;
  const offX = cw / 2 - px, offY = ch / 2 - py;
  worldCtx.drawImage(worldImg, offX, offY, worldImg.naturalWidth, worldImg.naturalHeight);
  worldCtx.beginPath();
  worldCtx.arc(offX + px, offY + py, 5, 0, Math.PI * 2);
  worldCtx.fillStyle   = "#ff3b30";
  worldCtx.fill();
  worldCtx.lineWidth   = 1.5;
  worldCtx.strokeStyle = "#fff";
  worldCtx.stroke();
}

// ─── State toggling ───────────────────────────────────────────────────────
function applyState() {
  if (!currentSvg) return;
  currentSvg.querySelectorAll(".current, .route").forEach(el => {
    el.classList.remove("current", "route");
  });
  if (current?.roomId) {
    currentSvg.querySelector(`#room-${CSS.escape(current.roomId)}`)?.classList.add("current");
  }
  for (const id of routeRoomIds) {
    currentSvg.querySelector(`#room-${CSS.escape(id)}`)?.classList.add("route");
  }
  for (let i = 0; i < routeRoomIds.length - 1; i++) {
    const [a, b] = [routeRoomIds[i], routeRoomIds[i + 1]].sort();
    currentSvg.querySelector(`#edge-${CSS.escape(a)}-${CSS.escape(b)}`)?.classList.add("route");
  }
}

// ─── Hover tooltip ────────────────────────────────────────────────────────
function wireTooltip() {
  if (!currentSvg) return;
  currentSvg.addEventListener("pointermove", (e) => {
    const roomEl = e.target.closest(".room");
    const label  = roomEl?.dataset.label ?? "";
    if (label) {
      const rect = $container.getBoundingClientRect();
      $tooltip.hidden    = false;
      $tooltip.textContent = label;
      $tooltip.style.left  = `${e.clientX - rect.left + 12}px`;
      $tooltip.style.top   = `${e.clientY - rect.top  + 12}px`;
    } else {
      $tooltip.hidden = true;
    }
  });
  currentSvg.addEventListener("pointerleave", () => { $tooltip.hidden = true; });
}

// ─── Header ───────────────────────────────────────────────────────────────
function updateHeader() {
  const inLSpace = current === null && lastKnownMapId === 47;
  $lspace.hidden = !inLSpace;
  if (inLSpace) { $mapName.textContent = "L-space"; return; }
  if (current?.mapId === 47) {
    const thaums = Math.floor((((4850 - current.y) - 10) / 30) * 5);
    $mapName.textContent = `UU Library — ${thaums} thaums`;
  } else {
    $mapName.textContent = headerText(data.maps, current);
  }
}

// ─── UU Library overlay ───────────────────────────────────────────────────
const ORB_RADIUS = {
  "tiny speck": 3, "small point": 5, "moderately-sized ball": 7,
  "large orb": 9, "substantial sphere": 12,
};

function applyLibraryOverlay() {
  if (!currentSvg || !current || current.mapId !== 47) return;
  const cx = current.x, cy = current.y, half = 15;
  const distEl = currentSvg.querySelector("#lib-distortion");
  const orbEl  = currentSvg.querySelector("#lib-orb");
  const arrEl  = currentSvg.querySelector("#lib-arrow");
  if (!distEl || !orbEl || !arrEl) return;

  // Distortion bar along one tile edge
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

  // Orb at tile centre
  if (libraryOverlay?.orb) {
    orbEl.setAttribute("cx", cx); orbEl.setAttribute("cy", cy);
    orbEl.setAttribute("r",  ORB_RADIUS[libraryOverlay.orb] ?? 7);
    orbEl.setAttribute("visibility", "visible");
  } else {
    orbEl.setAttribute("visibility", "hidden");
  }

  // Facing arrow chevron
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

// ─── Zoom buttons ─────────────────────────────────────────────────────────
$zoomIn.addEventListener("click",  () => { viewBox.w /= ZOOM_FACTOR; viewBox.h /= ZOOM_FACTOR; applyViewBox(); });
$zoomOut.addEventListener("click", () => { viewBox.w *= ZOOM_FACTOR; viewBox.h *= ZOOM_FACTOR; applyViewBox(); });

// ─── Scroll zoom ──────────────────────────────────────────────────────────
$container.addEventListener("wheel", (e) => {
  if (!currentSvg) return;
  e.preventDefault();
  const rect   = $container.getBoundingClientRect();
  const px     = (e.clientX - rect.left) / rect.width;
  const py     = (e.clientY - rect.top)  / rect.height;
  const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  const newW   = viewBox.w * factor;
  const newH   = viewBox.h * factor;
  viewBox.x   += px * (viewBox.w - newW);
  viewBox.y   += py * (viewBox.h - newH);
  viewBox.w    = newW;
  viewBox.h    = newH;
  applyViewBox();
}, { passive: false });

// ─── Drag pan ─────────────────────────────────────────────────────────────
$container.addEventListener("pointerdown", (e) => {
  if (!currentSvg || e.target.closest(".room")) return;
  drag = { screenX: e.clientX, screenY: e.clientY, vbX: viewBox.x, vbY: viewBox.y };
  $container.setPointerCapture(e.pointerId);
});
$container.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const rect = $container.getBoundingClientRect();
  viewBox.x  = drag.vbX - (e.clientX - drag.screenX) / rect.width  * viewBox.w;
  viewBox.y  = drag.vbY - (e.clientY - drag.screenY) / rect.height * viewBox.h;
  applyViewBox();
});
$container.addEventListener("pointerup",     () => { drag = null; });
$container.addEventListener("pointercancel", () => { drag = null; });

// ─── Resize ───────────────────────────────────────────────────────────────
new ResizeObserver(() => {
  if (worldCtx && current) drawWorldDisc(current.x, current.y);
}).observe($container);

// ─── Host messages ────────────────────────────────────────────────────────
panel.on("room_info", async (frame) => {
  const next = resolveRoom(data, frame);

  if (mapDidChange(current, next)) {
    if (next?.mapId === 99) {
      loadWorldDisc(next.x, next.y);
    } else if (next !== null) {
      try {
        await loadSvgMap(next.mapId, next.x, next.y);
      } catch (e) {
        console.error("[mapper] loadSvgMap failed:", e);
        $mapName.textContent = "Map load failed";
        return;
      }
    }
  } else if (next !== null && currentSvg) {
    centerOnRoom(next.x, next.y);  // zoom persists, only pan updates
  }

  if (next !== null) {
    lastKnownMapId = next.mapId;
    next.roomId = frame.identifier ?? null;
  }
  current = next;
  applyState();
  updateHeader();
});

panel.on("route_set", (frame) => {
  routeRoomIds = Array.isArray(frame.rooms) ? frame.rooms : [];
  applyState();
});

panel.on("route_clear", () => {
  routeRoomIds = [];
  applyState();
});

panel.on("library_overlay", (frame) => {
  libraryOverlay = frame;
  applyLibraryOverlay();
});

panel.on("library_position", async (frame) => {
  const next = { mapId: 47, x: frame.x, y: frame.y, short: null, roomId: null };
  if (mapDidChange(current, next)) {
    try {
      await loadSvgMap(47, frame.x, frame.y);
    } catch (e) {
      console.error("[mapper] loadSvgMap failed:", e);
      $mapName.textContent = "Map load failed";
      return;
    }
    currentSvg?.querySelector(`#room-lib-${frame.x}-${frame.y}`)?.classList.add("current");
  } else if (currentSvg) {
    currentSvg.querySelector(".room.current")?.classList.remove("current");
    currentSvg.querySelector(`#room-lib-${frame.x}-${frame.y}`)?.classList.add("current");
    centerOnRoom(frame.x, frame.y);
  }
  lastKnownMapId = 47;
  current = next;
  updateHeader();
  applyLibraryOverlay();
});

panel.on("lspace", () => {
  lastKnownMapId = 47;
  current = null;
  updateHeader();
});

panel.post("ready", {});
updateHeader();
