import { drawLibraryOverlay } from "./library-overlay.js";

export function drawState(img, canvas, rooms, mapId, roomUnit, { current, target, routeRoomIds, libraryOverlay }, mapJustLoaded) {
  if (!img || !canvas) return mapJustLoaded;
  const w = img.clientWidth, h = img.clientHeight;
  if (!w || !h) return mapJustLoaded;
  // Suppress yellow dot on the first draw after map load (plugin reload case).
  // Once the player moves (target set) or after the first stationary draw, show normally.
  if (mapJustLoaded) {
    mapJustLoaded = false;
    if (target === null) return mapJustLoaded;
  }
  if (canvas.width !== w)  canvas.width  = w;
  if (canvas.height !== h) canvas.height = h;

  const scaleX = w / img.naturalWidth;
  const scaleY = h / img.naturalHeight;
  const toCanvasX = (px) => px * scaleX;
  const toCanvasY = (py) => py * scaleY;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const dotR   = roomUnit != null ? Math.max(2, roomUnit * 0.3) * scaleX : 8;
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

  return mapJustLoaded;
}
