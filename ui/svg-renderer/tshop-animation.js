// The `anim` rAF id changes every frame, so the class can't hold a plain
// number and expect it to stay current — startTshopAnim returns a single
// mutable handle object that the frame loop keeps updated in place, and the
// class holds onto that one object (replacing the old #tshopAnim/#tshopCanvas
// field pair) instead of trying to track a stale snapshot.
export function startTshopAnim() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;";
  document.body.appendChild(canvas);
  const handle = { anim: null, canvas };
  const particles = [];
  const ctx = canvas.getContext("2d");
  const HS_MAX = 80, HS_SPAWN = 0.35, HS_ACCEL = 1.015;
  const frame = () => {
    if (!canvas.isConnected) { handle.anim = null; handle.canvas = null; return; }
    handle.anim = requestAnimationFrame(frame);
    const cw = window.innerWidth, ch = window.innerHeight;
    if (!cw || !ch) return;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.clearRect(0, 0, cw, ch);
    const ocx = cw / 2, ocy = ch / 2;
    const maxDist = Math.max(
      Math.hypot(ocx, ocy), Math.hypot(cw - ocx, ocy),
      Math.hypot(ocx, ch - ocy), Math.hypot(cw - ocx, ch - ocy)
    ) * 1.05;
    const fadeDist = maxDist * 0.75;
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#ffffff";
    if (particles.length < HS_MAX && Math.random() < HS_SPAWN) {
      particles.push({ angle: Math.random() * Math.PI * 2, dist: 0, speed: 0.5 + Math.random() * 0.8 });
    }
    ctx.strokeStyle = fg; ctx.lineCap = "round";
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const prev = p.dist;
      p.speed *= HS_ACCEL; p.dist += p.speed;
      if (p.dist >= maxDist) { particles.splice(i, 1); continue; }
      const opacity = p.dist < 15 ? p.dist / 15
        : p.dist > fadeDist ? 1 - (p.dist - fadeDist) / (maxDist - fadeDist) : 1;
      const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
      ctx.globalAlpha = opacity * 0.75;
      ctx.lineWidth   = Math.max(0.5, p.speed * 0.15);
      ctx.beginPath();
      ctx.moveTo(ocx + cos * prev,   ocy + sin * prev);
      ctx.lineTo(ocx + cos * p.dist, ocy + sin * p.dist);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  handle.anim = requestAnimationFrame(frame);
  return handle;
}

export function stopTshopAnim(handle) {
  if (!handle || handle.anim === null) return;
  cancelAnimationFrame(handle.anim);
  handle.anim = null;
  if (handle.canvas) { handle.canvas.remove(); handle.canvas = null; }
}
