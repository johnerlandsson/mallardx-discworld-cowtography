import { rooms, maps, terrain } from "./data/rooms.js";
import customRooms from "./data/room-custom.js";
import { resolveRoom } from "./lookup.js";
import { mapDidChange, headerText } from "./render.js";

const data = { rooms: { ...rooms, ...customRooms }, maps, terrain };

// ─── DOM refs ─────────────────────────────────────────────────────────────
const $mapName      = document.querySelector(".map-name");
const $container    = document.querySelector(".map-container");
const $lspace       = document.querySelector(".lspace-overlay");
const $special      = document.querySelector(".special-screen");
const $specialTitle = $special.querySelector(".special-title");
const $specialSub   = $special.querySelector(".special-sub");
const $zoomIn       = document.querySelector(".zoom-in");
const $zoomOut      = document.querySelector(".zoom-out");
const $footer     = document.querySelector(".route-footer");
const $routeDest  = document.querySelector(".route-dest");
const $routeWalk  = document.querySelector(".route-walk");
const $routeClear = document.querySelector(".route-clear");

// Mallard pushes --bg as an inline style on :root after panel ready.
// Read the R channel — if >= 128 the background is light.
function applyThemeClass() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const m  = bg.match(/^#([0-9a-f]{2})/i);
  document.documentElement.classList.toggle('light-bg', m ? parseInt(m[1], 16) >= 128 : false);
}
new MutationObserver(applyThemeClass).observe(
  document.documentElement, { attributes: true, attributeFilter: ['style'] }
);
applyThemeClass();

const SPECIAL_SCREENS = {
  unknown:   { title: "Unknown Location",  sub: "No map data for this room." },
  darkness:  { title: "Darkness",          sub: "You cannot see a thing."    },
  labyrinth: { title: "Labyrinth",         sub: "The passages twist and turn." },
  mines:     { title: "Mines",             sub: ""                            },
  rat_farm:  { title: "Rat Farm",          sub: ""                            },
};

const LSPACE_COLORS = ["#cc44ff", "#00d2ff", "#4ade80", "#ff9f43", "#ff6b6b", "#ffd32a", "#ffffff"];

// ─── State ────────────────────────────────────────────────────────────────
let current        = null;  // { mapId, x, y, short, roomId } | null — GMCP-confirmed
let target         = null;  // { mapId, x, y, short, roomId } | null — predicted position
let currentSvg     = null;  // <svg> element | null
let routeRoomIds   = [];
let libraryOverlay = null;  // { facing, distortion, orb } | null
let lastKnownMapId = null;
let displayedMapId = null;  // mapId of the SVG/canvas currently on screen
let viewBox        = { x: 0, y: 0, w: 0, h: 0 };
let drag              = null;  // { screenX, screenY, vbX, vbY } | null
let pendingRoomClick  = null;  // { el, startX, startY } | null — candidate left-click on a room
let loadGeneration = 0;
let lspaceAnim     = null;  // requestAnimationFrame id for L-space bouncer
let tshopAnim      = null;  // requestAnimationFrame id for tshop hyperspace canvas
let darkMode       = false; // true while in a room without a GMCP identifier

// World-disc canvas state (map 99 only)
let worldImg    = null;
let worldCanvas = null;
let worldCtx    = null;

// ─── ViewBox ──────────────────────────────────────────────────────────────
const ZOOM_FACTOR  = 1.3;
const TARGET_PX    = 30;   // desired screen pixels between typical adjacent rooms
const roomUnits    = new Map();  // mapId → median nearest-neighbour distance
const savedZoom    = new Map();  // mapId → last viewBox.w the user left it at

function persistZoom(mapId, w) {
  savedZoom.set(mapId, w);
  panel.post("save_zoom", { mapId, w });
}

// Inject warp arrowhead marker into an SVG element if not already present.
// Hardcoded fill: context-stroke is unsupported in Mallard's WebKit.
function ensureWarpDefs(svgEl) {
  if (svgEl.querySelector('#warp-arrow')) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML =
    '<marker id="warp-arrow" viewBox="0 0 6 6" markerWidth="6.48" markerHeight="6.48"' +
    ' refX="6" refY="3" orient="auto-start-reverse" markerUnits="userSpaceOnUse">' +
    '<path d="M0,0 L6,3 L0,6 Z" fill="#a855f7"/></marker>';
  svgEl.prepend(defs);
}

