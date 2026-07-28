import { PNG_MAX_SCALE, PNG_TARGET_PX } from "./constants.js";

export function fitScale(img, container) {
  if (!img?.naturalWidth) return 1;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (!cw || !ch) return 1;
  return Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
}

// Default zoom for a map with no saved user preference: target a fixed
// on-screen room spacing (mirrors svg-renderer.js's #defaultZoomW), rather
// than always fitting the whole map — never zooms out past fit, only in.
export function defaultScale(fit, roomUnit) {
  if (!roomUnit) return fit;
  return Math.max(fit, Math.min(PNG_MAX_SCALE, PNG_TARGET_PX / roomUnit));
}

export function clampScale(fit, desired) {
  return Math.max(fit, Math.min(PNG_MAX_SCALE, desired));
}

export function applyImageSize(img, scale) {
  const w = Math.round(img.naturalWidth  * scale);
  const h = Math.round(img.naturalHeight * scale);
  img.style.width  = `${w}px`;
  img.style.height = `${h}px`;
}

export function scrollToCenter(container, scale, x, y) {
  container.scrollLeft = Math.max(0, x * scale - container.clientWidth  / 2);
  container.scrollTop  = Math.max(0, y * scale - container.clientHeight / 2);
}
