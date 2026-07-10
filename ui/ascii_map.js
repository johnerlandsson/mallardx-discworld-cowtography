const $grid  = document.getElementById("grid");
const $empty = document.getElementById("empty");

function render(rows) {
  $grid.innerHTML = "";
  if (!rows || rows.length === 0) {
    $grid.hidden = true;
    $empty.hidden = false;
    return;
  }
  $grid.hidden = false;
  $empty.hidden = true;
  for (let r = 0; r < rows.length; r++) {
    for (const cell of rows[r]) {
      if (cell.fg) {
        const span = document.createElement("span");
        span.style.color = cell.fg;
        if (cell.bold) span.style.fontWeight = "bold";
        span.textContent = cell.char;
        $grid.appendChild(span);
      } else {
        $grid.appendChild(document.createTextNode(cell.char));
      }
    }
    if (r < rows.length - 1) $grid.appendChild(document.createTextNode("\n"));
  }
}

panel.on("map_rows", (frame) => render(frame.rows || []));

// ─── Zoom ──────────────────────────────────────────────────────────────────
// Font-size scaling rather than a CSS transform: text stays crisp at every
// size instead of blurring, and the monospace grid alignment falls out of
// the font metrics for free — no separate scale/offset math needed.
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;
let fontSize = 13;  // matches ascii_map.css's default

function applyFontSize() {
  $grid.style.fontSize = fontSize + "px";
}

document.addEventListener("wheel", (e) => {
  e.preventDefault();
  const step = e.deltaY < 0 ? 1 : -1;
  const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize + step));
  if (next === fontSize) return;
  fontSize = next;
  applyFontSize();
  panel.post("save_zoom", { size: fontSize });
}, { passive: false });

panel.on("zoom_data", (frame) => {
  if (typeof frame.size === "number") {
    fontSize = frame.size;
    applyFontSize();
  }
});

// ─── Context menu ─────────────────────────────────────────────────────────
if (panel.menu && typeof panel.menu.show === "function") {
  document.addEventListener("contextmenu", (e) => {
    panel.menu.show(e, [
      { label: "Show map in output", onClick: () => panel.post("set_map_output", { on: true }) },
      { label: "Hide map in output", onClick: () => panel.post("set_map_output", { on: false }) },
    ]);
  });
}

// Signal readiness so Lua can push the last-known grid immediately.
panel.post("ready", {});
