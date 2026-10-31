// juego — v2: cuarto de fotos
// Estás parado en el medio de un cuarto. Girás con el pulgar.
// Tocás una superficie vacía, sacás una foto y pasa a ser esa superficie.
// Mantener apretada una superficie con foto la vuelve a sacar.
const VERSION = 'v2';
document.getElementById('ver').textContent = VERSION;

const canvas = document.getElementById('c');
const cam = document.getElementById('cam');
const hint = document.getElementById('hint');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });

// --- geometría del cuarto: x derecha, y arriba, z hacia atrás (arrancás mirando -z) ---
const D = 1;           // medio ancho / media profundidad
const HH = 4 / 3;      // medio alto: el cuarto es más alto que ancho, las fotos verticales entran casi enteras
const FOVX = 70 * Math.PI / 180;

// cada cara: centro, "derecha" y "arriba" tal como la ves parado mirándola de frente.
// techo/piso: la parte de arriba de la foto queda donde queda el borde de arriba del celu
// cuando lo inclinás para apuntar (techo: hacia atrás, piso: hacia adelante).
const FACES = [
  { id: 'frente',    c: [0, 0, -D], r: [1, 0, 0],  u: [0, 1, 0],  w: 2 * D, h: 2 * HH, shade: 1.0 },
  { id: 'derecha',   c: [D, 0, 0],  r: [0, 0, 1],  u: [0, 1, 0],  w: 2 * D, h: 2 * HH, shade: 0.9 },
  { id: 'atras',     c: [0, 0, D],  r: [-1, 0, 0], u: [0, 1, 0],  w: 2 * D, h: 2 * HH, shade: 0.96 },
  { id: 'izquierda', c: [-D, 0, 0], r: [0, 0, -1], u: [0, 1, 0],  w: 2 * D, h: 2 * HH, shade: 0.9 },
  { id: 'techo',     c: [0, HH, 0], r: [1, 0, 0],  u: [0, 0, 1],  w: 2 * D, h: 2 * D,  shade: 1.04 },
  { id: 'piso',      c: [0, -HH, 0], r: [1, 0, 0], u: [0, 0, -1], w: 2 * D, h: 2 * D,  shade: 0.8 },
];
const byId = Object.fromEntries(FACES.map(f => [f.id, f]));

