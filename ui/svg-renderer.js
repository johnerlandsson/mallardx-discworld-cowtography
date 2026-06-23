import { upperToGround, groundToUppers } from "./data/room-stacks.js";

const ROOM_TYPE_LABELS = {
  shop: 'General shop', weapon: 'Weapon shop', armour: 'Armour shop',
  clothes: 'Clothing shop', food: 'Food shop', access: 'Accessories shop',
  bank: 'Bank', changer: 'Money changer', mission: 'Mission office',
  post: 'Post office', lang: 'Language school', temple: 'Temple',
  crafts: 'Crafts shop', house: 'Player house', club: 'Player club',
  pshop: 'Player shop', tshop: 'Travelling shop', talker: 'Talker shop',
  tavern: 'Tavern / Restaurant', pub: 'Pub / Bar',
};

const ORB_RADIUS = {
  "tiny speck": 3, "small point": 5, "moderately-sized ball": 7,
  "large orb": 9, "substantial sphere": 12,
};

const ZOOM_FACTOR = 1.3;
const TARGET_PX   = 30;

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

function ensureWarpDefs(svgEl) {
  if (svgEl.querySelector('#warp-arrow')) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML =
    '<marker id="warp-arrow" viewBox="0 0 6 6" markerWidth="6.48" markerHeight="6.48"' +
    ' refX="6" refY="3" orient="auto-start-reverse" markerUnits="userSpaceOnUse">' +
    '<path d="M0,0 L6,3 L0,6 Z" fill="#a855f7"/></marker>';
  svgEl.prepend(defs);
}

// WeakMaps for overlay element tracking — module-level so they survive across load() calls.
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

export class SvgRenderer {
  supportsZoom    = true;
  supportsFilters = true;

  #container;
  #data;
  #callbacks;
  #savedZoom;

  #svg            = null;
  #displayedMapId = null;
  #viewBox        = { x: 0, y: 0, w: 0, h: 0 };
  #drag           = null;
  #pendingClick   = null;
  #loadGeneration = 0;
  #tshopAnim      = null;
  #tshopCanvas    = null;
  #currentStackGround = null;
  #roomUnits      = new Map();
  #mapFocused     = false;

  // Bound event handler references for removeEventListener
  #onWheel;
  #onPointerdown;
  #onPointermove;
  #onPointerup;
  #onPointercancel;
  #onContainerClick;
  #onKeydown;
  #onBlur;

