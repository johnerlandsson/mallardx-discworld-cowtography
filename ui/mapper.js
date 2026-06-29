import { rooms, maps, terrain } from "./data/rooms.js";
import customRooms from "./data/room-custom.js";
import { resolveRoom } from "./lookup.js";
import { mapDidChange, headerText } from "./render.js";
import { SvgRenderer } from "./svg-renderer.js";
import { PngRenderer }  from "./png-renderer.js";
import { buildMapMenuItems } from './map-menu.js';
import mapGroups from './data/map-groups.js';

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
const $footer       = document.querySelector(".route-footer");
const $routeDest    = document.querySelector(".route-dest");
const $routeWalk    = document.querySelector(".route-walk");
const $routeClear   = document.querySelector(".route-clear");
const $routeError    = document.querySelector(".route-error");
const $routeRecenter = document.querySelector(".route-recenter");

// ─── Filters ──────────────────────────────────────────────────────────────
function applyStreetsState(visible) {
  document.documentElement.classList.toggle('streets-hidden', !visible);
}
applyStreetsState(true);

function applyStairsState(visible) {
  document.documentElement.classList.toggle('stairs-hidden', !visible);
}
applyStairsState(true);

// ─── Special screens ──────────────────────────────────────────────────────
const SPECIAL_SCREENS = {
  unknown:   { title: "Unknown Location",  sub: "No map data for this room." },
  darkness:  { title: "Darkness",          sub: "You cannot see a thing."    },
  labyrinth: { title: "Labyrinth",         sub: "The passages twist and turn." },
  mines:     { title: "Mines",             sub: ""                            },
  rat_farm:  { title: "Rat Farm",          sub: ""                            },
};

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

// ─── L-space animation ────────────────────────────────────────────────────
const LSPACE_COLORS = ["#cc44ff", "#00d2ff", "#4ade80", "#ff9f43", "#ff6b6b", "#ffd32a", "#ffffff"];
const lspaceState = { x: -1, y: -1, vx: 1.5, vy: 1.1, colorIdx: 0 };
let lspaceAnim = null;

