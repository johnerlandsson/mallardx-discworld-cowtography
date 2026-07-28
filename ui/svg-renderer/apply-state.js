import { _ensureOverlay, _lift, _restoreOverlay } from "./overlay.js";
import { updateStackVisibility } from "./stack-visibility.js";
import { applyLibraryOverlay } from "./library-overlay.js";

export function applyStateImpl(svg, displayedMapId, { current, target, routeRoomIds, darkMode, libraryOverlay }, currentStackGround) {
  if (displayedMapId === 99) {
    const dot = svg.querySelector('#world-player');
    if (dot) {
      const pos = target ?? current;
      if (pos) {
        dot.setAttribute('cx', pos.x);
        dot.setAttribute('cy', pos.y);
        dot.style.display = '';
      } else {
        dot.style.display = 'none';
      }
    }
    return currentStackGround;
  }

  const routeOv = svg.querySelector("#sg-route-overlay");
  const posOv   = svg.querySelector("#sg-pos-overlay");
  if (routeOv) _restoreOverlay(routeOv);
  if (posOv)   _restoreOverlay(posOv);

  svg.querySelectorAll(".current, .target, .route").forEach(el => {
    el.classList.remove("current", "target", "route");
  });

  currentStackGround = updateStackVisibility(svg, current?.roomId ?? null, currentStackGround);

  const routeOverlay = _ensureOverlay(svg, "sg-route-overlay");
  const posOverlay   = _ensureOverlay(svg, "sg-pos-overlay");
  posOverlay.classList.toggle("dark", darkMode);

  for (let i = 0; i < routeRoomIds.length - 1; i++) {
    const [a, b] = [routeRoomIds[i], routeRoomIds[i + 1]].sort();
    const edge = svg.querySelector(`#edge-${CSS.escape(a)}-${CSS.escape(b)}`);
    if (edge) { edge.classList.add("route"); _lift(edge, routeOverlay); }
  }
  for (const id of routeRoomIds) {
    const el = svg.querySelector(`#room-${CSS.escape(id)}`);
    if (el) {
      el.classList.add("route");
      const sib1 = el.nextElementSibling;
      _lift(el, routeOverlay);
      if (sib1?.classList.contains("room-type-label")) _lift(sib1, routeOverlay);
      const stairEl = svg.querySelector(`#stair-${CSS.escape(id)}`);
      if (stairEl) _lift(stairEl, routeOverlay);
    }
  }

  if (current?.roomId) {
    const el = svg.querySelector(`#room-${CSS.escape(current.roomId)}`);
    if (el) {
      el.classList.add("current");
      const sib1 = el.nextElementSibling;
      _lift(el, posOverlay);
      if (sib1?.classList.contains("room-type-label")) _lift(sib1, posOverlay);
      const stairEl = svg.querySelector(`#stair-${CSS.escape(current.roomId)}`);
      if (stairEl) _lift(stairEl, posOverlay);
    }
  }

  if (target?.roomId && (!current?.roomId || current.roomId !== target.roomId)) {
    const el = svg.querySelector(`#room-${CSS.escape(target.roomId)}`);
    if (el) {
      el.classList.add("target");
      const sib1 = el.nextElementSibling;
      _lift(el, posOverlay);
      if (sib1?.classList.contains("room-type-label")) _lift(sib1, posOverlay);
      const stairEl = svg.querySelector(`#stair-${CSS.escape(target.roomId)}`);
      if (stairEl) _lift(stairEl, posOverlay);
    }
  }

  if (displayedMapId === 47 && current?.mapId === 47) {
    applyLibraryOverlay(svg, current, libraryOverlay);
  }

  return currentStackGround;
}
