// WeakMaps for overlay element tracking — module-level so they survive across load() calls.
const _origParent  = new WeakMap();
const _origNextSib = new WeakMap();

export function _ensureOverlay(svg, id) {
  let g = svg.querySelector(`#${id}`);
  if (!g) {
    g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.id = id;
    svg.appendChild(g);
  }
  return g;
}

export function _lift(el, overlay) {
  if (!el) return;
  if (!_origParent.has(el)) {
    _origParent.set(el, el.parentNode);
    _origNextSib.set(el, el.nextSibling);
  }
  overlay.appendChild(el);
}

export function _restoreOverlay(overlay) {
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