function startLSpaceAnim() {
  if (lspaceAnim !== null) return;
  const badge = $lspace.querySelector(".lspace-badge");
  const s = lspaceState;
  badge.style.color = LSPACE_COLORS[s.colorIdx];
  function step() {
    const cw = $lspace.clientWidth, ch = $lspace.clientHeight;
    const bw = badge.offsetWidth,   bh = badge.offsetHeight;
    if (s.x < 0) { s.x = (cw - bw) / 2; s.y = (ch - bh) / 2; }
    s.x += s.vx; s.y += s.vy;
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

// ─── Coordinator state ────────────────────────────────────────────────────
let current        = null;
let target         = null;
let routeRoomIds   = [];
let libraryOverlay = null;
let lastKnownMapId = null;
let displayedMapId = null;
let darkMode       = false;
let walkActive     = false;
const savedZoom    = new Map();

function getState() {
  // Suppress target prediction while a route is active so the position indicator
  // follows confirmed (current) position rather than jumping ahead via alias.
  return { current, target: routeRoomIds.length > 0 ? null : target, routeRoomIds, darkMode, libraryOverlay };
}

// ─── Renderer lifecycle ───────────────────────────────────────────────────
let activeRenderer = null;
let contextMenuController = null;

const callbacks = {
  onRoomClick:   (id, name) => panel.post("room_click", { id, name }),
  onMapLoaded:   (mapId) => {
    target = null;  // clear prediction on successful map load
    updateHeader();
    activeRenderer?.applyState(getState());
    const meta = data.maps[mapId];
    panel.post("map_changed", { name: meta.file.replace(/\.\w+$/, '') });
  },
  onPersistZoom: (mapId, w) => panel.post("save_zoom", { mapId, w }),
  onZoomReset:   () => {
    const pos = target ?? current;
    if (pos && pos.mapId === displayedMapId) activeRenderer?.centerOn?.(pos.x, pos.y);
  },
};

function switchRenderer(style) {
  activeRenderer?.destroy();
  const Cls = style === 'png' ? PngRenderer : SvgRenderer;
  activeRenderer = new Cls($container, data, callbacks, savedZoom);
  rewireZoom();
  rewireContextMenu();
}

async function loadMap(mapId, x, y) {
  if (!activeRenderer || mapId == null) return;
  displayedMapId = mapId;
  try {
    await activeRenderer.load(mapId, x, y);
  } catch (e) {
    console.error("[mapper] map load failed:", e);
    $mapName.textContent = "Map load failed";
  }
}

// ─── Zoom buttons ─────────────────────────────────────────────────────────
$zoomIn.addEventListener("click",  () => activeRenderer?.zoomIn?.());
$zoomOut.addEventListener("click", () => activeRenderer?.zoomOut?.());

function rewireZoom() {
  const supported = activeRenderer?.supportsZoom ?? false;
  $zoomIn.hidden  = !supported;
  $zoomOut.hidden = !supported;
}

// ─── Resize observer for PNG canvas ───────────────────────────────────────
new ResizeObserver(() => activeRenderer?.handleResize()).observe($container);

// ─── Context menu ─────────────────────────────────────────────────────────
function rewireContextMenu() {
  contextMenuController?.abort();
  contextMenuController = null;
  if (!(panel.menu && typeof panel.menu.show === "function")) return;
  contextMenuController = new AbortController();
  document.addEventListener("contextmenu", (e) => {
    const isWorld   = displayedMapId === 99;
    const streetsOn = !document.documentElement.classList.contains('streets-hidden');
    const stairsOn  = !document.documentElement.classList.contains('stairs-hidden');
    const items = [{ header: true, label: "Map" }];
    if (activeRenderer?.supportsFilters && !isWorld) {
      items.push(
        { label: "Street names", checked: streetsOn, onClick: () => {
            applyStreetsState(!streetsOn);
            panel.post("save_filters", { streets: !streetsOn, stairs: stairsOn });
        }},
        { label: "Stairs", checked: stairsOn, onClick: () => {
            applyStairsState(!stairsOn);
            panel.post("save_filters", { streets: streetsOn, stairs: !stairsOn });
        }},
      );
    }
    for (const group of buildMapMenuItems(data.maps, mapGroups, displayedMapId)) {
      items.push({
        label: group.label,
        checked: group.checked,
        submenu: group.submenu.map(({ mapId, label, checked }) => {
          const meta = data.maps[mapId];
          return { label, checked, onClick: () => loadMap(mapId, meta.defaultX, meta.defaultY) };
        }),
      });
    }
    panel.menu.show(e, items);
  }, { signal: contextMenuController.signal });
}

// ─── Footer ───────────────────────────────────────────────────────────────
$routeWalk.addEventListener("click",  () => panel.post("walk_request",  {}));
$routeClear.addEventListener("click", () => panel.post("clear_request", {}));
$routeRecenter.addEventListener("click", async () => {
  if (!current) return;
  await loadMap(current.mapId, current.x, current.y);
  activeRenderer?.centerOn?.(current.x, current.y);
});

$footer.addEventListener("pointerenter", () => {
  const text = $routeDest.textContent;
  if (!text) return;
  const r = $footer.getBoundingClientRect();
  panel.tooltip.show({ x: r.left, y: r.top, width: r.width, height: r.height }, { title: text });
});
$footer.addEventListener("pointerleave", () => panel.tooltip.hide());

// ─── Header ───────────────────────────────────────────────────────────────
function updateRecenter() {
  $routeRecenter.disabled = current === null;
}

function updateHeader() {
  const inLSpace  = current === null && lastKnownMapId === 47;
  const inUnknown = current === null && !inLSpace && $special.hidden;
  $lspace.hidden = !inLSpace;
  if (inLSpace)  startLSpaceAnim(); else stopLSpaceAnim();
  if (inLSpace)   { hideSpecialScreen(); $mapName.textContent = "L-space"; return; }
  if (inUnknown)  { showSpecialScreen("unknown"); $mapName.textContent = ""; return; }
  if (current !== null) hideSpecialScreen();
  if (current?.mapId === 47) {
    const thaums = Math.floor((((4850 - current.y) - 10) / 30) * 5);
    $mapName.textContent = `UU Library — ${thaums} thaums`;
  } else {
    $mapName.textContent = headerText(data.maps, current);
  }
  updateRecenter();
}

// ─── Route ────────────────────────────────────────────────────────────────
function clearRoute() {
  clearRouteError();
  walkActive    = false;
  routeRoomIds  = [];
  activeRenderer?.applyState(getState());
  $routeDest.textContent = '';
  $routeWalk.hidden  = true;
  $routeClear.hidden = true;
  $routeWalk.disabled  = false;
  $routeClear.disabled = false;
}

let routeErrorTimer = null;

function clearRouteError() {
  clearTimeout(routeErrorTimer);
  routeErrorTimer = null;
  $routeError.hidden = true;
  $routeDest.hidden  = false;
}

panel.on("route_error", (frame) => {
  clearTimeout(routeErrorTimer);
  $routeError.textContent = `No route to ${frame.name}`;
  $routeError.hidden = false;
  $routeDest.hidden  = true;
  routeErrorTimer = setTimeout(clearRouteError, 3000);
});

// ─── Panel event handlers ─────────────────────────────────────────────────
panel.on("grab_focus",    () => activeRenderer?.grabFocus?.());
panel.on("release_focus", () => activeRenderer?.releaseFocus?.());
panel.on("pan",  (frame) => activeRenderer?.pan?.(frame.dir));
panel.on("zoom", (frame) => activeRenderer?.zoom?.(frame.dir));

panel.on("map_style", async (frame) => {
  const style = frame.style ?? 'svg';
  switchRenderer(style);
  if (displayedMapId != null) {
    const x = current?.x ?? data.maps[displayedMapId]?.defaultX;
    const y = current?.y ?? data.maps[displayedMapId]?.defaultY;
    await loadMap(displayedMapId, x, y);
    activeRenderer?.applyState(getState());
  }
  updateHeader();
});

panel.on("zoom_data", (frame) => {
  for (const [k, v] of Object.entries(frame)) savedZoom.set(Number(k), v);
});

panel.on("filters_data", (frame) => {
  applyStreetsState(frame.streets !== false);
  applyStairsState(frame.stairs  !== false);
});

panel.on("room_dark", () => { darkMode = true; activeRenderer?.applyState(getState()); });

panel.on("room_info", async (frame) => {
  const wasInDark = darkMode;
  darkMode = false;
  if (wasInDark) target = null;
  let next = resolveRoom(data, frame);
  if (next === null && frame.name) {
    next = activeRenderer?.findRoomByLabel?.(frame.name, displayedMapId) ?? null;
  }
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
    } else if (next !== null) {
      try {
        await loadMap(next.mapId, next.x, next.y);
      } catch (e) {
        console.error("[mapper] loadMap failed:", e);
        $mapName.textContent = "Map load failed";
        return;
      }
    }
  } else if (next !== null) {
    if (!target) activeRenderer?.centerOn?.(next.x, next.y);
  }
  if (next !== null) {
    lastKnownMapId = next.mapId;
    next.roomId = frame.identifier ?? null;
  }
  const destRoomId = routeRoomIds.length > 0 ? routeRoomIds[routeRoomIds.length - 1] : null;
  if (!walkActive && destRoomId !== null && next?.roomId === destRoomId) {
    clearRoute();
  }
  const roomChanged = next?.roomId !== current?.roomId || next?.mapId !== current?.mapId;
  current = next;
  if (roomChanged || wasInDark) {
    activeRenderer?.applyState(getState());
  }
  updateHeader();
});