// --- shaders ---
const vs = `
attribute vec3 p; attribute vec2 uv;
uniform mat4 m; varying vec2 v;
void main() { v = uv; gl_Position = m * vec4(p, 1.0); }`;
const fs = `
precision mediump float;
uniform sampler2D t; uniform float shade; varying vec2 v;
void main() { vec4 c = texture2D(t, v); gl_FragColor = vec4(c.rgb * shade, 1.0); }`;
function sh(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
gl.linkProgram(prog);
gl.useProgram(prog);
const aP = gl.getAttribLocation(prog, 'p'), aUV = gl.getAttribLocation(prog, 'uv');
const uM = gl.getUniformLocation(prog, 'm'), uShade = gl.getUniformLocation(prog, 'shade');

// un quad por cara (un pelito más grande para que no se vean rendijas en las esquinas)
const GROW = 1.003;
for (const f of FACES) {
  const hw = f.w / 2 * GROW, hh = f.h / 2 * GROW;
  const pt = (sx, sy) => [0, 1, 2].map(i => f.c[i] + f.r[i] * hw * sx + f.u[i] * hh * sy);
  // arriba-izq, arriba-der, abajo-izq, abajo-der  (uv 0,0 = arriba-izq de la imagen)
  const data = [
    ...pt(-1, 1), 0, 0,  ...pt(1, 1), 1, 0,  ...pt(-1, -1), 0, 1,
    ...pt(1, 1), 1, 0,   ...pt(1, -1), 1, 1, ...pt(-1, -1), 0, 1,
  ];
  f.buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, f.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  f.tex = gl.createTexture();
  setTexture(f, emptyCanvas(f));
}

function setTexture(f, src) {
  gl.bindTexture(gl.TEXTURE_2D, f.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function texSize(f) {
  const w = 1024;
  return [w, Math.round(w * f.h / f.w)];
}

function emptyCanvas(f) {
  const [w, h] = texSize(f);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#26262e'; x.fillRect(0, 0, w, h);
  x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 6; x.setLineDash([24, 18]);
  x.strokeRect(14, 14, w - 28, h - 28);
  x.setLineDash([]);
  x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 10; x.lineCap = 'round';
  x.beginPath();
  x.moveTo(w / 2 - 50, h / 2); x.lineTo(w / 2 + 50, h / 2);
  x.moveTo(w / 2, h / 2 - 50); x.lineTo(w / 2, h / 2 + 50);
  x.stroke();
  return c;
}

// recorta la foto tipo "cover" a la proporción de la cara
function coverCanvas(f, img) {
  const [w, h] = texSize(f);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.max(w / iw, h / ih);
  const dw = iw * k, dh = ih * k;
  c.getContext('2d').drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}

// --- cámara virtual ---
let yaw = 0, pitch = 0, vyaw = 0, vpitch = 0;
let W = 1, H = 1, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

function basis() {
  const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
  const f = [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return { f, r, u };
}
function tanHalf() {
  const tx = Math.tan(FOVX / 2);
  return [tx, tx * H / W];
}

function matrix() {
  const { f, r, u } = basis();
  const [tx, ty] = tanHalf();
  const n = 0.05, fa = 20;
  // proyección * vista (columna mayor)
  const A = (fa + n) / (n - fa), B = 2 * fa * n / (n - fa);
  const sx = 1 / tx, sy = 1 / ty;
  // filas de la vista: r, u, -f
  return new Float32Array([
    sx * r[0], sy * u[0], A * -f[0], f[0],
    sx * r[1], sy * u[1], A * -f[1], f[1],
    sx * r[2], sy * u[2], A * -f[2], f[2],
    0,         0,         B,         0,
  ]);
}

// qué cara hay debajo de un punto de la pantalla
function faceAt(x, y) {
  const { f, r, u } = basis();
  const [tx, ty] = tanHalf();
  const nx = (x / W) * 2 - 1, ny = 1 - (y / H) * 2;
  const d = [0, 1, 2].map(i => f[i] + r[i] * nx * tx + u[i] * ny * ty);
  const t = [D / Math.abs(d[0]), HH / Math.abs(d[1]), D / Math.abs(d[2])];
  const axis = t.indexOf(Math.min(...t));
  if (axis === 0) return d[0] > 0 ? 'derecha' : 'izquierda';
  if (axis === 1) return d[1] > 0 ? 'techo' : 'piso';
  return d[2] < 0 ? 'frente' : 'atras';
}

function draw() {
  gl.clearColor(0.055, 0.055, 0.07, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniformMatrix4fv(uM, false, matrix());
  for (const f of FACES) {
    gl.bindBuffer(gl.ARRAY_BUFFER, f.buf);
    gl.enableVertexAttribArray(aP);
    gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 20, 12);
    gl.bindTexture(gl.TEXTURE_2D, f.tex);
    gl.uniform1f(uShade, f.shade);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

// --- fotos guardadas (solo en el celu, IndexedDB) ---
const db = new Promise((res, rej) => {
  const r = indexedDB.open('juego', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('fotos');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function savePhoto(id, blob) {
  const d = await db;
  return new Promise((res, rej) => {
    const tx = d.transaction('fotos', 'readwrite');
    tx.objectStore('fotos').put(blob, id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function loadPhotos() {
  const d = await db;
  return new Promise((res, rej) => {
    const out = {};
    const tx = d.transaction('fotos', 'readonly');
    const req = tx.objectStore('fotos').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out[c.key] = c.value; c.continue(); } else res(out);
    };
    req.onerror = () => rej(req.error);
  });
}

async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const filled = new Set();
async function applyPhoto(id, blob) {
  const f = byId[id];
  if (!f) return;
  const img = await blobToImage(blob);
  setTexture(f, coverCanvas(f, img));
  filled.add(id);
  updateHint();
}

function updateHint() { hint.style.opacity = filled.size === 0 ? 1 : 0; }

// achica la foto antes de guardarla (las de 12MP ocupan mucho y no hacen falta)
async function shrink(file, maxSide = 1600) {
  const img = await blobToImage(file);
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
}

let target = null;
cam.addEventListener('change', async () => {
  const file = cam.files && cam.files[0];
  cam.value = '';
  if (!file || !target) return;
  const id = target; target = null;
  const blob = await shrink(file);
  await applyPhoto(id, blob);
  savePhoto(id, blob).catch(() => {});
  buzz(15);
});

function openCamera(id) { target = id; cam.click(); }
function buzz(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

// --- input: un dedo ---
const SENS = 0.25; // grados por px
let ptr = null, pressTimer = null;

canvas.addEventListener('pointerdown', e => {
  if (ptr) return;
  canvas.setPointerCapture(e.pointerId);
  vyaw = vpitch = 0;
  const now = performance.now();
  ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY,
          t0: now, lt: now, moved: false, longDone: false };
  const id = faceAt(e.clientX, e.clientY);
  if (filled.has(id)) {
    pressTimer = setTimeout(() => {
      if (!ptr || ptr.moved) return;
      ptr.longDone = true;
      buzz(30);
      openCamera(id);
    }, 600);
  }
});

canvas.addEventListener('pointermove', e => {
  if (!ptr || e.pointerId !== ptr.id) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  const now = performance.now();
  const dt = Math.max(1, now - ptr.lt);
  ptr.x = e.clientX; ptr.y = e.clientY; ptr.lt = now;
  if (!ptr.moved && Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0) > 8) {
    ptr.moved = true;
    clearTimeout(pressTimer);
  }
  if (!ptr.moved) return;
  // el mundo sigue al dedo
  yaw -= dx * SENS;
  pitch = clampPitch(pitch + dy * SENS);
  vyaw = -dx * SENS * 16 / dt;
  vpitch = dy * SENS * 16 / dt;
});

function endPtr(e) {
  if (!ptr || e.pointerId !== ptr.id) return;
  clearTimeout(pressTimer);
  const tap = !ptr.moved && !ptr.longDone && performance.now() - ptr.t0 < 500;
  if (tap) {
    const id = faceAt(e.clientX, e.clientY);
    if (!filled.has(id)) openCamera(id);
  }
  if (performance.now() - ptr.lt > 120) vyaw = vpitch = 0; // soltó quieto: sin inercia
  ptr = null;
}
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', e => {
  if (ptr && e.pointerId === ptr.id) { clearTimeout(pressTimer); ptr = null; }
});

function clampPitch(p) { return Math.max(-85, Math.min(85, p)); }

// --- loop ---
let last = performance.now();
function loop(now) {
  const k = Math.min(3, (now - last) / 16.67);
  last = now;
  if (!ptr && (Math.abs(vyaw) > 0.01 || Math.abs(vpitch) > 0.01)) {
    yaw += vyaw * k;
    pitch = clampPitch(pitch + vpitch * k);
    const f = Math.pow(0.93, k);
    vyaw *= f; vpitch *= f;
  }
  draw();
  requestAnimationFrame(loop);
}

loadPhotos().then(all => Promise.all(Object.keys(all).map(id => applyPhoto(id, all[id]))))
  .catch(() => {}).finally(updateHint);
requestAnimationFrame(loop);

// para los tests
window.__game = {
  get yaw() { return yaw; }, get pitch() { return pitch; }, get vel() { return [vyaw, vpitch]; },
  set view(v) { yaw = v[0]; pitch = v[1]; vyaw = vpitch = 0; },
  get filled() { return [...filled]; },
  faceAt,
};
