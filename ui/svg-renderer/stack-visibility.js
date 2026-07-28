import { upperToGround, groundToUppers } from "../data/room-stacks.js";

export function setStackRoomVisible(svg, id, visible) {
  const d = visible ? '' : 'none';
  const roomEl = svg.querySelector(`#room-${CSS.escape(id)}`);
  if (roomEl) {
    roomEl.style.display = d;
    const sib = roomEl.nextElementSibling;
    if (sib?.classList.contains('room-type-label')) sib.style.display = d;
  }
  const stairEl = svg.querySelector(`#stair-${CSS.escape(id)}`);
  if (stairEl) stairEl.style.display = d;
}

export function updateStackVisibility(svg, roomId, currentStackGround) {
  if (!svg) return currentStackGround;
  if (currentStackGround) {
    setStackRoomVisible(svg, currentStackGround, true);
    for (const u of groundToUppers[currentStackGround] ?? [])
      setStackRoomVisible(svg, u, false);
    currentStackGround = null;
  }
  if (!roomId) return currentStackGround;
  const ground = upperToGround[roomId];
  if (ground) {
    setStackRoomVisible(svg, ground, false);
    setStackRoomVisible(svg, roomId, true);
    currentStackGround = ground;
  }
  return currentStackGround;
}