panel.on("route_set", (frame) => {
  clearRouteError();
  routeRoomIds = Array.isArray(frame.rooms) ? frame.rooms : [];
  activeRenderer?.applyState(getState());
  $routeWalk.disabled  = false;
  $routeClear.disabled = false;
  if (frame.destination) {
    const s = frame.steps ?? Math.max(0, routeRoomIds.length - 1);
    $routeDest.textContent = `→ ${frame.destination} (${s} move${s === 1 ? '' : 's'})`;
    $routeWalk.hidden  = false;
    $routeClear.hidden = false;
  } else {
    $routeDest.textContent = '';
    $routeWalk.hidden  = true;
    $routeClear.hidden = true;
  }
});

panel.on("walk_active", () => {
  walkActive = true;
  target     = null;  // route walk sends all steps via mud.send (bypasses alias), so no target_moves will fire
  activeRenderer?.applyState(getState());
  $routeWalk.disabled  = true;
  $routeClear.disabled = true;
});

panel.on("route_clear", clearRoute);

panel.on("target_move", async (frame) => {
  const next = resolveRoom(data, frame);
  if (next !== null) next.roomId = frame.identifier ?? null;
  if (next === null) { target = null; activeRenderer?.applyState(getState()); return; }

  target = next;

  if (next.mapId !== displayedMapId) {
    await loadMap(next.mapId, next.x, next.y);
    // onMapLoaded has cleared target; restore it if GMCP hasn't confirmed arrival yet
    if (next.mapId !== 99 && current?.mapId !== next.mapId) target = next;
  } else {
    activeRenderer?.centerOn?.(next.x, next.y);
  }
  activeRenderer?.applyState(getState());
});

panel.on("target_clear", (frame) => {
  target = null;
  if (frame.snap && current && current.mapId === displayedMapId) {
    activeRenderer?.centerOn?.(current.x, current.y);
  }
  activeRenderer?.applyState(getState());
});

panel.on("library_overlay", (frame) => {
  libraryOverlay = frame;
  activeRenderer?.applyState(getState());
  if (current?.mapId === 47) activeRenderer?.applyLibraryPosition?.(current.x, current.y);
});

panel.on("library_position", async (frame) => {
  const next = { mapId: 47, x: frame.x, y: frame.y, short: null, roomId: null };
  if (mapDidChange(current, next)) {
    await loadMap(47, frame.x, frame.y);
  }
  lastKnownMapId = 47;
  current = next;
  activeRenderer?.applyState(getState());
  activeRenderer?.applyLibraryPosition?.(frame.x, frame.y);
  updateHeader();
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
  updateRecenter();
});

panel.post("ready", {});