  constructor($container, data, callbacks, savedZoom) {
    this.#container  = $container;
    this.#data       = data;
    this.#callbacks  = callbacks;
    this.#savedZoom  = savedZoom;

    this.#onWheel          = this.#handleWheel.bind(this);
    this.#onPointerdown    = this.#handlePointerdown.bind(this);
    this.#onPointermove    = this.#handlePointermove.bind(this);
    this.#onPointerup      = this.#handlePointerup.bind(this);
    this.#onPointercancel  = this.#handlePointercancel.bind(this);
    this.#onContainerClick = this.#handleContainerClick.bind(this);
    this.#onKeydown        = this.#handleKeydown.bind(this);
    this.#onBlur           = this.releaseFocus.bind(this);

    $container.addEventListener("wheel",        this.#onWheel, { passive: false });
    $container.addEventListener("pointerdown",  this.#onPointerdown);
    $container.addEventListener("pointermove",  this.#onPointermove);
    $container.addEventListener("pointerup",    this.#onPointerup);
    $container.addEventListener("pointercancel",this.#onPointercancel);
    $container.addEventListener("click",        this.#onContainerClick);
    window.addEventListener("keydown",          this.#onKeydown);
    window.addEventListener("blur",             this.#onBlur);
  }

  async load(mapId, centerX, centerY) {
    const meta = this.#data.maps[mapId];
    if (!meta) return;
    const gen = ++this.#loadGeneration;
    const { default: svgText } = await import(`./maps/${meta.file.replace(/\.\w+$/, ".js")}`);
    if (gen !== this.#loadGeneration) return;

    this.#stopTshopAnim();
    this.#svg = null;
    this.#currentStackGround = null;
    // Remove previous renderer content, preserve coordinator-owned overlays
    for (const child of [...this.#container.children]) {
      if (!child.classList.contains("lspace-overlay") &&
          !child.classList.contains("special-screen") &&
          !child.classList.contains("tooltip")) {
        child.remove();
      }
    }

    const wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;";
    wrap.innerHTML = svgText;
    this.#svg = wrap.querySelector("svg");
    ensureWarpDefs(this.#svg);
    const anchor = this.#container.querySelector(".lspace-overlay, .special-screen");
    this.#container.insertBefore(wrap, anchor);

    if (mapId === 53) this.#startTshopAnim();
    if (!this.#roomUnits.has(mapId)) {
      const unit = computeRoomUnit(this.#svg);
      if (unit) this.#roomUnits.set(mapId, unit);
    }

    if (this.#displayedMapId !== null && this.#viewBox.w > 0) {
      this.#persistZoom(this.#displayedMapId, this.#viewBox.w);
    }

    this.#displayedMapId = mapId;
    this.#resetZoom(mapId);
    if (this.#savedZoom.has(mapId)) {
      const ratio = this.#viewBox.h / this.#viewBox.w;
      this.#viewBox.w = this.#savedZoom.get(mapId);
      this.#viewBox.h = this.#viewBox.w * ratio;
    }

    this.centerOn(centerX, centerY);
    this.#wireTooltip();

    for (const [groundId, uppers] of Object.entries(groundToUppers)) {
      if (!this.#svg.querySelector(`#room-${CSS.escape(groundId)}`)) continue;
      for (const upperId of uppers) this.#setStackRoomVisible(upperId, false);
    }

    this.#callbacks.onMapLoaded(mapId);
  }

  applyState({ current, target, routeRoomIds, darkMode, libraryOverlay }) {
    if (!this.#svg) return;

    if (this.#displayedMapId === 99) {
      const dot = this.#svg.querySelector('#world-player');
      if (dot) {
        if (current) {
          dot.setAttribute('cx', current.x);
          dot.setAttribute('cy', current.y);
          dot.style.display = '';
        } else {
          dot.style.display = 'none';
        }
      }
      return;
    }

    const routeOv = this.#svg.querySelector("#sg-route-overlay");
    const posOv   = this.#svg.querySelector("#sg-pos-overlay");
    if (routeOv) _restoreOverlay(routeOv);
    if (posOv)   _restoreOverlay(posOv);

    this.#svg.querySelectorAll(".current, .target, .route").forEach(el => {
      el.classList.remove("current", "target", "route");
    });

    this.#updateStackVisibility(current?.roomId ?? null);

    const routeOverlay = _ensureOverlay(this.#svg, "sg-route-overlay");
    const posOverlay   = _ensureOverlay(this.#svg, "sg-pos-overlay");
    posOverlay.classList.toggle("dark", darkMode);

    for (let i = 0; i < routeRoomIds.length - 1; i++) {
      const [a, b] = [routeRoomIds[i], routeRoomIds[i + 1]].sort();
      const edge = this.#svg.querySelector(`#edge-${CSS.escape(a)}-${CSS.escape(b)}`);
      if (edge) { edge.classList.add("route"); _lift(edge, routeOverlay); }
    }
    for (const id of routeRoomIds) {
      const el = this.#svg.querySelector(`#room-${CSS.escape(id)}`);
      if (el) {
        el.classList.add("route");
        const sib1 = el.nextElementSibling;
        _lift(el, routeOverlay);
        if (sib1?.classList.contains("room-type-label")) _lift(sib1, routeOverlay);
        const stairEl = this.#svg.querySelector(`#stair-${CSS.escape(id)}`);
        if (stairEl) _lift(stairEl, routeOverlay);
      }
    }

    const primary = target ?? current;
    if (primary?.roomId) {
      const el = this.#svg.querySelector(`#room-${CSS.escape(primary.roomId)}`);
      if (el) {
        el.classList.add("target");
        const sib1 = el.nextElementSibling;
        _lift(el, posOverlay);
        if (sib1?.classList.contains("room-type-label")) _lift(sib1, posOverlay);
        const stairEl = this.#svg.querySelector(`#stair-${CSS.escape(primary.roomId)}`);
        if (stairEl) _lift(stairEl, posOverlay);
      }
    }

    if (target && current?.roomId && current.roomId !== target.roomId) {
      const el = this.#svg.querySelector(`#room-${CSS.escape(current.roomId)}`);
      if (el) {
        el.classList.add("current");
        const sib1 = el.nextElementSibling;
        _lift(el, posOverlay);
        if (sib1?.classList.contains("room-type-label")) _lift(sib1, posOverlay);
        const stairEl = this.#svg.querySelector(`#stair-${CSS.escape(current.roomId)}`);
        if (stairEl) _lift(stairEl, posOverlay);
      }
    }

    if (this.#displayedMapId === 47 && current?.mapId === 47) {
      this.#applyLibraryOverlay(current, libraryOverlay);
    }
  }

  handleResize() { /* SVG viewBox handles this automatically */ }

  destroy() {
    this.#stopTshopAnim();
    this.#container.removeEventListener("wheel",         this.#onWheel);
    this.#container.removeEventListener("pointerdown",   this.#onPointerdown);
    this.#container.removeEventListener("pointermove",   this.#onPointermove);
    this.#container.removeEventListener("pointerup",     this.#onPointerup);
    this.#container.removeEventListener("pointercancel", this.#onPointercancel);
    this.#container.removeEventListener("click",         this.#onContainerClick);
    window.removeEventListener("keydown", this.#onKeydown);
    window.removeEventListener("blur",    this.#onBlur);
    if (this.#mapFocused) panel.captureKeys(false);
    this.#svg?.closest("div")?.remove();
    this.#svg = null;
  }

  centerOn(x, y) {
    this.#viewBox.x = x - this.#viewBox.w / 2;
    this.#viewBox.y = y - this.#viewBox.h / 2;
    this.#applyViewBox();
  }

  zoomIn() {
    this.#viewBox.w /= ZOOM_FACTOR; this.#viewBox.h /= ZOOM_FACTOR; this.#applyViewBox();
  }

  zoomOut() {
    this.#viewBox.w *= ZOOM_FACTOR; this.#viewBox.h *= ZOOM_FACTOR; this.#applyViewBox();
  }

  pan(dir) {
    if (!this.#svg) return;
    const step = 0.2;
    if      (dir === 'n') this.#viewBox.y -= this.#viewBox.h * step;
    else if (dir === 's') this.#viewBox.y += this.#viewBox.h * step;
    else if (dir === 'w') this.#viewBox.x -= this.#viewBox.w * step;
    else if (dir === 'e') this.#viewBox.x += this.#viewBox.w * step;
    this.#applyViewBox();
  }

  zoom(dir) {
    if (!this.#svg) return;
    const factor = dir === 'in' ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    const newW = this.#viewBox.w * factor, newH = this.#viewBox.h * factor;
    this.#viewBox.x += 0.5 * (this.#viewBox.w - newW);
    this.#viewBox.y += 0.5 * (this.#viewBox.h - newH);
    this.#viewBox.w  = newW; this.#viewBox.h  = newH;
    this.#applyViewBox();
  }

  grabFocus() {
    this.#mapFocused = true;
    panel.captureKeys(true);
    this.#container.classList.add("focused");
    this.#container.focus();
  }

  releaseFocus() {
    this.#mapFocused = false;
    panel.captureKeys(false);
    this.#container.classList.remove("focused");
  }

  findRoomByLabel(name, mapId) {
    if (!this.#svg || mapId !== this.#displayedMapId) return null;
    const el = this.#svg.querySelector(`[data-label="${CSS.escape(name)}"]`);
    if (!el) return null;
    const cx = el.getAttribute('cx');
    const x  = cx !== null
      ? parseFloat(cx)
      : parseFloat(el.getAttribute('x') ?? 0) + parseFloat(el.getAttribute('width') ?? 0) / 2;
    const cy = el.getAttribute('cy');
    const y  = cy !== null
      ? parseFloat(cy)
      : parseFloat(el.getAttribute('y') ?? 0) + parseFloat(el.getAttribute('height') ?? 0) / 2;
    if (!isNaN(x) && !isNaN(y)) return { mapId, x, y, short: name };
    return null;
  }

  applyLibraryPosition(x, y) {
    if (!this.#svg) return;
    this.#svg.querySelector(".room.current")?.classList.remove("current");
    this.#svg.querySelector(`#room-lib-${x}-${y}`)?.classList.add("current");
    this.centerOn(x, y);
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  #applyViewBox() {
    if (!this.#svg) return;
    this.#svg.setAttribute("viewBox",
      `${this.#viewBox.x} ${this.#viewBox.y} ${this.#viewBox.w} ${this.#viewBox.h}`);
  }

  #defaultZoomW(mapId) {
    const meta = this.#data.maps[mapId];
    if (!meta) return 1;
    if (mapId === 47) return 280;
    if (mapId === 99) return meta.maxX / 2;
    const unit = this.#roomUnits.get(mapId);
    if (unit) return this.#container.clientWidth * unit / TARGET_PX;
    return meta.maxX / 4;
  }

  #resetZoom(mapId) {
    const ratio     = this.#container.clientHeight / Math.max(this.#container.clientWidth, 1);
    this.#viewBox.w = this.#defaultZoomW(mapId);
    this.#viewBox.h = this.#viewBox.w * ratio;
  }

  #persistZoom(mapId, w) {
    this.#savedZoom.set(mapId, w);
    this.#callbacks.onPersistZoom(mapId, w);
  }

  #setStackRoomVisible(id, visible) {
    const d = visible ? '' : 'none';
    const roomEl = this.#svg.querySelector(`#room-${CSS.escape(id)}`);
    if (roomEl) {
      roomEl.style.display = d;
      const sib = roomEl.nextElementSibling;
      if (sib?.classList.contains('room-type-label')) sib.style.display = d;
    }
    const stairEl = this.#svg.querySelector(`#stair-${CSS.escape(id)}`);
    if (stairEl) stairEl.style.display = d;
  }

  #updateStackVisibility(roomId) {
    if (!this.#svg) return;
    if (this.#currentStackGround) {
      this.#setStackRoomVisible(this.#currentStackGround, true);
      for (const u of groundToUppers[this.#currentStackGround] ?? [])
        this.#setStackRoomVisible(u, false);
      this.#currentStackGround = null;
    }
    if (!roomId) return;
    const ground = upperToGround[roomId];
    if (ground) {
      this.#setStackRoomVisible(ground, false);
      this.#setStackRoomVisible(roomId, true);
      this.#currentStackGround = ground;
    }
  }

  #wireTooltip() {
    if (!this.#svg) return;
    this.#svg.addEventListener("pointermove", (e) => {
      const roomEl    = e.target.closest(".room");
      const label     = roomEl?.dataset.label ?? "";
      const typeKey   = [...(roomEl?.classList ?? [])].map(c => c.startsWith("room-") ? c.slice(5) : null).find(k => k && ROOM_TYPE_LABELS[k]);
      const typeLabel = typeKey ? ROOM_TYPE_LABELS[typeKey] : null;
      if (label || typeLabel) {
        const spec = {};
        if (label)     spec.title = label;
        if (typeLabel) spec.body  = typeLabel;
        panel.tooltip.show({ x: e.clientX, y: e.clientY, width: 0, height: 0 }, spec);
      } else {
        panel.tooltip.hide();
      }
    });
    this.#svg.addEventListener("pointerleave", () => { panel.tooltip.hide(); });
  }

  #applyLibraryOverlay(current, libraryOverlay) {
    const cx = current.x, cy = current.y, half = 15;
    const distEl = this.#svg.querySelector("#lib-distortion");
    const orbEl  = this.#svg.querySelector("#lib-orb");
    const arrEl  = this.#svg.querySelector("#lib-arrow");
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

  #startTshopAnim() {
    this.#stopTshopAnim();
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;";
    document.body.appendChild(canvas);
    this.#tshopCanvas = canvas;
    const particles = [];
    const ctx = canvas.getContext("2d");
    const HS_MAX = 80, HS_SPAWN = 0.35, HS_ACCEL = 1.015;
    const frame = () => {
      if (!canvas.isConnected) { this.#tshopAnim = null; this.#tshopCanvas = null; return; }
      this.#tshopAnim = requestAnimationFrame(frame);
      const cw = window.innerWidth, ch = window.innerHeight;
      if (!cw || !ch) return;
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      ctx.clearRect(0, 0, cw, ch);
      const ocx = cw / 2, ocy = ch / 2;
      const maxDist = Math.max(
        Math.hypot(ocx, ocy), Math.hypot(cw - ocx, ocy),
        Math.hypot(ocx, ch - ocy), Math.hypot(cw - ocx, ch - ocy)
      ) * 1.05;
      const fadeDist = maxDist * 0.75;
      const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#ffffff";
      if (particles.length < HS_MAX && Math.random() < HS_SPAWN) {
        particles.push({ angle: Math.random() * Math.PI * 2, dist: 0, speed: 0.5 + Math.random() * 0.8 });
      }
      ctx.strokeStyle = fg; ctx.lineCap = "round";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const prev = p.dist;
        p.speed *= HS_ACCEL; p.dist += p.speed;
        if (p.dist >= maxDist) { particles.splice(i, 1); continue; }
        const opacity = p.dist < 15 ? p.dist / 15
          : p.dist > fadeDist ? 1 - (p.dist - fadeDist) / (maxDist - fadeDist) : 1;
        const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
        ctx.globalAlpha = opacity * 0.75;
        ctx.lineWidth   = Math.max(0.5, p.speed * 0.15);
        ctx.beginPath();
        ctx.moveTo(ocx + cos * prev,   ocy + sin * prev);
        ctx.lineTo(ocx + cos * p.dist, ocy + sin * p.dist);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    this.#tshopAnim = requestAnimationFrame(frame);
  }

  #stopTshopAnim() {
    if (this.#tshopAnim === null) return;
    cancelAnimationFrame(this.#tshopAnim);
    this.#tshopAnim = null;
    if (this.#tshopCanvas) { this.#tshopCanvas.remove(); this.#tshopCanvas = null; }
  }

  // ─── Event handlers ──────────────────────────────────────────────────────

  #handleWheel(e) {
    if (!this.#svg) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const newW = this.#viewBox.w * factor, newH = this.#viewBox.h * factor;
    this.#viewBox.x += 0.5 * (this.#viewBox.w - newW);
    this.#viewBox.y += 0.5 * (this.#viewBox.h - newH);
    this.#viewBox.w  = newW; this.#viewBox.h  = newH;
    this.#applyViewBox();
  }

  #handlePointerdown(e) {
    if (!this.#svg) return;
    const roomEl = e.target.closest(".room");
    if (e.button === 1) {
      e.preventDefault();
      this.#drag = { screenX: e.clientX, screenY: e.clientY, vbX: this.#viewBox.x, vbY: this.#viewBox.y };
      this.#container.setPointerCapture(e.pointerId);
    } else if (e.button === 0 && !roomEl) {
      this.#drag = { screenX: e.clientX, screenY: e.clientY, vbX: this.#viewBox.x, vbY: this.#viewBox.y };
      this.#container.setPointerCapture(e.pointerId);
    } else if (e.button === 0 && roomEl && this.#displayedMapId !== 99) {
      this.#pendingClick = { el: roomEl, startX: e.clientX, startY: e.clientY };
      this.#container.setPointerCapture(e.pointerId);
    }
  }

  #handlePointermove(e) {
    if (this.#drag) {
      const rect = this.#container.getBoundingClientRect();
      this.#viewBox.x = this.#drag.vbX - (e.clientX - this.#drag.screenX) / rect.width  * this.#viewBox.w;
      this.#viewBox.y = this.#drag.vbY - (e.clientY - this.#drag.screenY) / rect.height * this.#viewBox.h;
      this.#applyViewBox();
    } else if (this.#pendingClick) {
      const dx = e.clientX - this.#pendingClick.startX;
      const dy = e.clientY - this.#pendingClick.startY;
      if (Math.hypot(dx, dy) > 4) this.#pendingClick = null;
    }
  }

  #handlePointerup() {
    if (this.#pendingClick) {
      const el = this.#pendingClick.el;
      const roomId = el.id.slice(5);
      const name   = el.dataset.label ?? "";
      this.#callbacks.onRoomClick(roomId, name);
    }
    this.#drag = null;
    this.#pendingClick = null;
  }

  #handlePointercancel() {
    this.#drag = null;
    this.#pendingClick = null;
  }

  #handleContainerClick() {
    if (!this.#mapFocused) this.grabFocus();
  }

  #handleKeydown(e) {
    if (!this.#mapFocused || !this.#svg) return;
    switch (e.key) {
      case "ArrowUp":    this.#viewBox.y -= this.#viewBox.h * 0.2; this.#applyViewBox(); break;
      case "ArrowDown":  this.#viewBox.y += this.#viewBox.h * 0.2; this.#applyViewBox(); break;
      case "ArrowLeft":  this.#viewBox.x -= this.#viewBox.w * 0.2; this.#applyViewBox(); break;
      case "ArrowRight": this.#viewBox.x += this.#viewBox.w * 0.2; this.#applyViewBox(); break;
      case "+": case "=": { const nw = this.#viewBox.w / ZOOM_FACTOR, nh = this.#viewBox.h / ZOOM_FACTOR;
        this.#viewBox.x += 0.5 * (this.#viewBox.w - nw); this.#viewBox.y += 0.5 * (this.#viewBox.h - nh);
        this.#viewBox.w = nw; this.#viewBox.h = nh; this.#applyViewBox(); break; }
      case "-": { const nw = this.#viewBox.w * ZOOM_FACTOR, nh = this.#viewBox.h * ZOOM_FACTOR;
        this.#viewBox.x += 0.5 * (this.#viewBox.w - nw); this.#viewBox.y += 0.5 * (this.#viewBox.h - nh);
        this.#viewBox.w = nw; this.#viewBox.h = nh; this.#applyViewBox(); break; }
      case "0": {
        this.#callbacks.onZoomReset?.();
        break; }
      case "Escape": this.releaseFocus(); break;
      default: return;
    }
    e.preventDefault();
  }
}
