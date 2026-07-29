import { ROOM_TYPE_LABELS } from "./constants.js";

export function wireTooltip(svg) {
  if (!svg) return;
  svg.addEventListener("pointermove", (e) => {
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
  svg.addEventListener("pointerleave", () => { panel.tooltip.hide(); });
}
