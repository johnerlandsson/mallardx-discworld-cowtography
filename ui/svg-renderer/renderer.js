import { groundToUppers } from "../data/room-stacks.js";
import { ZOOM_FACTOR } from "./constants.js";
import { computeRoomUnit, ensureWarpDefs } from "./geometry.js";
import { setStackRoomVisible } from "./stack-visibility.js";
import { applyStateImpl } from "./apply-state.js";
import { wireTooltip } from "./tooltip.js";
import { startTshopAnim, stopTshopAnim } from "./tshop-animation.js";
import {
  applyViewBox, centerViewBox, scaleViewBox, panViewBox, zoomViewBox,
  resetZoomDimensions, persistZoom,
} from "./viewbox.js";

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
  #tshopAnim      = null; // { anim, canvas } handle from tshop-animation.js, or null
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
    const { default: svgText } = await import(`../maps/${meta.file.replace(/\.\w+$/, ".js")}`);
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
      persistZoom(this.#savedZoom, this.#callbacks, this.#displayedMapId, this.#viewBox.w);
    }

    this.#displayedMapId = mapId;
    {
      const { w, h } = resetZoomDimensions(this.#container, mapId, this.#data, this.#roomUnits);
      this.#viewBox.w = w; this.#viewBox.h = h;
    }
    if (this.#savedZoom.has(mapId)) {
      const ratio = this.#viewBox.h / this.#viewBox.w;
      this.#viewBox.w = this.#savedZoom.get(mapId);
      this.#viewBox.h = this.#viewBox.w * ratio;
    }

    this.centerOn(centerX, centerY);
    wireTooltip(this.#svg);

    for (const [groundId, uppers] of Object.entries(groundToUppers)) {
      if (!this.#svg.querySelector(`#room-${CSS.escape(groundId)}`)) continue;
      for (const upperId of uppers) setStackRoomVisible(this.#svg, upperId, false);
    }

    this.#callbacks.onMapLoaded(mapId);
  }

  applyState(state) {
    if (!this.#svg) return;
    this.#currentStackGround = applyStateImpl(this.#svg, this.#displayedMapId, state, this.#currentStackGround);
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
    centerViewBox(this.#viewBox, x, y);
    applyViewBox(this.#svg, this.#viewBox);
  }

  zoomIn() {
    scaleViewBox(this.#viewBox, 1 / ZOOM_FACTOR); applyViewBox(this.#svg, this.#viewBox);
  }

  zoomOut() {
    scaleViewBox(this.#viewBox, ZOOM_FACTOR); applyViewBox(this.#svg, this.#viewBox);
  }

  pan(dir) {
    if (!this.#svg) return;
    panViewBox(this.#viewBox, dir);
    applyViewBox(this.#svg, this.#viewBox);
  }

  zoom(dir) {
    if (!this.#svg) return;
    const factor = dir === 'in' ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    zoomViewBox(this.#viewBox, factor);
    applyViewBox(this.#svg, this.#viewBox);
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

  #startTshopAnim() {
    this.#stopTshopAnim();
    this.#tshopAnim = startTshopAnim();
  }

  #stopTshopAnim() {
    stopTshopAnim(this.#tshopAnim);
    this.#tshopAnim = null;
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
    applyViewBox(this.#svg, this.#viewBox);
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
      applyViewBox(this.#svg, this.#viewBox);
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
      case "ArrowUp":    this.#viewBox.y -= this.#viewBox.h * 0.2; applyViewBox(this.#svg, this.#viewBox); break;
      case "ArrowDown":  this.#viewBox.y += this.#viewBox.h * 0.2; applyViewBox(this.#svg, this.#viewBox); break;
      case "ArrowLeft":  this.#viewBox.x -= this.#viewBox.w * 0.2; applyViewBox(this.#svg, this.#viewBox); break;
      case "ArrowRight": this.#viewBox.x += this.#viewBox.w * 0.2; applyViewBox(this.#svg, this.#viewBox); break;
      case "+": case "=": { const nw = this.#viewBox.w / ZOOM_FACTOR, nh = this.#viewBox.h / ZOOM_FACTOR;
        this.#viewBox.x += 0.5 * (this.#viewBox.w - nw); this.#viewBox.y += 0.5 * (this.#viewBox.h - nh);
        this.#viewBox.w = nw; this.#viewBox.h = nh; applyViewBox(this.#svg, this.#viewBox); break; }
      case "-": { const nw = this.#viewBox.w * ZOOM_FACTOR, nh = this.#viewBox.h * ZOOM_FACTOR;
        this.#viewBox.x += 0.5 * (this.#viewBox.w - nw); this.#viewBox.y += 0.5 * (this.#viewBox.h - nh);
        this.#viewBox.w = nw; this.#viewBox.h = nh; applyViewBox(this.#svg, this.#viewBox); break; }
      case "0": {
        this.#callbacks.onZoomReset?.();
        break; }
      case "Escape": this.releaseFocus(); break;
      default: return;
    }
    e.preventDefault();
  }
}