// Compute median nearest-neighbour distance between rooms in an SVG.
// Uses a sorted-x sweep so it stays fast even on large maps.
function computeRoomUnit(svgEl) {
  const pts = [];
  for (const el of svgEl.querySelectorAll('.room')) {
    if (el.tagName.toLowerCase() === 'circle') {
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

function applyViewBox() {
  if (!currentSvg) return;
  currentSvg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

function defaultZoomW(mapId) {
  const meta = data.maps[mapId];
  if (!meta) return 1;
  if (mapId === 47) return 280;  // UU Library — fixed
  const unit = roomUnits.get(mapId);
  if (unit) return $container.clientWidth * unit / TARGET_PX;
  return meta.maxX / 4;  // fallback before unit is computed
}

function resetZoom(mapId) {
  const ratio = $container.clientHeight / Math.max($container.clientWidth, 1);
  viewBox.w = defaultZoomW(mapId);
  viewBox.h = viewBox.w * ratio;
}

function centerOnRoom(x, y) {
  viewBox.x = x - viewBox.w / 2;
  viewBox.y = y - viewBox.h / 2;
  applyViewBox();
}

// ─── SVG loading ──────────────────────────────────────────────────────────
// ─── L-space DVD bouncer ──────────────────────────────────────────────────
// Persisted across stop/start so brief room events don't reset the bounce position
const lspaceState = { x: -1, y: -1, vx: 1.5, vy: 1.1, colorIdx: 0 };

function startLSpaceAnim() {
  if (lspaceAnim !== null) return;
  const badge = $lspace.querySelector(".lspace-badge");
  const s = lspaceState;
  badge.style.color = LSPACE_COLORS[s.colorIdx];

  function step() {
    const cw = $lspace.clientWidth;
    const ch = $lspace.clientHeight;
    const bw = badge.offsetWidth;
    const bh = badge.offsetHeight;
    if (s.x < 0) { s.x = (cw - bw) / 2; s.y = (ch - bh) / 2; }
    s.x += s.vx;
    s.y += s.vy;
    let hitX = false, hitY = false;
    if (s.x <= 0)          { s.x = 0;       s.vx =  Math.abs(s.vx); hitX = true; }
    if (s.x + bw >= cw)    { s.x = cw - bw; s.vx = -Math.abs(s.vx); hitX = true; }
    if (s.y <= 0)          { s.y = 0;       s.vy =  Math.abs(s.vy); hitY = true; }
    if (s.y + bh >= ch)    { s.y = ch - bh; s.vy = -Math.abs(s.vy); hitY = true; }
    if (hitX && hitY) {
      s.colorIdx = (s.colorIdx + 1 + Math.floor(Math.random() * (LSPACE_COLORS.length - 1))) % LSPACE_COLORS.length;
      badge.style.color = LSPACE_COLORS[s.colorIdx];
    }
    badge.style.transform = `translate(${s.x}px, ${s.y}px)`;
    lspaceAnim = requestAnimationFrame(step);
  }
  lspaceAnim = requestAnimationFrame(step);
}

function stopLSpaceAnim() {
  if (lspaceAnim === null) return;
  cancelAnimationFrame(lspaceAnim);
  lspaceAnim = null;
}

function startTshopAnim(wrapEl) {
  stopTshopAnim();
  wrapEl.style.isolation = "isolate"; // create stacking context so canvas z-index:-1 sits behind SVG
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:-1;";
  wrapEl.insertBefore(canvas, wrapEl.firstChild);
  const particles = [];
  const ctx = canvas.getContext("2d");
  const HS_MAX = 80, HS_SPAWN = 0.35, HS_ACCEL = 1.015;

  function frame() {
    if (!canvas.isConnected) { tshopAnim = null; return; }
    tshopAnim = requestAnimationFrame(frame);
    const cw = canvas.offsetWidth, ch = canvas.offsetHeight;
    if (!cw || !ch) return;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.clearRect(0, 0, cw, ch);
    const cx = cw / 2, cy = ch / 2;
    const maxDist = Math.hypot(cx, cy) * 1.15;
    const fadeDist = maxDist * 0.75;
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#ffffff";
    if (particles.length < HS_MAX && Math.random() < HS_SPAWN) {
      particles.push({ angle: Math.random() * Math.PI * 2, dist: 0, speed: 0.5 + Math.random() * 0.8 });
    }
    ctx.strokeStyle = fg;
    ctx.lineCap = "round";
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const prev = p.dist;
      p.speed *= HS_ACCEL;
      p.dist  += p.speed;
      if (p.dist >= maxDist) { particles.splice(i, 1); continue; }
      const opacity = p.dist < 15
        ? p.dist / 15
        : p.dist > fadeDist
          ? 1 - (p.dist - fadeDist) / (maxDist - fadeDist)
          : 1;
      const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
      ctx.globalAlpha = opacity * 0.75;
      ctx.lineWidth   = Math.max(0.5, p.speed * 0.15);
      ctx.beginPath();
      ctx.moveTo(cx + cos * prev,   cy + sin * prev);
      ctx.lineTo(cx + cos * p.dist, cy + sin * p.dist);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  tshopAnim = requestAnimationFrame(frame);
}

function stopTshopAnim() {
  if (tshopAnim === null) return;
  cancelAnimationFrame(tshopAnim);
  tshopAnim = null;
}

function showSpecialScreen(name) {
  const info = SPECIAL_SCREENS[name] ?? { title: name, sub: "" };
  $specialTitle.textContent = info.title;
  $specialSub.textContent   = info.sub;
  $specialSub.hidden        = !info.sub;
  $special.hidden = false;
}

function hideSpecialScreen() {
  $special.hidden = true;
}

function clearContainer() {
  stopTshopAnim();
  for (const child of [...$container.children]) {
    if (!child.classList.contains("lspace-overlay") &&
        !child.classList.contains("special-screen") &&
        !child.classList.contains("tooltip")) {
      child.remove();
    }
  }
  worldImg = null; worldCanvas = null; worldCtx = null;
}

async function loadSvgMap(mapId, x, y) {
  const meta = data.maps[mapId];
  if (!meta) return;
  const gen = ++loadGeneration;
  const { default: svgText } = await import(`./maps/${meta.file.replace(".png", ".js")}`);
  if (gen !== loadGeneration) return;  // superseded by a later load
  target = null;  // prediction is map-specific; clear on map change
  clearContainer();
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;";
  wrap.innerHTML = svgText;
  currentSvg = wrap.querySelector("svg");
  ensureWarpDefs(currentSvg);
  $container.insertBefore(wrap, $lspace);
  if (mapId === 53) startTshopAnim(wrap);
  if (!roomUnits.has(mapId)) {
    const unit = computeRoomUnit(currentSvg);
    if (unit) roomUnits.set(mapId, unit);
  }
  if (displayedMapId !== null && displayedMapId !== 99 && viewBox.w > 0) {
    persistZoom(displayedMapId, viewBox.w);
  }
  resetZoom(mapId);
  if (savedZoom.has(mapId)) {
    const ratio = viewBox.h / viewBox.w;
    viewBox.w = savedZoom.get(mapId);
    viewBox.h = viewBox.w * ratio;
  }
  displayedMapId = mapId;
  centerOnRoom(x, y);
  wireTooltip();
}

function loadWorldDisc(x, y) {
  if (displayedMapId !== null && displayedMapId !== 99 && viewBox.w > 0) {
    persistZoom(displayedMapId, viewBox.w);
  }
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
  displayedMapId = 99;
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

// ─── SVG overlay helpers ─────────────────────────────────────────────────
// Route elements and the position indicator are lifted into overlay <g>s
// appended to the SVG root so they always paint above the static layers.
// originalParent/NextSib track where each element came from so it can be
// restored to its exact original DOM position (not just appended to the end).
const _origParent  = new WeakMap();
const _origNextSib = new WeakMap();

function _ensureOverlay(svg, id) {
  let g = svg.querySelector(`#${id}`);
  if (!g) {
    g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.id = id;
    svg.appendChild(g);
  }
  return g;
}

function _lift(el, overlay) {
  if (!el) return;
  if (!_origParent.has(el)) {
    _origParent.set(el, el.parentNode);
    _origNextSib.set(el, el.nextSibling);
  }
  overlay.appendChild(el);
}

function _restoreOverlay(overlay) {
  // Restore in reverse so that each element's saved nextSibling has already
  // been restored by the time we insertBefore it.
  for (const el of [...overlay.children].reverse()) {
    const p   = _origParent.get(el);
    const sib = _origNextSib.get(el);
    if (p) {
      if (sib && sib.parentNode === p) p.insertBefore(el, sib);
      else p.appendChild(el);
    }
    _origParent.delete(el);
    _origNextSib.delete(el);
  }
}

// ─── State toggling ───────────────────────────────────────────────────────
function applyState() {
  if (!currentSvg) return;

  // Restore previously lifted elements before clearing classes.
  const routeOv = currentSvg.querySelector("#sg-route-overlay");
  const posOv   = currentSvg.querySelector("#sg-pos-overlay");
  if (routeOv) _restoreOverlay(routeOv);
  if (posOv)   _restoreOverlay(posOv);

  currentSvg.querySelectorAll(".current, .target, .route").forEach(el => {
    el.classList.remove("current", "target", "route");
  });

  const routeOverlay = _ensureOverlay(currentSvg, "sg-route-overlay");
  const posOverlay   = _ensureOverlay(currentSvg, "sg-pos-overlay");
  posOverlay.classList.toggle("dark", darkMode);

  // Route edges — lifted above all room layers.
  for (let i = 0; i < routeRoomIds.length - 1; i++) {
    const [a, b] = [routeRoomIds[i], routeRoomIds[i + 1]].sort();
    const edge = currentSvg.querySelector(`#edge-${CSS.escape(a)}-${CSS.escape(b)}`);
    if (edge) { edge.classList.add("route"); _lift(edge, routeOverlay); }
  }

  // Route rooms — lifted above route edges.
  for (const id of routeRoomIds) {
    const el = currentSvg.querySelector(`#room-${CSS.escape(id)}`);
    if (el) {
      el.classList.add("route");
      const sib1 = el.nextElementSibling;
      const sib2 = sib1?.nextElementSibling;
      _lift(el, routeOverlay);
      if (sib1?.classList.contains("stair-symbol")) {
        _lift(sib1, routeOverlay);
        if (sib2?.classList.contains("room-type-label")) _lift(sib2, routeOverlay);
      } else if (sib1?.classList.contains("room-type-label")) {
        _lift(sib1, routeOverlay);
      }
    }
  }

  // Position indicator — lifted above route overlay.
  // Primary: target if prediction active, otherwise confirmed position.
  const primary = target ?? current;
  if (primary?.roomId) {
    const el = currentSvg.querySelector(`#room-${CSS.escape(primary.roomId)}`);
    if (el) {
      el.classList.add("target");
      // Capture siblings before moving (DOM order changes after appendChild).
      const sib1 = el.nextElementSibling;
      const sib2 = sib1?.nextElementSibling;
      _lift(el, posOverlay);
      if (sib1?.classList.contains("stair-symbol")) {
        _lift(sib1, posOverlay);
        if (sib2?.classList.contains("room-type-label")) _lift(sib2, posOverlay);
      } else if (sib1?.classList.contains("room-type-label")) {
        _lift(sib1, posOverlay);
      }
    }
  }

  // Ghost: confirmed position, only when it differs from the predicted target.
  if (target && current?.roomId && current.roomId !== target.roomId) {
    const el = currentSvg.querySelector(`#room-${CSS.escape(current.roomId)}`);
    if (el) {
      el.classList.add("current");
      const gsib1 = el.nextElementSibling;
      const gsib2 = gsib1?.nextElementSibling;
      _lift(el, posOverlay);
      if (gsib1?.classList.contains("stair-symbol")) {
        _lift(gsib1, posOverlay);
        if (gsib2?.classList.contains("room-type-label")) _lift(gsib2, posOverlay);
      } else if (gsib1?.classList.contains("room-type-label")) {
        _lift(gsib1, posOverlay);
      }
    }
  }
}

// ─── Hover tooltip ────────────────────────────────────────────────────────
function wireTooltip() {
  if (!currentSvg) return;
  currentSvg.addEventListener("pointermove", (e) => {
    const roomEl = e.target.closest(".room");
    const label  = roomEl?.dataset.label ?? "";
    if (label) {
      panel.tooltip.show({ x: e.clientX, y: e.clientY, width: 0, height: 0 }, { title: label });
    } else {
      panel.tooltip.hide();
    }
  });
  currentSvg.addEventListener("pointerleave", () => { panel.tooltip.hide(); });
}

// ─── Header ───────────────────────────────────────────────────────────────
function updateHeader() {
  const inLSpace  = current === null && lastKnownMapId === 47;
  const inUnknown = current === null && !inLSpace && $special.hidden;
  $lspace.hidden = !inLSpace;
  if (inLSpace)  startLSpaceAnim();
  else           stopLSpaceAnim();
  if (inLSpace)   { hideSpecialScreen(); $mapName.textContent = "L-space"; return; }
  if (inUnknown)  { showSpecialScreen("unknown"); $mapName.textContent = ""; return; }
  if (current !== null) hideSpecialScreen();
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
$routeWalk.addEventListener("click",  () => { panel.post("walk_request",  {}); });
$routeClear.addEventListener("click", () => { panel.post("clear_request", {}); });

// ─── Scroll zoom ──────────────────────────────────────────────────────────
$container.addEventListener("wheel", (e) => {
  if (!currentSvg) return;
  e.preventDefault();
  const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  const newW   = viewBox.w * factor;
  const newH   = viewBox.h * factor;
  viewBox.x   += 0.5 * (viewBox.w - newW);
  viewBox.y   += 0.5 * (viewBox.h - newH);
  viewBox.w    = newW;
  viewBox.h    = newH;
  applyViewBox();
}, { passive: false });

// ─── Map focus (keyboard nav) ─────────────────────────────────────────────
// Click the map to grab focus: bare arrow keys pan, +/-/= zoom, 0 re-centres.
// Clicking outside or pressing Escape releases. panel.captureKeys(true) stops
// stray-key forwarding so the keys stay in our panel instead of going to the
// host text input.
let mapFocused = false;

function grabFocus() {
  mapFocused = true;
  panel.captureKeys(true);
  $container.classList.add("focused");
  $container.focus();
}

function releaseFocus() {
  mapFocused = false;
  panel.captureKeys(false);
  $container.classList.remove("focused");
}

$container.addEventListener("click", () => { if (!mapFocused) grabFocus(); });
window.addEventListener("blur", releaseFocus);

window.addEventListener("keydown", (e) => {
  if (!mapFocused || !currentSvg) return;
  switch (e.key) {
    case "ArrowUp":    viewBox.y -= viewBox.h * 0.2; applyViewBox(); break;
    case "ArrowDown":  viewBox.y += viewBox.h * 0.2; applyViewBox(); break;
    case "ArrowLeft":  viewBox.x -= viewBox.w * 0.2; applyViewBox(); break;
    case "ArrowRight": viewBox.x += viewBox.w * 0.2; applyViewBox(); break;
    case "+": case "=": {
      const nw = viewBox.w / ZOOM_FACTOR, nh = viewBox.h / ZOOM_FACTOR;
      viewBox.x += 0.5 * (viewBox.w - nw); viewBox.y += 0.5 * (viewBox.h - nh);
      viewBox.w = nw; viewBox.h = nh; applyViewBox(); break;
    }
    case "-": {
      const nw = viewBox.w * ZOOM_FACTOR, nh = viewBox.h * ZOOM_FACTOR;
      viewBox.x += 0.5 * (viewBox.w - nw); viewBox.y += 0.5 * (viewBox.h - nh);
      viewBox.w = nw; viewBox.h = nh; applyViewBox(); break;
    }
    case "0": {
      const pos = target ?? current;
      if (pos && pos.mapId === displayedMapId) centerOnRoom(pos.x, pos.y);
      break;
    }
    case "Escape": releaseFocus(); break;
    default: return;
  }
  e.preventDefault();
});

panel.on("grab_focus",    grabFocus);
panel.on("release_focus", releaseFocus);

// ─── Pointer events: pan + click-to-route ─────────────────────────────────
// Middle mouse: pan anywhere.
// Left mouse on empty space: pan.
// Left click on a room (< 4px movement): route to that room.
$container.addEventListener("pointerdown", (e) => {
  if (!currentSvg) return;
  const roomEl = e.target.closest(".room");
  if (e.button === 1) {
    e.preventDefault();  // suppress browser autoscroll cursor
    drag = { screenX: e.clientX, screenY: e.clientY, vbX: viewBox.x, vbY: viewBox.y };
    $container.setPointerCapture(e.pointerId);
  } else if (e.button === 0 && !roomEl) {
    drag = { screenX: e.clientX, screenY: e.clientY, vbX: viewBox.x, vbY: viewBox.y };
    $container.setPointerCapture(e.pointerId);
  } else if (e.button === 0 && roomEl) {
    pendingRoomClick = { el: roomEl, startX: e.clientX, startY: e.clientY };
    $container.setPointerCapture(e.pointerId);
  }
});
$container.addEventListener("pointermove", (e) => {
  if (drag) {
    const rect = $container.getBoundingClientRect();
    viewBox.x  = drag.vbX - (e.clientX - drag.screenX) / rect.width  * viewBox.w;
    viewBox.y  = drag.vbY - (e.clientY - drag.screenY) / rect.height * viewBox.h;
    applyViewBox();
  } else if (pendingRoomClick) {
    const dx = e.clientX - pendingRoomClick.startX;
    const dy = e.clientY - pendingRoomClick.startY;
    if (Math.hypot(dx, dy) > 4) pendingRoomClick = null;
  }
});
$container.addEventListener("pointerup", () => {
  if (pendingRoomClick) {
    const el = pendingRoomClick.el;
    const roomId = el.id.slice(5);        // strip "room-" prefix
    const name   = el.dataset.label ?? "";
    panel.post("room_click", { id: roomId, name });
  }
  drag = null;
  pendingRoomClick = null;
});
$container.addEventListener("pointercancel", () => {
  drag = null;
  pendingRoomClick = null;
});

// ─── Resize ───────────────────────────────────────────────────────────────
new ResizeObserver(() => {
  if (worldCtx && current) drawWorldDisc(current.x, current.y);
}).observe($container);

// ─── Host messages ────────────────────────────────────────────────────────
panel.on("zoom_data", (frame) => {
  for (const [k, v] of Object.entries(frame)) savedZoom.set(Number(k), v);
});

panel.on("room_dark", () => { darkMode = true;  applyState(); });

panel.on("room_info", async (frame) => {
  const wasInDark = darkMode;
  darkMode = false;
  if (wasInDark) target = null;
  let next = resolveRoom(data, frame);
  // Name-based fallback: if ID lookup failed, search the current map's SVG for
  // a room element whose data-label matches the GMCP room name. Enables maps
  // (e.g. am_shades) to track rooms that aren't in the rooms DB, as long as the
  // SVG node carries a matching data-label attribute.
  if (next === null && frame.name && currentSvg && displayedMapId !== null) {
    const el = currentSvg.querySelector(`[data-label="${CSS.escape(frame.name)}"]`);
    if (el) {
      const cx = el.getAttribute('cx');
      const x  = cx !== null
        ? parseFloat(cx)
        : parseFloat(el.getAttribute('x') ?? 0) + parseFloat(el.getAttribute('width') ?? 0) / 2;
      const cy = el.getAttribute('cy');
      const y  = cy !== null
        ? parseFloat(cy)
        : parseFloat(el.getAttribute('y') ?? 0) + parseFloat(el.getAttribute('height') ?? 0) / 2;
      if (!isNaN(x) && !isNaN(y)) {
        next = { mapId: displayedMapId, x, y, short: frame.name };
      }
    }
  }
  // library_position is authoritative for map 47. Ignore room_info events
  // that would keep us on map 47 or set current to null while already there —
  // only process if the event signals leaving the library entirely.
  if (current?.mapId === 47 && (next === null || next.mapId === 47)) return;

  // Clear target atomically when GMCP confirms the predicted room, so there is
  // never a split frame where target=null but current still points to the old room.
  if (target !== null && frame.identifier != null && frame.identifier === target.roomId) {
    target = null;
  }

  if (next?.mapId !== displayedMapId) {
    if (target?.mapId === displayedMapId) {
      // Target already triggered a proactive load of the right map. This GMCP
      // is a re-confirm of the old position (e.g. after an invalid direction)
      // — don't reload the old map and undo the proactive switch.
    } else if (next?.mapId === 99) {
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
    // Pan follows target when prediction is active; otherwise follow confirmed.
    if (!target) centerOnRoom(next.x, next.y);
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
  $routeWalk.disabled = false;
  $routeClear.disabled = false;
  if (frame.destination) {
    const s = frame.steps ?? Math.max(0, routeRoomIds.length - 1);
    $routeDest.textContent = `→ ${frame.destination} (${s} move${s === 1 ? '' : 's'})`;
    $routeWalk.hidden = false;
    $routeClear.hidden = false;
  } else {
    $routeDest.textContent = '';
    $routeWalk.hidden = true;
    $routeClear.hidden = true;
  }
});

panel.on("walk_active", () => { $routeWalk.disabled = true; $routeClear.disabled = true; });

panel.on("route_clear", () => {
  routeRoomIds = [];
  applyState();
  $routeDest.textContent = '';
  $routeWalk.hidden = true;
  $routeClear.hidden = true;
  $routeWalk.disabled = false;
  $routeClear.disabled = false;
});

panel.on("target_move", async (frame) => {
  const next = resolveRoom(data, frame);
  if (next !== null) next.roomId = frame.identifier ?? null;

  if (next === null) {
    target = null;
    applyState();
    return;
  }

  target = next;

  if (next.mapId !== displayedMapId) {
    // Target crossed a map boundary — proactively load the new map.
    if (next.mapId === 99) {
      loadWorldDisc(next.x, next.y);
      target = null;  // world disc has no SVG room indicator
    } else {
      try {
        await loadSvgMap(next.mapId, next.x, next.y);
      } catch (e) {
        console.error("[mapper] target_move map load failed:", e);
        target = null;
        return;
      }
      // Restore target only if GMCP hasn't already confirmed arrival
      // (i.e. room_info hasn't updated current to this map yet).
      if (current?.mapId !== next.mapId) {
        target = next;
      }
    }
  } else if (currentSvg) {
    centerOnRoom(next.x, next.y);
  }
  applyState();
});

panel.on("target_clear", (frame) => {
  target = null;
  // Only snap view to confirmed position when explicitly requested (e.g. stop
  // mid-route). When the prediction simply caught up, room_info fires next and
  // handles panning — snapping here causes the "new → old → new" visual glitch.
  if (frame.snap && current && currentSvg && current.mapId === displayedMapId) {
    centerOnRoom(current.x, current.y);
  }
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
  target  = null;
  updateHeader();
});

panel.on("special_screen", (frame) => {
  current = null;
  stopLSpaceAnim();
  $lspace.hidden = true;
  showSpecialScreen(frame.name);
  $mapName.textContent = $specialTitle.textContent;
});

panel.on("pan", (frame) => {
  if (!currentSvg) return;
  const step = 0.2;
  if      (frame.dir === "n") viewBox.y -= viewBox.h * step;
  else if (frame.dir === "s") viewBox.y += viewBox.h * step;
  else if (frame.dir === "w") viewBox.x -= viewBox.w * step;
  else if (frame.dir === "e") viewBox.x += viewBox.w * step;
  applyViewBox();
});

panel.on("zoom", (frame) => {
  if (!currentSvg) return;
  const factor = frame.dir === "in" ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
  const newW = viewBox.w * factor;
  const newH = viewBox.h * factor;
  viewBox.x += 0.5 * (viewBox.w - newW);
  viewBox.y += 0.5 * (viewBox.h - newH);
  viewBox.w  = newW;
  viewBox.h  = newH;
  applyViewBox();
});

panel.post("ready", {});
updateHeader();
