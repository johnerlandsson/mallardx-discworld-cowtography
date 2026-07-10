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
