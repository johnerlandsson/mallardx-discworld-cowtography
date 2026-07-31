import { PNG_ZOOM_FACTOR } from "./constants.js";
import { findNearestRoom, computeRoomUnit } from "./geometry.js";
import { fitScale, defaultScale, clampScale, applyImageSize, scrollToCenter } from "./scale.js";
import { drawState } from "./draw-state.js";

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
    this.#scale = saved !== undefined ? Math.max(fit, saved) : defaultScale(fit, this.#roomUnit);
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
    scrollToCenter(this.#container, this.#scale, x, y);
  }
  pan()          {}
  grabFocus()    {}
  releaseFocus() {}

  roomAtPoint(e) {
    if (!this.#img || this.#mapId === 99 || !this.#wrap?.contains(e.target)) return null;
    const rect = this.#img.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (this.#img.naturalWidth  / rect.width);
    const py = (e.clientY - rect.top)  * (this.#img.naturalHeight / rect.height);
    const roomId = findNearestRoom(this.#data.rooms, this.#mapId, px, py);
    if (!roomId) return null;
    const room = this.#data.rooms[roomId];
    return { roomId, name: room?.[3] ?? "" };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  #fitScale() {
    return fitScale(this.#img, this.#container);
  }

  #setScale(v) {
    this.#scale = clampScale(this.#fitScale(), v);
    this.#applyDimensions();
  }

  #applyDimensions() {
    if (!this.#img?.naturalWidth) return;
    if (this.#mapId !== null) this.#savedScales.set(this.#mapId, this.#scale);
    applyImageSize(this.#img, this.#scale);
    if (this.#lastState) this.#drawState(this.#lastState);
  }

  #drawState(state) {
    this.#mapJustLoaded = drawState(
      this.#img, this.#canvas, this.#data.rooms, this.#mapId, this.#roomUnit,
      state, this.#mapJustLoaded,
    );
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
    const newScale = clampScale(this.#fitScale(), this.#scale * factor);
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
