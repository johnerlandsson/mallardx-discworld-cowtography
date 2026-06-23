const PNG_CLICK_THRESHOLD = 20;  // px — max distance to nearest room for a click to register
const PNG_ZOOM_FACTOR = 1.25;
const PNG_MAX_SCALE   = 8;

export function findNearestRoom(rooms, mapId, px, py) {
  let bestId = null, bestDist = Infinity;
  for (const [id, room] of Object.entries(rooms)) {
    if (room[0] !== mapId) continue;
    const d = Math.hypot(px - room[1], py - room[2]);
    if (d < bestDist) { bestDist = d; bestId = id; }
  }
  return bestDist <= PNG_CLICK_THRESHOLD ? bestId : null;
}

export class PngRenderer {
  supportsZoom    = true;
  supportsFilters = false;

  #container;
  #data;
  #callbacks;

  #img         = null;
  #canvas      = null;
  #wrap        = null;
  #mapId       = null;
  #lastState   = null;
  #scale       = 1;
  #savedScales = new Map();
  #savedOverflow = '';

  #mapJustLoaded = false;
  #roomUnit      = null;

  #pendingClick = null;
  #isDragging   = false;
  #lastMovePos  = null;
  #onPointerdown;
  #onPointermove;
  #onPointerup;
  #onPointercancel;
  #onWheel;

  constructor($container, data, callbacks) {
    this.#container = $container;
    this.#data      = data;
    this.#callbacks = callbacks;
    this.#savedOverflow = $container.style.overflow;
    $container.style.overflow = 'auto';

    this.#onPointerdown   = this.#handlePointerdown.bind(this);
    this.#onPointermove   = this.#handlePointermove.bind(this);
    this.#onPointerup     = this.#handlePointerup.bind(this);
    this.#onPointercancel = this.#handlePointercancel.bind(this);
    this.#onWheel         = this.#handleWheel.bind(this);
  }

