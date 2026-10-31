// juego — mecánica 1: honda con el pulgar
const VERSION = 'v1';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// --- estado ---
const R = 14;                 // radio de la bola
const FRICTION = 0.985;       // por frame a 60fps
const POWER = 0.12;           // velocidad por px de arrastre
const MAX_DRAG = 220;

const ball = { x: W / 2, y: H * 0.6, vx: 0, vy: 0 };
const trail = [];
const sparks = [];
let drag = null; // { x0, y0, x, y }

function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// --- input: un dedo, cualquier lugar de la pantalla ---
canvas.addEventListener('pointerdown', e => {
  if (drag) return;
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.x = e.clientX; drag.y = e.clientY;
});
function release(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { dx, dy, len } = pull();
  if (len > 8) {
    ball.vx = -dx * POWER;
    ball.vy = -dy * POWER;
    buzz(12);
  }
  drag = null;
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) drag = null; });

function pull() {
  let dx = drag.x - drag.x0, dy = drag.y - drag.y0;
  let len = Math.hypot(dx, dy);
  if (len > MAX_DRAG) { dx *= MAX_DRAG / len; dy *= MAX_DRAG / len; len = MAX_DRAG; }
  return { dx, dy, len };
}

// --- física ---
function step(dt) {
  const k = dt * 60;
  ball.x += ball.vx * k;
  ball.y += ball.vy * k;

  let hit = false;
  if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); hit = true; }
  if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); hit = true; }
  if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy); hit = true; }
  if (ball.y > H - R) { ball.y = H - R; ball.vy = -Math.abs(ball.vy); hit = true; }

  const speed = Math.hypot(ball.vx, ball.vy);
  if (hit && speed > 2) {
    buzz(Math.min(25, 4 + speed));
    for (let i = 0; i < Math.min(14, speed); i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed * 0.4;
      sparks.push({ x: ball.x, y: ball.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1 });
    }
  }

  const f = Math.pow(FRICTION, k);
  ball.vx *= f; ball.vy *= f;
  if (speed < 0.05) { ball.vx = 0; ball.vy = 0; }

  trail.push({ x: ball.x, y: ball.y });
  if (trail.length > 24) trail.shift();

  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.x += p.vx * k; p.y += p.vy * k;
    p.vx *= 0.92; p.vy *= 0.92;
    p.life -= 0.035 * k;
    if (p.life <= 0) sparks.splice(i, 1);
  }
}

// --- dibujo ---
function draw() {
  ctx.fillStyle = '#0e0e12';
  ctx.fillRect(0, 0, W, H);

  // estela
  for (let i = 1; i < trail.length; i++) {
    const t = i / trail.length;
    ctx.strokeStyle = `rgba(255,120,80,${t * 0.5})`;
    ctx.lineWidth = R * 2 * t;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
  }

  // chispas
  for (const p of sparks) {
    ctx.fillStyle = `rgba(255,200,120,${p.life})`;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }

  // honda
  if (drag) {
    const { dx, dy, len } = pull();
    // dónde puso el dedo
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(drag.x0, drag.y0, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(drag.x0, drag.y0); ctx.lineTo(drag.x0 + dx, drag.y0 + dy); ctx.stroke();

    // dirección de tiro desde la bola
    if (len > 8) {
      const ux = -dx / len, uy = -dy / len;
      const reach = len * 1.6;
      ctx.setLineDash([6, 10]);
      ctx.strokeStyle = `rgba(255,120,80,${0.3 + 0.6 * len / MAX_DRAG})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(ball.x + ux * reach, ball.y + uy * reach);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // bola
  ctx.fillStyle = '#ff7850';
  ctx.beginPath(); ctx.arc(ball.x, ball.y, R, 0, Math.PI * 2); ctx.fill();

  // versión
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(VERSION, 10, H - 10);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// debug para tests
window.__game = { ball, get drag() { return drag; } };
