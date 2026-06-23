const PNG_CLICK_THRESHOLD = 20;  // px — max distance to nearest room for a click to register

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
  supportsZoom    = false;
  supportsFilters = false;

  #container;
  #data;
  #callbacks;

  #img       = null;
  #canvas    = null;
  #wrap      = null;
  #mapId     = null;
  #lastState = null;

  #pendingClick = null;
  #onPointerdown;
  #onPointermove;
  #onPointerup;
  #onPointercancel;

  constructor($container, data, callbacks) {
    this.#container = $container;
    this.#data      = data;
    this.#callbacks = callbacks;

    this.#onPointerdown   = this.#handlePointerdown.bind(this);
    this.#onPointermove   = this.#handlePointermove.bind(this);
    this.#onPointerup     = this.#handlePointerup.bind(this);
    this.#onPointercancel = this.#handlePointercancel.bind(this);
  }

  async load(mapId, _centerX, _centerY) {
    const meta = this.#data.maps[mapId];
    if (!meta) return;

    // Remove previous content (preserves coordinator-owned overlays)
    this.#img = null; this.#canvas = null;
    if (this.#wrap) {
      this.#wrap.removeEventListener("pointerdown",   this.#onPointerdown);
      this.#wrap.removeEventListener("pointermove",   this.#onPointermove);
      this.#wrap.removeEventListener("pointerup",     this.#onPointerup);
      this.#wrap.removeEventListener("pointercancel", this.#onPointercancel);
      this.#wrap.remove();
      this.#wrap = null;
    }

    this.#mapId = mapId;

    const img = document.createElement("img");
    img.className = "png-map-img";
    img.style.cssText = "display:block;max-width:100%;max-height:100%;object-fit:contain;";
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

    const anchor = this.#container.querySelector(".lspace-overlay, .special-screen");
    this.#container.insertBefore(wrap, anchor);

    await new Promise((resolve, reject) => {
      img.onload  = resolve;
      img.onerror = () => reject(new Error(`Failed to load PNG: ${img.src}`));
    });

    this.#callbacks.onMapLoaded(mapId);
  }

  applyState(state) {
    this.#lastState = state;
    this.#drawState(state);
  }

  handleResize() {
    if (this.#lastState) this.#drawState(this.#lastState);
  }

  destroy() {
    if (!this.#wrap) return;
    this.#wrap.removeEventListener("pointerdown",   this.#onPointerdown);
    this.#wrap.removeEventListener("pointermove",   this.#onPointermove);
    this.#wrap.removeEventListener("pointerup",     this.#onPointerup);
    this.#wrap.removeEventListener("pointercancel", this.#onPointercancel);
    this.#wrap.remove();
    this.#wrap = null; this.#img = null; this.#canvas = null;
  }

  // No-op methods to satisfy the interface when coordinator calls these unconditionally:
  centerOn()            {}
  zoomIn()              {}
  zoomOut()             {}
  pan()                 {}
  zoom()                {}
  grabFocus()           {}
  releaseFocus()        {}

  // ─── Private helpers ─────────────────────────────────────────────────────

  #drawState({ current, target, routeRoomIds }) {
    if (!this.#img || !this.#canvas) return;
    const w = this.#img.clientWidth, h = this.#img.clientHeight;
    if (!w || !h) return;
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

    // Route rooms — blue circles
    for (const id of routeRoomIds) {
      const room = rooms[id];
      if (!room || room[0] !== mapId) continue;
      ctx.beginPath();
      ctx.arc(toCanvasX(room[1]), toCanvasY(room[2]), 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(74, 159, 212, 0.8)";
      ctx.fill();
    }

    // Ghost position (when prediction active and different from confirmed)
    if (target && current?.roomId && current.roomId !== target.roomId) {
      const room = rooms[current.roomId];
      if (room && room[0] === mapId) {
        ctx.beginPath();
        ctx.arc(toCanvasX(room[1]), toCanvasY(room[2]), 7, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(136, 136, 136, 0.6)";
        ctx.fill();
      }
    }

    // Player position — yellow dot with white ring
    const primary = target ?? current;
    const primaryRoom = primary?.roomId ? rooms[primary.roomId] : null;
    if (primary && !primary.roomId) {
      // Position by x/y coords (no roomId, e.g. library or name-based fallback)
      ctx.beginPath();
      ctx.arc(toCanvasX(primary.x), toCanvasY(primary.y), 8, 0, Math.PI * 2);
      ctx.fillStyle = "#e0e040";
      ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      ctx.stroke();
    } else if (primaryRoom && primaryRoom[0] === mapId) {
      ctx.beginPath();
      ctx.arc(toCanvasX(primaryRoom[1]), toCanvasY(primaryRoom[2]), 8, 0, Math.PI * 2);
      ctx.fillStyle = "#e0e040";
      ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  #handlePointerdown(e) {
    if (e.button !== 0) return;
    this.#pendingClick = { startX: e.clientX, startY: e.clientY };
    this.#wrap.setPointerCapture(e.pointerId);
  }

  #handlePointermove(e) {
    if (!this.#pendingClick) return;
    const dx = e.clientX - this.#pendingClick.startX;
    const dy = e.clientY - this.#pendingClick.startY;
    if (Math.hypot(dx, dy) > 4) this.#pendingClick = null;
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
  }

  #handlePointercancel() {
    this.#pendingClick = null;
  }
}