  async load(mapId, centerX, centerY) {
    const meta = this.#data.maps[mapId];
    if (!meta) return;

    // Remove previous content (preserves coordinator-owned overlays)
    this.#img = null; this.#canvas = null;
    if (this.#wrap) {
      this.#wrap.removeEventListener("pointerdown",   this.#onPointerdown);
      this.#wrap.removeEventListener("pointermove",   this.#onPointermove);
      this.#wrap.removeEventListener("pointerup",     this.#onPointerup);
      this.#wrap.removeEventListener("pointercancel", this.#onPointercancel);
      this.#container.removeEventListener("wheel",    this.#onWheel);
      this.#wrap.remove();
      this.#wrap = null;
    }

    if (this.#mapId !== null) this.#savedScales.set(this.#mapId, this.#scale);
    this.#mapId = mapId;

    const img = document.createElement("img");
    img.className  = "png-map-img";
    img.draggable  = false;
    img.style.cssText = "display:block;image-rendering:pixelated;";
    img.src = `maps/${meta.file}`;

    const canvas = document.createElement("canvas");
    canvas.className = "png-map-canvas";
    canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;";

    const wrap = document.createElement("div");
    wrap.className = "png-map-wrap";
    wrap.style.cssText = "position:relative;display:inline-block;";
    wrap.appendChild(img);
    wrap.appendChild(canvas);

    this.#img    = img;
    this.#canvas = canvas;
    this.#wrap   = wrap;

    wrap.addEventListener("pointerdown",   this.#onPointerdown);
    wrap.addEventListener("pointermove",   this.#onPointermove);
    wrap.addEventListener("pointerup",     this.#onPointerup);
    wrap.addEventListener("pointercancel", this.#onPointercancel);
    this.#container.addEventListener("wheel", this.#onWheel, { passive: false });

    const anchor = this.#container.querySelector(".lspace-overlay, .special-screen");
    this.#container.insertBefore(wrap, anchor);

    await new Promise((resolve, reject) => {
      img.onload  = resolve;
      img.onerror = () => reject(new Error(`Failed to load PNG: ${img.src}`));
    });

    const fit = this.#fitScale();
    const saved = this.#savedScales.get(mapId);
    this.#scale = saved !== undefined ? Math.max(fit, saved) : fit;
    this.#applyDimensions();
    if (centerX != null && centerY != null) this.centerOn(centerX, centerY);

    this.#roomUnit = this.#computeRoomUnit(mapId);
    this.#callbacks.onMapLoaded(mapId);
    this.#mapJustLoaded = true;
  }

  applyState(state) {
    this.#lastState = state;
    this.#drawState(state);
  }

  handleResize() {
    if (!this.#img?.naturalWidth) return;
    const fit = this.#fitScale();
    if (this.#scale <= fit * 1.01) this.#scale = fit;
    this.#applyDimensions();
  }

  destroy() {
    this.#container.style.overflow = this.#savedOverflow;
    if (!this.#wrap) return;
    this.#wrap.removeEventListener("pointerdown",   this.#onPointerdown);
    this.#wrap.removeEventListener("pointermove",   this.#onPointermove);
    this.#wrap.removeEventListener("pointerup",     this.#onPointerup);
    this.#wrap.removeEventListener("pointercancel", this.#onPointercancel);
    this.#container.removeEventListener("wheel",    this.#onWheel);
    this.#wrap.remove();
    this.#wrap = null; this.#img = null; this.#canvas = null;
  }

  zoomIn()       { this.#setScale(this.#scale * PNG_ZOOM_FACTOR); }
  zoomOut()      { this.#setScale(this.#scale / PNG_ZOOM_FACTOR); }
  zoom(factor)   { this.#setScale(this.#scale * factor); }
  centerOn(x, y) {
    if (!this.#img) return;
    this.#container.scrollLeft = Math.max(0, x * this.#scale - this.#container.clientWidth  / 2);
    this.#container.scrollTop  = Math.max(0, y * this.#scale - this.#container.clientHeight / 2);
  }
  pan()          {}
  grabFocus()    {}
  releaseFocus() {}

  // ─── Private helpers ─────────────────────────────────────────────────────

  #fitScale() {
    if (!this.#img?.naturalWidth) return 1;
    const cw = this.#container.clientWidth;
    const ch = this.#container.clientHeight;
    if (!cw || !ch) return 1;
    return Math.min(cw / this.#img.naturalWidth, ch / this.#img.naturalHeight);
  }

  #setScale(v) {
    this.#scale = Math.max(this.#fitScale(), Math.min(PNG_MAX_SCALE, v));
    this.#applyDimensions();
  }

  #applyDimensions() {
    if (!this.#img?.naturalWidth) return;
    if (this.#mapId !== null) this.#savedScales.set(this.#mapId, this.#scale);
    const w = Math.round(this.#img.naturalWidth  * this.#scale);
    const h = Math.round(this.#img.naturalHeight * this.#scale);
    this.#img.style.width  = `${w}px`;
    this.#img.style.height = `${h}px`;
    if (this.#lastState) this.#drawState(this.#lastState);
  }

  #drawState({ current, target, routeRoomIds }) {
    if (!this.#img || !this.#canvas) return;
    const w = this.#img.clientWidth, h = this.#img.clientHeight;
    if (!w || !h) return;
    // Suppress yellow dot on the first draw after map load (plugin reload case).
    // Once the player moves (target set) or after the first stationary draw, show normally.
    if (this.#mapJustLoaded) {
      this.#mapJustLoaded = false;
      if (target === null) return;
    }
    if (this.#canvas.width !== w)  this.#canvas.width  = w;
    if (this.#canvas.height !== h) this.#canvas.height = h;

    const scaleX = w / this.#img.naturalWidth;
    const scaleY = h / this.#img.naturalHeight;
    const toCanvasX = (px) => px * scaleX;
    const toCanvasY = (py) => py * scaleY;

    const ctx = this.#canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    const rooms = this.#data.rooms;
    const mapId = this.#mapId;

    const dotR   = this.#roomUnit != null ? Math.max(2, this.#roomUnit * 0.3) * scaleX : 8;
    const ghostR = dotR * 0.85;
    const routeR = dotR * 0.65;

    // Route rooms — blue circles
    for (const id of routeRoomIds) {
      const room = rooms[id];
      if (!room || room[0] !== mapId) continue;
      ctx.beginPath();
      ctx.arc(toCanvasX(room[1]), toCanvasY(room[2]), routeR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(74, 159, 212, 0.8)";
      ctx.fill();
    }

    // Ghost position (when prediction active and different from confirmed)
    if (target && current?.roomId && current.roomId !== target.roomId) {
      const room = rooms[current.roomId];
      if (room && room[0] === mapId) {
        ctx.beginPath();
        ctx.arc(toCanvasX(room[1]), toCanvasY(room[2]), ghostR, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(136, 136, 136, 0.6)";
        ctx.fill();
      }
    }

    const primary  = target ?? current;
    const dotColor = "#e03030";
    const primaryRoom = primary?.roomId ? rooms[primary.roomId] : null;
    const drawDot = (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, scaleX * 1.5);
      ctx.stroke();
    };
    if (primary && !primary.roomId) {
      drawDot(toCanvasX(primary.x), toCanvasY(primary.y));
    } else if (primaryRoom && primaryRoom[0] === mapId) {
      drawDot(toCanvasX(primaryRoom[1]), toCanvasY(primaryRoom[2]));
    }
  }

  #computeRoomUnit(mapId) {
    const pts = [];
    for (const room of Object.values(this.#data.rooms)) {
      if (room[0] === mapId) pts.push([room[1], room[2]]);
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
    if (!dists.length) return null;
    dists.sort((a, b) => a - b);
    return dists[Math.floor(dists.length / 2)];
  }

  #handlePointerdown(e) {
    if (e.button !== 0) return;
    this.#pendingClick = { startX: e.clientX, startY: e.clientY };
    this.#isDragging   = false;
    this.#lastMovePos  = { x: e.clientX, y: e.clientY };
    this.#container.style.cursor = "grab";
    this.#wrap.setPointerCapture(e.pointerId);
  }

  #handlePointermove(e) {
    if (!this.#lastMovePos) return;

    if (!this.#isDragging && this.#pendingClick) {
      const dx = e.clientX - this.#pendingClick.startX;
      const dy = e.clientY - this.#pendingClick.startY;
      if (Math.hypot(dx, dy) > 4) {
        this.#pendingClick = null;
        this.#isDragging   = true;
        this.#container.style.cursor = "grabbing";
      }
    }

    if (this.#isDragging) {
      this.#container.scrollLeft -= e.clientX - this.#lastMovePos.x;
      this.#container.scrollTop  -= e.clientY - this.#lastMovePos.y;
    }

    this.#lastMovePos = { x: e.clientX, y: e.clientY };
  }

  #handlePointerup(e) {
    if (this.#pendingClick && this.#img) {
      const rect = this.#img.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (this.#img.naturalWidth  / rect.width);
      const py = (e.clientY - rect.top)  * (this.#img.naturalHeight / rect.height);
      const roomId = findNearestRoom(this.#data.rooms, this.#mapId, px, py);
      if (roomId) {
        const room = this.#data.rooms[roomId];
        this.#callbacks.onRoomClick(roomId, room?.[3] ?? "");
      }
    }
    this.#pendingClick = null;
    this.#isDragging   = false;
    this.#lastMovePos  = null;
    this.#container.style.cursor = "";
  }

  #handlePointercancel() {
    this.#pendingClick = null;
    this.#isDragging   = false;
    this.#lastMovePos  = null;
    this.#container.style.cursor = "";
  }

  #handleWheel(e) {
    if (!this.#img?.naturalWidth) return;
    e.preventDefault();

    const factor   = e.deltaY < 0 ? PNG_ZOOM_FACTOR : 1 / PNG_ZOOM_FACTOR;
    const oldScale = this.#scale;
    const newScale = Math.max(this.#fitScale(), Math.min(PNG_MAX_SCALE, this.#scale * factor));
    if (newScale === oldScale) return;

    // Zoom toward cursor
    const rect    = this.#container.getBoundingClientRect();
    const cursorX = e.clientX - rect.left + this.#container.scrollLeft;
    const cursorY = e.clientY - rect.top  + this.#container.scrollTop;

    this.#scale = newScale;
    this.#applyDimensions();

    this.#container.scrollLeft = cursorX * (newScale / oldScale) - (e.clientX - rect.left);
    this.#container.scrollTop  = cursorY * (newScale / oldScale) - (e.clientY - rect.top);
  }
}
