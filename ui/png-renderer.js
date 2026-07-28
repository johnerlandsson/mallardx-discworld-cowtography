import { PNG_ZOOM_FACTOR, PNG_MAX_SCALE, PNG_TARGET_PX } from "./png-renderer/constants.js";
import { findNearestRoom, computeRoomUnit } from "./png-renderer/geometry.js";
import { drawLibraryOverlay } from "./png-renderer/library-overlay.js";

export { LIB_ORB_RADIUS } from "./png-renderer/constants.js";
export { findNearestRoom };
export { libraryArrowPoints, libraryDistortionRect } from "./png-renderer/library-overlay.js";

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
  #everLoaded    = false;
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
    this.#mapId    = mapId;
    this.#roomUnit = computeRoomUnit(this.#data.rooms, mapId);

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

    const fit   = this.#fitScale();
    const saved = this.#savedScales.get(mapId);
    this.#scale = saved !== undefined ? Math.max(fit, saved) : this.#defaultScale(fit);
    this.#applyDimensions();
    if (centerX != null && centerY != null) this.centerOn(centerX, centerY);

    this.#callbacks.onMapLoaded(mapId);
    // Suppress the position dot on exactly one draw: the very first after this
    // renderer instance is created (panel reload, before fresh GMCP state
    // arrives). Only arm this on the renderer's first-ever load — otherwise
    // every ordinary map switch during play re-armed it too, and since a
    // normal move's room_info frequently has target === null, the dot (and
    // the rest of the draw) silently got skipped until the next move.
    if (!this.#everLoaded) {
      this.#mapJustLoaded = true;
      this.#everLoaded    = true;
    }
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

  // Default zoom for a map with no saved user preference: target a fixed
  // on-screen room spacing (mirrors svg-renderer.js's #defaultZoomW), rather
  // than always fitting the whole map — never zooms out past fit, only in.
  #defaultScale(fit) {
    if (!this.#roomUnit) return fit;
    return Math.max(fit, Math.min(PNG_MAX_SCALE, PNG_TARGET_PX / this.#roomUnit));
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

  #drawState({ current, target, routeRoomIds, libraryOverlay }) {
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

    // Target position (predicted next room, when prediction active and different from confirmed)
    if (target && current?.roomId && current.roomId !== target.roomId) {
      const room = rooms[target.roomId];
      if (room && room[0] === mapId) {
        ctx.beginPath();
        ctx.arc(toCanvasX(room[1]), toCanvasY(room[2]), ghostR, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(136, 136, 136, 0.6)";
        ctx.fill();
      }
    }

    const dotColor = "#e03030";
    const currentRoom = current?.roomId ? rooms[current.roomId] : null;
    const drawDot = (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, scaleX * 1.5);
      ctx.stroke();
    };
    if (currentRoom && currentRoom[0] === mapId) {
      drawDot(toCanvasX(currentRoom[1]), toCanvasY(currentRoom[2]));
    } else if (current && current.x != null) {
      drawDot(toCanvasX(current.x), toCanvasY(current.y));
    }

    if (mapId === 47 && current?.mapId === 47 && libraryOverlay) {
      drawLibraryOverlay(ctx, toCanvasX(current.x), toCanvasY(current.y), scaleX, libraryOverlay);
    }
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
