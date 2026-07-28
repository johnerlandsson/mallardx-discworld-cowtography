import { TARGET_PX } from "./constants.js";

export function applyViewBox(svg, viewBox) {
  if (!svg) return;
  svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

export function centerViewBox(viewBox, x, y) {
  viewBox.x = x - viewBox.w / 2;
  viewBox.y = y - viewBox.h / 2;
}

export function scaleViewBox(viewBox, factor) {
  viewBox.w *= factor;
  viewBox.h *= factor;
}

export function panViewBox(viewBox, dir) {
  const step = 0.2;
  if      (dir === 'n') viewBox.y -= viewBox.h * step;
  else if (dir === 's') viewBox.y += viewBox.h * step;
  else if (dir === 'w') viewBox.x -= viewBox.w * step;
  else if (dir === 'e') viewBox.x += viewBox.w * step;
}

export function zoomViewBox(viewBox, factor) {
  const newW = viewBox.w * factor, newH = viewBox.h * factor;
  viewBox.x += 0.5 * (viewBox.w - newW);
  viewBox.y += 0.5 * (viewBox.h - newH);
  viewBox.w  = newW; viewBox.h  = newH;
}

export function defaultZoomW(mapId, data, roomUnits, container) {
  const meta = data.maps[mapId];
  if (!meta) return 1;
  if (mapId === 47) return 280;
  if (mapId === 99) return meta.maxX / 2;
  const unit = roomUnits.get(mapId);
  if (unit) return container.clientWidth * unit / TARGET_PX;
  return meta.maxX / 4;
}

export function resetZoomDimensions(container, mapId, data, roomUnits) {
  const ratio = container.clientHeight / Math.max(container.clientWidth, 1);
  const w = defaultZoomW(mapId, data, roomUnits, container);
  return { w, h: w * ratio };
}

export function persistZoom(savedZoom, callbacks, mapId, w) {
  savedZoom.set(mapId, w);
  callbacks.onPersistZoom(mapId, w);
}
